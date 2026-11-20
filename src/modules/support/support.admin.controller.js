import { HTTP_STATUS } from '../../constants/index.js';
import { USER_ACCOUNT_STATUS, USER_ROLES } from '../../constants/database.enums.js';
import { NOTIFICATION_EVENT_TYPES } from '../../constants/notification.types.js';
import { hasPermission } from '../../constants/rbac.js';
import {
  SUPPORT_AUDIT_ACTIONS,
  SUPPORT_TICKET_STATUSES,
  SUPPORT_TICKET_STATUS_TRANSITIONS,
} from '../../constants/support.constants.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { recordAuditLog } from '../../utils/auditLog.js';
import { enqueueNotificationOutbox } from '../../utils/enqueueNotificationOutbox.js';
import { normalizeAttachments } from '../../utils/supportAttachments.js';
import { AuditLog } from '../audit-logs/auditLog.model.js';
import { User } from '../users/user.model.js';
import { SupportTicket } from './supportTicket.model.js';
import { SupportTicketMessage } from './supportTicketMessage.model.js';

const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

const isSuperAdmin = (auth) => auth.role === USER_ROLES.SUPER_ADMIN;

const canReadAllTickets = (auth) =>
  isSuperAdmin(auth) ||
  hasPermission(auth.role, 'support:tickets:read:platform', auth.operationsPermissions || []);

const assertCanManageTicket = (auth, ticket) => {
  if (isSuperAdmin(auth)) {
    return;
  }

  if (auth.role !== USER_ROLES.OPERATIONS_ADMIN) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'You do not have permission to manage this ticket');
  }

  if (!hasPermission(auth.role, 'support:tickets:manage', auth.operationsPermissions || [])) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'You do not have permission to manage support tickets');
  }

  if (!ticket.assignedTo || ticket.assignedTo.toString() !== auth.userId.toString()) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'You can only manage tickets assigned to you');
  }
};

const assertCanViewTicket = (auth, ticket) => {
  if (canReadAllTickets(auth)) {
    return;
  }

  if (auth.role === USER_ROLES.OPERATIONS_ADMIN) {
    if (ticket.assignedTo?.toString() === auth.userId.toString()) {
      return;
    }
  }

  throw new ApiError(HTTP_STATUS.FORBIDDEN, 'You do not have permission to view this ticket');
};

const toAdminTicket = (ticket) => ({
  id: ticket._id,
  ticketNumber: ticket.ticketNumber,
  createdBy: ticket.createdBy,
  creatorRole: ticket.creatorRole,
  assignedTo: ticket.assignedTo,
  category: ticket.category,
  subject: ticket.subject,
  description: ticket.description,
  priority: ticket.priority,
  status: ticket.status,
  relatedReservation: ticket.relatedReservation,
  relatedPayment: ticket.relatedPayment,
  attachments: (ticket.attachments || []).map((attachment) => ({
    fileKey: attachment.fileKey,
    fileName: attachment.fileName,
    fileType: attachment.fileType,
    sizeBytes: attachment.sizeBytes,
    uploadedAt: attachment.uploadedAt,
  })),
  lastMessageAt: ticket.lastMessageAt,
  resolvedAt: ticket.resolvedAt,
  closedAt: ticket.closedAt,
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
});

const toAdminMessage = (message) => ({
  id: message._id,
  sender: message.sender,
  senderRole: message.senderRole,
  message: message.message,
  isInternalNote: message.isInternalNote,
  attachments: (message.attachments || []).map((attachment) => ({
    fileKey: attachment.fileKey,
    fileName: attachment.fileName,
    fileType: attachment.fileType,
    sizeBytes: attachment.sizeBytes,
    uploadedAt: attachment.uploadedAt,
  })),
  createdAt: message.createdAt,
});

const buildAdminListFilter = (auth, query) => {
  const filter = {};

  if (query.status) {
    filter.status = query.status;
  }

  if (query.category) {
    filter.category = query.category;
  }

  if (query.priority) {
    filter.priority = query.priority;
  }

  if (query.assignedTo) {
    filter.assignedTo = query.assignedTo;
  }

  if (query.createdBy) {
    filter.createdBy = query.createdBy;
  }

  if (query.search) {
    const term = query.search.trim();
    filter.$or = [
      { ticketNumber: { $regex: term, $options: 'i' } },
      { subject: { $regex: term, $options: 'i' } },
    ];
  }

  if (!canReadAllTickets(auth)) {
    filter.assignedTo = auth.userId;
  }

  return filter;
};

const loadTicketOrThrow = async (ticketId) => {
  const ticket = await SupportTicket.findById(ticketId);

  if (!ticket) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Support ticket not found');
  }

  return ticket;
};

const assertValidStatusTransition = (currentStatus, nextStatus) => {
  const allowed = SUPPORT_TICKET_STATUS_TRANSITIONS[currentStatus] || [];

  if (!allowed.includes(nextStatus)) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      `Status cannot change from ${currentStatus} to ${nextStatus}`
    );
  }
};

export const listAdminSupportTickets = async (req, res) => {
  const { page, limit, sortBy, sortOrder } = req.query;
  const filter = buildAdminListFilter(req.auth, req.query);
  const skip = (page - 1) * limit;
  const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

  const [tickets, total] = await Promise.all([
    SupportTicket.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    SupportTicket.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { tickets: tickets.map(toAdminTicket) },
    'Support tickets fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const getAdminSupportTicketById = async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.ticketId).select('+attachments.fileKey').lean();

  if (!ticket) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Support ticket not found');
  }

  assertCanViewTicket(req.auth, ticket);

  const messages = await SupportTicketMessage.find({ ticket: ticket._id })
    .select('+attachments.fileKey')
    .sort({ createdAt: 1 })
    .lean();

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      ticket: toAdminTicket(ticket),
      messages: messages.map(toAdminMessage),
    },
    'Support ticket fetched successfully'
  );
  res.status(response.statusCode).json(response);
};

export const assignAdminSupportTicket = async (req, res) => {
  const ticket = await loadTicketOrThrow(req.params.ticketId);
  const { assigneeId } = req.body;

  const assignee = await User.findOne({
    _id: assigneeId,
    role: { $in: [USER_ROLES.SUPER_ADMIN, USER_ROLES.OPERATIONS_ADMIN] },
    accountStatus: USER_ACCOUNT_STATUS.ACTIVE,
  }).select('_id role operationsPermissions');

  if (!assignee) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Assignee must be an active admin user');
  }

  if (
    assignee.role === USER_ROLES.OPERATIONS_ADMIN &&
    !hasPermission(assignee.role, 'support:tickets:manage', assignee.operationsPermissions || [])
  ) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Assignee is not authorized to manage support tickets');
  }

  const previousAssignee = ticket.assignedTo?.toString();
  ticket.assignedTo = assignee._id;

  if (
    ticket.status === SUPPORT_TICKET_STATUSES.OPEN ||
    ticket.status === SUPPORT_TICKET_STATUSES.ASSIGNED
  ) {
    ticket.status = SUPPORT_TICKET_STATUSES.ASSIGNED;
  }

  await ticket.save();

  await recordAuditLog({
    actorId: req.auth.userId,
    action: SUPPORT_AUDIT_ACTIONS.TICKET_ASSIGNED,
    resourceType: 'SupportTicket',
    resourceId: ticket._id,
    previousValues: { assignedTo: previousAssignee },
    newValues: { assignedTo: assignee._id.toString() },
    req,
  });

  await enqueueNotificationOutbox({
    eventType: NOTIFICATION_EVENT_TYPES.SUPPORT_TICKET_ASSIGNED,
    recipient: assignee._id,
    payload: {
      ticketId: ticket._id.toString(),
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      priority: ticket.priority,
    },
    relatedResourceType: 'SupportTicket',
    relatedResourceId: ticket._id,
    idempotencyKey: `support-assigned:${ticket._id}:${assignee._id}`,
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { ticket: toAdminTicket(ticket.toObject()) },
    'Support ticket assigned successfully'
  );
  res.status(response.statusCode).json(response);
};

export const updateAdminSupportTicketStatus = async (req, res) => {
  const ticket = await loadTicketOrThrow(req.params.ticketId);
  assertCanManageTicket(req.auth, ticket);

  const { status: nextStatus } = req.body;
  const previousStatus = ticket.status;

  assertValidStatusTransition(previousStatus, nextStatus);

  ticket.status = nextStatus;

  if (nextStatus === SUPPORT_TICKET_STATUSES.RESOLVED) {
    ticket.resolvedAt = new Date();
  }

  if (nextStatus === SUPPORT_TICKET_STATUSES.CLOSED) {
    ticket.closedAt = new Date();
    if (!ticket.resolvedAt) {
      ticket.resolvedAt = new Date();
    }
  }

  await ticket.save();

  const auditAction =
    nextStatus === SUPPORT_TICKET_STATUSES.RESOLVED
      ? SUPPORT_AUDIT_ACTIONS.TICKET_RESOLVED
      : nextStatus === SUPPORT_TICKET_STATUSES.CLOSED
        ? SUPPORT_AUDIT_ACTIONS.TICKET_CLOSED
        : SUPPORT_AUDIT_ACTIONS.TICKET_STATUS_CHANGED;

  await recordAuditLog({
    actorId: req.auth.userId,
    action: auditAction,
    resourceType: 'SupportTicket',
    resourceId: ticket._id,
    previousValues: { status: previousStatus },
    newValues: { status: nextStatus },
    req,
  });

  if (nextStatus === SUPPORT_TICKET_STATUSES.RESOLVED || nextStatus === SUPPORT_TICKET_STATUSES.CLOSED) {
    await enqueueNotificationOutbox({
      eventType: NOTIFICATION_EVENT_TYPES.SUPPORT_TICKET_RESOLVED,
      recipient: ticket.createdBy,
      payload: {
        ticketId: ticket._id.toString(),
        ticketNumber: ticket.ticketNumber,
        status: nextStatus,
      },
      relatedResourceType: 'SupportTicket',
      relatedResourceId: ticket._id,
      idempotencyKey: `support-resolved:${ticket._id}:${nextStatus}`,
    });
  }

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { ticket: toAdminTicket(ticket.toObject()) },
    'Support ticket status updated successfully'
  );
  res.status(response.statusCode).json(response);
};

export const updateAdminSupportTicketPriority = async (req, res) => {
  const ticket = await loadTicketOrThrow(req.params.ticketId);
  assertCanManageTicket(req.auth, ticket);

  const previousPriority = ticket.priority;
  ticket.priority = req.body.priority;
  await ticket.save();

  await recordAuditLog({
    actorId: req.auth.userId,
    action: SUPPORT_AUDIT_ACTIONS.TICKET_PRIORITY_CHANGED,
    resourceType: 'SupportTicket',
    resourceId: ticket._id,
    previousValues: { priority: previousPriority },
    newValues: { priority: ticket.priority },
    req,
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { ticket: toAdminTicket(ticket.toObject()) },
    'Support ticket priority updated successfully'
  );
  res.status(response.statusCode).json(response);
};

export const addAdminSupportTicketMessage = async (req, res) => {
  const ticket = await loadTicketOrThrow(req.params.ticketId);
  assertCanManageTicket(req.auth, ticket);

  if (ticket.status === SUPPORT_TICKET_STATUSES.CLOSED) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Cannot reply to a closed support ticket');
  }

  const normalizedAttachments = normalizeAttachments(req.body.attachments || []);

  const messageDoc = await SupportTicketMessage.create({
    ticket: ticket._id,
    sender: req.auth.userId,
    senderRole: req.auth.role,
    message: req.body.message,
    attachments: normalizedAttachments,
    isInternalNote: false,
  });

  ticket.lastMessageAt = new Date();

  if (ticket.status === SUPPORT_TICKET_STATUSES.ASSIGNED) {
    ticket.status = SUPPORT_TICKET_STATUSES.IN_PROGRESS;
  }

  if (ticket.status === SUPPORT_TICKET_STATUSES.OPEN) {
    ticket.status = SUPPORT_TICKET_STATUSES.IN_PROGRESS;
  }

  await ticket.save();

  await recordAuditLog({
    actorId: req.auth.userId,
    action: SUPPORT_AUDIT_ACTIONS.TICKET_PUBLIC_MESSAGE,
    resourceType: 'SupportTicket',
    resourceId: ticket._id,
    metadata: { messageId: messageDoc._id },
    req,
  });

  await enqueueNotificationOutbox({
    eventType: NOTIFICATION_EVENT_TYPES.SUPPORT_TICKET_ADMIN_REPLY,
    recipient: ticket.createdBy,
    payload: {
      ticketId: ticket._id.toString(),
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
    },
    relatedResourceType: 'SupportTicket',
    relatedResourceId: ticket._id,
    idempotencyKey: `support-admin-reply:${messageDoc._id}`,
  });

  const response = new ApiResponse(
    HTTP_STATUS.CREATED,
    { message: toAdminMessage(messageDoc.toObject()) },
    'Message added successfully'
  );
  res.status(response.statusCode).json(response);
};

export const addAdminSupportTicketNote = async (req, res) => {
  const ticket = await loadTicketOrThrow(req.params.ticketId);
  assertCanManageTicket(req.auth, ticket);

  const normalizedAttachments = normalizeAttachments(req.body.attachments || []);

  const messageDoc = await SupportTicketMessage.create({
    ticket: ticket._id,
    sender: req.auth.userId,
    senderRole: req.auth.role,
    message: req.body.message,
    attachments: normalizedAttachments,
    isInternalNote: true,
  });

  await recordAuditLog({
    actorId: req.auth.userId,
    action: SUPPORT_AUDIT_ACTIONS.TICKET_INTERNAL_NOTE,
    resourceType: 'SupportTicket',
    resourceId: ticket._id,
    metadata: { messageId: messageDoc._id },
    req,
  });

  const response = new ApiResponse(
    HTTP_STATUS.CREATED,
    { note: toAdminMessage(messageDoc.toObject()) },
    'Internal note added successfully'
  );
  res.status(response.statusCode).json(response);
};

export const getAdminSupportTicketHistory = async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.ticketId).lean();

  if (!ticket) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Support ticket not found');
  }

  assertCanViewTicket(req.auth, ticket);

  const history = await AuditLog.find({
    resourceType: 'SupportTicket',
    resourceId: ticket._id,
  })
    .sort({ createdAt: 1 })
    .populate('actor', 'fullName role username')
    .lean();

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      history: history.map((entry) => ({
        id: entry._id,
        action: entry.action,
        actor: entry.actor,
        previousValues: entry.previousValues,
        newValues: entry.newValues,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
      })),
    },
    'Support ticket history fetched successfully'
  );
  res.status(response.statusCode).json(response);
};
