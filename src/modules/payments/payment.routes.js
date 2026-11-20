import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { HTTP_STATUS } from '../../constants/index.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { resolveReservationPharmacyContext } from '../../middlewares/reservationAccess.middleware.js';
import {
  collectCashPayment,
  createPaymentOrder,
  createRefund,
  getMyPaymentById,
  listMyPayments,
  retryPayment,
  verifyPayment,
} from './payment.controller.js';
import {
  collectCashPaymentSchema,
  createPaymentOrderSchema,
  createRefundSchema,
  listMyPaymentsQuerySchema,
  paymentIdParamSchema,
  retryPaymentSchema,
  verifyPaymentSchema,
} from './payment.validation.js';
import { authorizeRoles } from '../../middlewares/authorize.middleware.js';

export const paymentRouter = Router();

const paymentActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 40,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
      success: false,
      message: 'Too many payment requests, please try again later',
      errors: [],
      data: null,
    });
  },
});

paymentRouter.post(
  '/create-order',
  paymentActionLimiter,
  authenticate,
  authorize(['payment:create:own']),
  validate(createPaymentOrderSchema),
  asyncHandler(createPaymentOrder)
);

paymentRouter.post(
  '/verify',
  paymentActionLimiter,
  authenticate,
  authorize(['payment:verify:own']),
  validate(verifyPaymentSchema),
  asyncHandler(verifyPayment)
);

paymentRouter.get(
  '/my',
  authenticate,
  authorize(['payment:read:own']),
  validate(listMyPaymentsQuerySchema),
  asyncHandler(listMyPayments)
);

paymentRouter.get(
  '/:paymentId',
  authenticate,
  authorize(['payment:read:own']),
  validate(paymentIdParamSchema),
  asyncHandler(getMyPaymentById)
);

paymentRouter.post(
  '/:paymentId/retry',
  paymentActionLimiter,
  authenticate,
  authorize(['payment:create:own']),
  validate(retryPaymentSchema),
  asyncHandler(retryPayment)
);

paymentRouter.patch(
  '/:paymentId/collect-cash',
  authenticate,
  resolveReservationPharmacyContext,
  authorize(['payment:collect:own-pharmacy']),
  validate(collectCashPaymentSchema),
  asyncHandler(collectCashPayment)
);

paymentRouter.post(
  '/:paymentId/refund',
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  validate(createRefundSchema),
  asyncHandler(createRefund)
);
