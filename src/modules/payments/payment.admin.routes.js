import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { getAdminPaymentById, listAdminPayments } from './payment.controller.js';
import { listAdminPaymentsQuerySchema, paymentIdParamSchema } from './payment.validation.js';

export const paymentAdminRouter = Router();

paymentAdminRouter.get(
  '/',
  authenticate,
  authorize(['payment:read:platform']),
  validate(listAdminPaymentsQuerySchema),
  asyncHandler(listAdminPayments)
);

paymentAdminRouter.get(
  '/:paymentId',
  authenticate,
  authorize(['payment:read:platform']),
  validate(paymentIdParamSchema),
  asyncHandler(getAdminPaymentById)
);
