import Joi from 'joi';
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
} from '../../constants/support.constants.js';

const objectId = Joi.string().hex().length(24);

const attachmentSchema = Joi.object({
  fileKey: Joi.string().trim().min(3).max(512).required(),
  fileType: Joi.string().trim().min(3).max(120).required(),
  fileName: Joi.string().trim().max(200).optional(),
  sizeBytes: Joi.number().integer().min(1).max(5 * 1024 * 1024).required(),
}).unknown(false);

const paginationFields = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sortBy: Joi.string()
    .valid('createdAt', 'updatedAt', 'lastMessageAt', 'priority', 'status')
    .default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
};

export const createSupportTicketSchema = {
  body: Joi.object({
    category: Joi.string()
      .valid(...Object.values(SUPPORT_TICKET_CATEGORIES))
      .required(),
    subject: Joi.string().trim().min(3).max(200).required(),
    description: Joi.string().trim().min(10).max(5000).required(),
    priority: Joi.string()
      .valid(...Object.values(SUPPORT_TICKET_PRIORITIES))
      .optional(),
    relatedReservation: objectId.optional(),
    relatedPayment: objectId.optional(),
    attachments: Joi.array().items(attachmentSchema).max(5).optional(),
  }).unknown(false),
};

export const listSupportTicketsQuerySchema = {
  query: Joi.object({
    ...paginationFields,
    status: Joi.string()
      .valid(...Object.values(SUPPORT_TICKET_STATUSES))
      .optional(),
    category: Joi.string()
      .valid(...Object.values(SUPPORT_TICKET_CATEGORIES))
      .optional(),
    priority: Joi.string()
      .valid(...Object.values(SUPPORT_TICKET_PRIORITIES))
      .optional(),
  }).unknown(false),
};

export const supportTicketIdParamSchema = {
  params: Joi.object({
    ticketId: objectId.required(),
  }).unknown(false),
};

export const addSupportTicketMessageSchema = {
  params: Joi.object({
    ticketId: objectId.required(),
  }).unknown(false),
  body: Joi.object({
    message: Joi.string().trim().min(1).max(5000).required(),
    attachments: Joi.array().items(attachmentSchema).max(5).optional(),
  }).unknown(false),
};

export const listAdminSupportTicketsQuerySchema = {
  query: Joi.object({
    ...paginationFields,
    status: Joi.string()
      .valid(...Object.values(SUPPORT_TICKET_STATUSES))
      .optional(),
    category: Joi.string()
      .valid(...Object.values(SUPPORT_TICKET_CATEGORIES))
      .optional(),
    priority: Joi.string()
      .valid(...Object.values(SUPPORT_TICKET_PRIORITIES))
      .optional(),
    assignedTo: objectId.optional(),
    createdBy: objectId.optional(),
    search: Joi.string().trim().max(120).optional(),
  }).unknown(false),
};

export const assignSupportTicketSchema = {
  params: Joi.object({
    ticketId: objectId.required(),
  }).unknown(false),
  body: Joi.object({
    assigneeId: objectId.required(),
  }).unknown(false),
};

export const updateSupportTicketStatusSchema = {
  params: Joi.object({
    ticketId: objectId.required(),
  }).unknown(false),
  body: Joi.object({
    status: Joi.string()
      .valid(...Object.values(SUPPORT_TICKET_STATUSES))
      .required(),
  }).unknown(false),
};

export const updateSupportTicketPrioritySchema = {
  params: Joi.object({
    ticketId: objectId.required(),
  }).unknown(false),
  body: Joi.object({
    priority: Joi.string()
      .valid(...Object.values(SUPPORT_TICKET_PRIORITIES))
      .required(),
  }).unknown(false),
};

export const addAdminSupportTicketMessageSchema = {
  params: Joi.object({
    ticketId: objectId.required(),
  }).unknown(false),
  body: Joi.object({
    message: Joi.string().trim().min(1).max(5000).required(),
    attachments: Joi.array().items(attachmentSchema).max(5).optional(),
  }).unknown(false),
};

export const addAdminSupportTicketNoteSchema = {
  params: Joi.object({
    ticketId: objectId.required(),
  }).unknown(false),
  body: Joi.object({
    message: Joi.string().trim().min(1).max(5000).required(),
    attachments: Joi.array().items(attachmentSchema).max(5).optional(),
  }).unknown(false),
};
