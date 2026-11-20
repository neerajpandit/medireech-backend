import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { authorizeRoles } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  addSupportTicketMessage,
  createSupportTicket,
  getMySupportTicketById,
  listMySupportTickets,
  reopenSupportTicket,
} from './support.controller.js';
import {
  addSupportTicketMessageSchema,
  createSupportTicketSchema,
  listSupportTicketsQuerySchema,
  supportTicketIdParamSchema,
} from './support.validation.js';

export const supportRouter = Router();

/**
 * @openapi
 * tags:
 *   name: Support
 *   description: Customer and pharmacy support tickets
 */

/**
 * @openapi
 * /support/tickets:
 *   post:
 *     tags: [Support]
 *     summary: Create a support ticket
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [category, subject, description]
 *             properties:
 *               category:
 *                 type: string
 *               subject:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Ticket created
 */
supportRouter.post(
  '/tickets',
  authenticate,
  authorizeRoles('CUSTOMER', 'PHARMACY_OWNER'),
  validate(createSupportTicketSchema),
  asyncHandler(createSupportTicket)
);

/**
 * @openapi
 * /support/tickets:
 *   get:
 *     tags: [Support]
 *     summary: List own support tickets
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Ticket list
 */
supportRouter.get(
  '/tickets',
  authenticate,
  authorizeRoles('CUSTOMER', 'PHARMACY_OWNER'),
  validate(listSupportTicketsQuerySchema),
  asyncHandler(listMySupportTickets)
);

supportRouter.get(
  '/tickets/:ticketId',
  authenticate,
  authorizeRoles('CUSTOMER', 'PHARMACY_OWNER'),
  validate(supportTicketIdParamSchema),
  asyncHandler(getMySupportTicketById)
);

supportRouter.post(
  '/tickets/:ticketId/messages',
  authenticate,
  authorizeRoles('CUSTOMER', 'PHARMACY_OWNER'),
  validate(addSupportTicketMessageSchema),
  asyncHandler(addSupportTicketMessage)
);

supportRouter.post(
  '/tickets/:ticketId/reopen',
  authenticate,
  authorizeRoles('CUSTOMER', 'PHARMACY_OWNER'),
  validate(supportTicketIdParamSchema),
  asyncHandler(reopenSupportTicket)
);
