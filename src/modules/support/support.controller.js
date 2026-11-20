import { HTTP_STATUS } from '../../constants/index.js';
import { USER_ROLES } from '../../constants/database.enums.js';
import { NOTIFICATION_EVENT_TYPES } from '../../constants/notification.types.js';
import { hasPermission } from '../../constants/rbac.js';
import {
  SUPPORT_AUDIT_ACTIONS,
  SUPPORT_CREATOR_ROLES,
  SUPPORT_TICKET_STATUSES,
} from '../../constants/support.constants.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { recordAuditLog } from '../../utils/auditLog.js';
import { enqueueNotificationOutbox } from '../../utils/enqueueNotificationOutbox.js';
import { generateUniqueSupportTicketNumber } from '../../utils/supportTicketNumber.js';
import { normalizeAttachments, toPublicAttachments } from '../../utils/supportAttachments.js';
import { Payment } from '../payments/payment.model.js';
import { Pharmacy } from '../pharmacies/pharmacy.model.js';
import { Reservation } from '../reservations/reservation.model.js';
import { User } from '../users/user.model.js';
import { SupportTicket } from './supportTicket.model.js';
import { SupportTicketMessage } from './supportTicketMessage.model.js';

const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

const mapCreatorRole = (role) => {
  if (role === USER_ROLES.CUSTOMER) {
    return SUPPORT_CREATOR_ROLES.CUSTOMER;
  }

  if (role === USER_ROLES.PHARMACY_OWNER) {
    return SUPPORT_CREATOR_ROLES.PHARMACY_OWNER;
  }

  return null;
};

const toPublicTicket = (ticket) => ({
  id: ticket._id,
  ticketNumber: ticket.ticketNumber,
  category: ticket.category,
  subject: ticket.subject,
  description: ticket.description,
  priority: ticket.priority,
  status: ticket.status,
  creatorRole: ticket.creatorRole,
  relatedReservation: ticket.relatedReservation,
  relatedPayment: ticket.relatedPayment,
  attachments: toPublicAttachments(ticket.attachments || []),
  lastMessageAt: ticket.lastMessageAt,
  resolvedAt: ticket.resolvedAt,
  closedAt: ticket.closedAt,
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
});

const toPublicMessage = (message) => ({
  id: message._id,
  sender: message.sender,
  senderRole: message.senderRole,
  message: message.message,
  attachments: toPublicAttachments(message.attachments || []),
  createdAt: message.createdAt,
});

const createTicketWithRetry = async (payload) => {
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const ticketNumber = await generateUniqueSupportTicketNumber();

    try {
      return await SupportTicket.create({ ...payload, ticketNumber });
    } catch (error) {
      if (error?.code === 11000 && error?.keyPattern?.ticketNumber) {
        continue;
      }

      throw error;
    }
  }

  throw new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Unable to create support ticket');
};

const validateRelatedResources = async ({ userId, role, relatedReservation, relatedPayment }) => {
  if (relatedReservation) {
    const reservation = await Reservation.findById(relatedReservation).select('customer pharmacy').lean();

    if (!reservation) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Related reservation was not found');
    }

    if (role === USER_ROLES.CUSTOMER && reservation.customer.toString() !== userId.toString()) {
      throw new ApiError(HTTP_STATUS.FORBIDDEN, 'You cannot link another customer reservation to this ticket');
    }

    if (role === USER_ROLES.PHARMACY_OWNER) {
      const pharmacy = await Pharmacy.findOne({ owner: userId }).select('_id').lean();
      if (!pharmacy || reservation.pharmacy.toString() !== pharmacy._id.toString()) {
        throw new ApiError(HTTP_STATUS.FORBIDDEN, 'You cannot link a reservation outside your pharmacy');
      }
    }
  }

  if (relatedPayment) {
    const payment = await Payment.findById(relatedPayment).select('customer pharmacy').lean();

    if (!payment) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Related payment was not found');
    }

    if (role === USER_ROLES.CUSTOMER && payment.customer.toString() !== userId.toString()) {
      throw new ApiError(HTTP_STATUS.FORBIDDEN, 'You cannot link another customer payment to this ticket');
    }

    if (role === USER_ROLES.PHARMACY_OWNER) {
      const pharmacy = await Pharmacy.findOne({ owner: userId }).select('_id').lean();
      if (!pharmacy || payment.pharmacy.toString() !== pharmacy._id.toString()) {
        throw new ApiError(HTTP_STATUS.FORBIDDEN, 'You cannot link a payment outside your pharmacy');
      }
    }
  }
};

const notifySupportAdminsOnCreate = async (ticket) => {
  const admins = await User.find({
    role: { $in: [USER_ROLES.SUPER_ADMIN, USER_ROLES.OPERATIONS_ADMIN] },
    accountStatus: 'ACTIVE',
  })
    .select('_id role operationsPermissions')
    .lean();

  const recipients = admins.filter(
    (admin) =>
      admin.role === USER_ROLES.SUPER_ADMIN ||
      hasPermission(USER_ROLES.OPERATIONS_ADMIN, 'support:tickets:read', admin.operationsPermissions || [])
  );

  await Promise.all(
    recipients.map((admin) =>
      enqueueNotificationOutbox({
        eventType: NOTIFICATION_EVENT_TYPES.SUPPORT_TICKET_CREATED,
        recipient: admin._id,
        payload: {
          ticketId: ticket._id.toString(),
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          category: ticket.category,
          priority: ticket.priority,
        },
        relatedResourceType: 'SupportTicket',
        relatedResourceId: ticket._id,
        idempotencyKey: `support-ticket-created:${ticket._id}:${admin._id}`,
      })
    )
  );
};

const loadOwnedTicket = async (ticketId, userId) => {
  const ticket = await SupportTicket.findOne({ _id: ticketId, createdBy: userId }).lean();

  if (!ticket) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Support ticket not found');
  }

  return ticket;
};

export const createSupportTicket = async (req, res) => {
  const creatorRole = mapCreatorRole(req.auth.role);

  if (!creatorRole) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Your role cannot create support tickets');
  }

  const {
    category,
    subject,
    description,
    priority,
    relatedReservation,
    relatedPayment,
    attachments = [],
  } = req.body;

  await validateRelatedResources({
    userId: req.auth.userId,
    role: req.auth.role,
    relatedReservation,
    relatedPayment,
  });

  const normalizedAttachments = normalizeAttachments(attachments);

  const ticket = await createTicketWithRetry({
    createdBy: req.auth.userId,
    creatorRole,
    category,
    subject,
    description,
    priority,
    relatedReservation,
    relatedPayment,
    attachments: normalizedAttachments,
    status: SUPPORT_TICKET_STATUSES.OPEN,
    lastMessageAt: new Date(),
  });

  await recordAuditLog({
    actorId: req.auth.userId,
    action: SUPPORT_AUDIT_ACTIONS.TICKET_CREATED,
    resourceType: 'SupportTicket',
    resourceId: ticket._id,
    newValues: {
      ticketNumber: ticket.ticketNumber,
      status: ticket.status,
      category: ticket.category,
      priority: ticket.priority,
    },
    req,
  });

  await notifySupportAdminsOnCreate(ticket);

  const response = new ApiResponse(
    HTTP_STATUS.CREATED,
    { ticket: toPublicTicket(ticket.toObject()) },
    'Support ticket created successfully'
  );
  res.status(response.statusCode).json(response);
};

export const listMySupportTickets = async (req, res) => {
  const { page, limit, sortBy, sortOrder, status, category, priority } = req.query;
  const filter = { createdBy: req.auth.userId };

  if (status) {
    filter.status = status;
  }

  if (category) {
    filter.category = category;
  }

  if (priority) {
    filter.priority = priority;
  }

  const skip = (page - 1) * limit;
  const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

  const [tickets, total] = await Promise.all([
    SupportTicket.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    SupportTicket.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { tickets: tickets.map(toPublicTicket) },
    'Support tickets fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const getMySupportTicketById = async (req, res) => {
  const ticket = await loadOwnedTicket(req.params.ticketId, req.auth.userId);

  const messages = await SupportTicketMessage.find({
    ticket: ticket._id,
    isInternalNote: false,
  })
    .sort({ createdAt: 1 })
    .lean();

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      ticket: toPublicTicket(ticket),
      messages: messages.map(toPublicMessage),
    },
    'Support ticket fetched successfully'
  );
  res.status(response.statusCode).json(response);
};

export const addSupportTicketMessage = async (req, res) => {
  const ticket = await SupportTicket.findOne({
    _id: req.params.ticketId,
    createdBy: req.auth.userId,
  });

  if (!ticket) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Support ticket not found');
  }

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
  if (ticket.status === SUPPORT_TICKET_STATUSES.WAITING_FOR_USER) {
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

  if (ticket.assignedTo) {
    await enqueueNotificationOutbox({
      eventType: NOTIFICATION_EVENT_TYPES.SUPPORT_TICKET_USER_REPLY,
      recipient: ticket.assignedTo,
      payload: {
        ticketId: ticket._id.toString(),
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
      },
      relatedResourceType: 'SupportTicket',
      relatedResourceId: ticket._id,
      idempotencyKey: `support-user-reply:${messageDoc._id}:${ticket.assignedTo}`,
    });
  }

  const response = new ApiResponse(
    HTTP_STATUS.CREATED,
    { message: toPublicMessage(messageDoc.toObject()) },
    'Message added successfully'
  );
  res.status(response.statusCode).json(response);
};

export const reopenSupportTicket = async (req, res) => {
  const ticket = await SupportTicket.findOne({
    _id: req.params.ticketId,
    createdBy: req.auth.userId,
  });

  if (!ticket) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Support ticket not found');
  }

  if (ticket.status !== SUPPORT_TICKET_STATUSES.RESOLVED) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Only resolved tickets can be reopened');
  }

  const previousStatus = ticket.status;
  ticket.status = SUPPORT_TICKET_STATUSES.OPEN;
  ticket.resolvedAt = undefined;
  ticket.lastMessageAt = new Date();
  await ticket.save();

  await recordAuditLog({
    actorId: req.auth.userId,
    action: SUPPORT_AUDIT_ACTIONS.TICKET_REOPENED,
    resourceType: 'SupportTicket',
    resourceId: ticket._id,
    previousValues: { status: previousStatus },
    newValues: { status: ticket.status },
    req,
  });

  if (ticket.assignedTo) {
    await enqueueNotificationOutbox({
      eventType: NOTIFICATION_EVENT_TYPES.SUPPORT_TICKET_REOPENED,
      recipient: ticket.assignedTo,
      payload: {
        ticketId: ticket._id.toString(),
        ticketNumber: ticket.ticketNumber,
      },
      relatedResourceType: 'SupportTicket',
      relatedResourceId: ticket._id,
      idempotencyKey: `support-reopened-admin:${ticket._id}:${ticket.assignedTo}`,
    });
  }

  const admins = await User.find({
    role: USER_ROLES.SUPER_ADMIN,
    accountStatus: 'ACTIVE',
  })
    .select('_id')
    .lean();

  await Promise.all(
    admins.map((admin) =>
      enqueueNotificationOutbox({
        eventType: NOTIFICATION_EVENT_TYPES.SUPPORT_TICKET_REOPENED,
        recipient: admin._id,
        payload: {
          ticketId: ticket._id.toString(),
          ticketNumber: ticket.ticketNumber,
        },
        relatedResourceType: 'SupportTicket',
        relatedResourceId: ticket._id,
        idempotencyKey: `support-reopened-super:${ticket._id}:${admin._id}`,
      })
    )
  );

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { ticket: toPublicTicket(ticket.toObject()) },
    'Support ticket reopened successfully'
  );
  res.status(response.statusCode).json(response);
};
