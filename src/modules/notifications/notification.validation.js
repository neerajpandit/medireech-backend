import Joi from 'joi';
import {
  DEVICE_PLATFORMS,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_LANGUAGES,
} from '../../constants/notification.types.js';

export const registerDeviceSchema = {
  body: Joi.object({
    token: Joi.string().trim().min(20).max(4096).required(),
    platform: Joi.string()
      .valid(...Object.values(DEVICE_PLATFORMS))
      .required(),
    deviceId: Joi.string().trim().min(1).max(128).required(),
    deviceName: Joi.string().trim().max(120).optional(),
  }).unknown(false),
};

export const deviceIdParamSchema = {
  params: Joi.object({
    deviceId: Joi.string().trim().min(1).max(128).required(),
  }),
};

export const listNotificationsQuerySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    isRead: Joi.boolean().optional(),
    type: Joi.string()
      .valid(...Object.values(NOTIFICATION_EVENT_TYPES))
      .optional(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),
};

export const notificationIdParamSchema = {
  params: Joi.object({
    notificationId: Joi.string().hex().length(24).required(),
  }),
};

export const updateNotificationPreferencesSchema = {
  body: Joi.object({
    pushEnabled: Joi.boolean().optional(),
    inAppEnabled: Joi.boolean().optional(),
    reservationUpdates: Joi.boolean().optional(),
    pharmacyUpdates: Joi.boolean().optional(),
    promotionalUpdates: Joi.boolean().optional(),
    language: Joi.string()
      .valid(...Object.values(NOTIFICATION_LANGUAGES))
      .optional(),
  })
    .min(1)
    .unknown(false),
};
