import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { HTTP_STATUS } from '../../constants/index.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  registerDevice,
  removeDevice,
  updateNotificationPreferences,
} from './notification.controller.js';
import {
  deviceIdParamSchema,
  listNotificationsQuerySchema,
  notificationIdParamSchema,
  registerDeviceSchema,
  updateNotificationPreferencesSchema,
} from './notification.validation.js';

export const notificationRouter = Router();

const deviceRegistrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
      success: false,
      message: 'Too many device registration attempts, please try again later',
      errors: [],
      data: null,
    });
  },
});

const preferencesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
      success: false,
      message: 'Too many preference updates, please try again later',
      errors: [],
      data: null,
    });
  },
});

notificationRouter.use(authenticate);

notificationRouter.post(
  '/devices',
  deviceRegistrationLimiter,
  validate(registerDeviceSchema),
  asyncHandler(registerDevice)
);

notificationRouter.delete(
  '/devices/:deviceId',
  validate(deviceIdParamSchema),
  asyncHandler(removeDevice)
);

notificationRouter.get('/preferences', asyncHandler(getNotificationPreferences));

notificationRouter.patch(
  '/preferences',
  preferencesLimiter,
  validate(updateNotificationPreferencesSchema),
  asyncHandler(updateNotificationPreferences)
);

notificationRouter.get('/', validate(listNotificationsQuerySchema), asyncHandler(listNotifications));

notificationRouter.patch('/read-all', asyncHandler(markAllNotificationsRead));

notificationRouter.patch(
  '/:notificationId/read',
  validate(notificationIdParamSchema),
  asyncHandler(markNotificationRead)
);
