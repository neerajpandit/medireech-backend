import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/authenticate.middleware.js';
import {
  getActiveSessions,
  getCurrentUser,
  loginWithUsername,
  logout,
  logoutAll,
  refreshAccessToken,
  revokeSession,
  sendCustomerOtp,
  verifyCustomerOtp,
} from './auth.controller.js';
import {
  loginSchema,
  refreshTokenSchema,
  revokeSessionSchema,
  sendCustomerOtpSchema,
  verifyCustomerOtpSchema,
} from './auth.validation.js';

export const authRouter = Router();

authRouter.post('/customer/send-otp', validate(sendCustomerOtpSchema), asyncHandler(sendCustomerOtp));
authRouter.post(
  '/customer/verify-otp',
  validate(verifyCustomerOtpSchema),
  asyncHandler(verifyCustomerOtp)
);
authRouter.post('/login', validate(loginSchema), asyncHandler(loginWithUsername));
authRouter.post('/refresh', validate(refreshTokenSchema), asyncHandler(refreshAccessToken));
authRouter.post('/logout', authenticate, asyncHandler(logout));
authRouter.post('/logout-all', authenticate, asyncHandler(logoutAll));
authRouter.get('/me', authenticate, asyncHandler(getCurrentUser));
authRouter.get('/sessions', authenticate, asyncHandler(getActiveSessions));
authRouter.delete(
  '/sessions/:sessionId',
  authenticate,
  validate(revokeSessionSchema),
  asyncHandler(revokeSession)
);
