import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { authorize, authorizeRoles } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  addAdminSupportTicketMessage,
  addAdminSupportTicketNote,
  assignAdminSupportTicket,
  getAdminSupportTicketById,
  getAdminSupportTicketHistory,
  listAdminSupportTickets,
  updateAdminSupportTicketPriority,
  updateAdminSupportTicketStatus,
} from './support.admin.controller.js';
import {
  addAdminSupportTicketMessageSchema,
  addAdminSupportTicketNoteSchema,
  assignSupportTicketSchema,
  listAdminSupportTicketsQuerySchema,
  supportTicketIdParamSchema,
  updateSupportTicketPrioritySchema,
  updateSupportTicketStatusSchema,
} from './support.validation.js';

export const supportAdminRouter = Router();

/**
 * @openapi
 * tags:
 *   name: Admin Support
 *   description: Platform support ticket management
 */

supportAdminRouter.get(
  '/tickets',
  authenticate,
  authorize(['support:tickets:read']),
  validate(listAdminSupportTicketsQuerySchema),
  asyncHandler(listAdminSupportTickets)
);

supportAdminRouter.get(
  '/tickets/:ticketId',
  authenticate,
  authorize(['support:tickets:read']),
  validate(supportTicketIdParamSchema),
  asyncHandler(getAdminSupportTicketById)
);

supportAdminRouter.patch(
  '/tickets/:ticketId/assign',
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  validate(assignSupportTicketSchema),
  asyncHandler(assignAdminSupportTicket)
);

supportAdminRouter.patch(
  '/tickets/:ticketId/status',
  authenticate,
  authorize(['support:tickets:manage']),
  validate(updateSupportTicketStatusSchema),
  asyncHandler(updateAdminSupportTicketStatus)
);

supportAdminRouter.patch(
  '/tickets/:ticketId/priority',
  authenticate,
  authorize(['support:tickets:manage']),
  validate(updateSupportTicketPrioritySchema),
  asyncHandler(updateAdminSupportTicketPriority)
);

supportAdminRouter.post(
  '/tickets/:ticketId/messages',
  authenticate,
  authorize(['support:tickets:manage']),
  validate(addAdminSupportTicketMessageSchema),
  asyncHandler(addAdminSupportTicketMessage)
);

supportAdminRouter.post(
  '/tickets/:ticketId/notes',
  authenticate,
  authorize(['support:tickets:manage']),
  validate(addAdminSupportTicketNoteSchema),
  asyncHandler(addAdminSupportTicketNote)
);

supportAdminRouter.get(
  '/tickets/:ticketId/history',
  authenticate,
  authorize(['support:tickets:read']),
  validate(supportTicketIdParamSchema),
  asyncHandler(getAdminSupportTicketHistory)
);
