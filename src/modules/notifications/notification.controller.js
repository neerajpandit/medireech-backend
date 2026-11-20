import { HTTP_STATUS } from '../../constants/index.js';
import { NOTIFICATION_EVENT_TYPES, NOTIFICATION_CHANNELS, NOTIFICATION_DELIVERY_STATUS, OUTBOX_STATUS } from '../../constants/notification.types.js';
import { resolveNotificationContent } from '../../constants/notification.templates.js';
import { isFcmConfigured, sendFcmToTokens } from '../../config/firebase.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { emitToPharmacy, emitToUser, mapNotificationEventToSocketEvent } from '../../socket/socketServer.js';
import { DeviceToken } from './deviceToken.model.js';
import { Notification } from './notification.model.js';
import { NotificationOutbox } from './notificationOutbox.model.js';
import { NotificationPreference } from './notificationPreference.model.js';

const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

const toPublicNotification = (notification) => ({
  id: notification._id,
  type: notification.type,
  title: notification.title,
  message: notification.message,
  data: notification.data,
  relatedResourceType: notification.relatedResourceType,
  relatedResourceId: notification.relatedResourceId,
  channel: notification.channel,
  isRead: notification.isRead,
  readAt: notification.readAt,
  deliveryStatus: notification.deliveryStatus,
  deliveredAt: notification.deliveredAt,
  createdAt: notification.createdAt,
});

const getOrCreatePreferences = async (userId) => {
  let preferences = await NotificationPreference.findOne({ user: userId });
  if (!preferences) {
    preferences = await NotificationPreference.create({ user: userId });
  }

  return preferences;
};

const shouldSendPush = (preferences, eventType) => {
  if (!preferences.pushEnabled) {
    return false;
  }

  if (eventType.startsWith('RESERVATION_')) {
    return preferences.reservationUpdates;
  }

  if (eventType.startsWith('PHARMACY_')) {
    return preferences.pharmacyUpdates;
  }

  if (eventType === NOTIFICATION_EVENT_TYPES.SYSTEM_ANNOUNCEMENT) {
    return preferences.promotionalUpdates;
  }

  if (
    eventType === NOTIFICATION_EVENT_TYPES.IMPORTANT_UPDATE ||
    eventType === NOTIFICATION_EVENT_TYPES.ACCOUNT_SECURITY_ALERT ||
    eventType === NOTIFICATION_EVENT_TYPES.ACCOUNT_STATUS_CHANGED
  ) {
    return true;
  }

  return true;
};

const buildSafeDataPayload = (payload = {}) => ({
  reservationId: payload.reservationId?.toString?.() || payload.reservationId,
  reservationCode: payload.reservationCode,
  pharmacyId: payload.pharmacyId?.toString?.() || payload.pharmacyId,
  status: payload.status,
  ticketId: payload.ticketId?.toString?.() || payload.ticketId,
  ticketNumber: payload.ticketNumber,
  subject: payload.subject,
  category: payload.category,
  priority: payload.priority,
});

export const processNotificationOutboxRecord = async (outboxRecord) => {
  const preferences = await getOrCreatePreferences(outboxRecord.recipient);
  const content = resolveNotificationContent(outboxRecord.eventType, preferences.language, outboxRecord.payload);

  let notification = null;

  if (preferences.inAppEnabled !== false) {
    notification = await Notification.findOneAndUpdate(
      {
        outboxIdempotencyKey: outboxRecord.idempotencyKey,
        recipient: outboxRecord.recipient,
      },
      {
        $setOnInsert: {
          recipient: outboxRecord.recipient,
          type: outboxRecord.eventType,
          title: content.title,
          message: content.message,
          data: buildSafeDataPayload(outboxRecord.payload),
          relatedResourceType: outboxRecord.relatedResourceType,
          relatedResourceId: outboxRecord.relatedResourceId,
          channel: NOTIFICATION_CHANNELS.BOTH,
          isRead: false,
          deliveryStatus: NOTIFICATION_DELIVERY_STATUS.PROCESSING,
          outboxIdempotencyKey: outboxRecord.idempotencyKey,
        },
      },
      { upsert: true, new: true }
    );
  }

  const socketPayload = {
    notificationId: notification?._id,
    type: outboxRecord.eventType,
    title: content.title,
    message: content.message,
    data: buildSafeDataPayload(outboxRecord.payload),
    createdAt: new Date().toISOString(),
  };

  const socketEvent = mapNotificationEventToSocketEvent(outboxRecord.eventType);
  emitToUser(outboxRecord.recipient.toString(), socketEvent, socketPayload);
  emitToUser(outboxRecord.recipient.toString(), 'notification:new', socketPayload);

  if (outboxRecord.payload?.pharmacyId) {
    emitToPharmacy(outboxRecord.payload.pharmacyId.toString(), socketEvent, socketPayload);
    emitToPharmacy(outboxRecord.payload.pharmacyId.toString(), 'notification:new', socketPayload);
  }

  let deliveryStatus = NOTIFICATION_DELIVERY_STATUS.SENT;
  let failureReason = null;

  if (shouldSendPush(preferences, outboxRecord.eventType)) {
    const devices = await DeviceToken.find({ user: outboxRecord.recipient, isActive: true }).select('+token');
    const tokens = devices.map((device) => device.token).filter(Boolean);

    if (tokens.length > 0 && isFcmConfigured()) {
      const pushResult = await sendFcmToTokens({
        tokens,
        title: content.title,
        body: content.message,
        data: buildSafeDataPayload(outboxRecord.payload),
      });

      if (pushResult.invalidTokens.length > 0) {
        await DeviceToken.updateMany(
          { user: outboxRecord.recipient, token: { $in: pushResult.invalidTokens } },
          { isActive: false }
        );
      }

      if (pushResult.successCount === 0) {
        deliveryStatus = NOTIFICATION_DELIVERY_STATUS.FAILED;
        failureReason = 'Push delivery failed';
      } else if (pushResult.failureCount > 0) {
        deliveryStatus = NOTIFICATION_DELIVERY_STATUS.PARTIALLY_SENT;
      }
    }
  }

  if (notification) {
    notification.deliveryStatus = deliveryStatus;
    notification.deliveredAt = new Date();
    if (failureReason) {
      notification.failureReason = failureReason;
    }

    await notification.save();
  }

  return notification;
};

export const processPendingNotificationOutbox = async ({ batchSize = 25, now = new Date() } = {}) => {
  const staleProcessingCutoff = new Date(now.getTime() - 5 * 60 * 1000);
  await NotificationOutbox.updateMany(
    {
      status: OUTBOX_STATUS.PROCESSING,
      updatedAt: { $lte: staleProcessingCutoff },
    },
    {
      $set: { status: OUTBOX_STATUS.PENDING },
    }
  );

  let processed = 0;

  for (let index = 0; index < batchSize; index += 1) {
    const claimed = await NotificationOutbox.findOneAndUpdate(
      {
        status: OUTBOX_STATUS.PENDING,
        $or: [{ nextRetryAt: { $exists: false } }, { nextRetryAt: { $lte: now } }],
      },
      {
        $set: { status: OUTBOX_STATUS.PROCESSING },
        $inc: { attempts: 1 },
      },
      { sort: { createdAt: 1 }, new: true }
    );

    if (!claimed) {
      break;
    }

    try {
      await processNotificationOutboxRecord(claimed);
      claimed.status = OUTBOX_STATUS.COMPLETED;
      claimed.processedAt = new Date();
      claimed.lastError = undefined;
      await claimed.save();
      processed += 1;
    } catch (error) {
      const attempts = claimed.attempts;
      const retryDelayMs = Math.min(2 ** attempts * 1000, 60_000);
      claimed.status = attempts >= 5 ? OUTBOX_STATUS.FAILED : OUTBOX_STATUS.PENDING;
      claimed.nextRetryAt = new Date(now.getTime() + retryDelayMs);
      claimed.lastError = error.message?.slice(0, 500);
      await claimed.save();
    }
  }

  return { processed };
};

export const registerDevice = async (req, res) => {
  const { token, platform, deviceId, deviceName } = req.body;

  const device = await DeviceToken.findOneAndUpdate(
    { user: req.auth.userId, deviceId },
    {
      user: req.auth.userId,
      token,
      platform,
      deviceId,
      deviceName,
      isActive: true,
      lastUsedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).select('-token');

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      device: {
        id: device._id,
        platform: device.platform,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        isActive: device.isActive,
        lastUsedAt: device.lastUsedAt,
      },
    },
    'Device registered successfully'
  );
  res.status(response.statusCode).json(response);
};

export const removeDevice = async (req, res) => {
  const device = await DeviceToken.findOneAndUpdate(
    { user: req.auth.userId, deviceId: req.params.deviceId },
    { isActive: false },
    { new: true }
  );

  if (!device) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Device not found');
  }

  const response = new ApiResponse(HTTP_STATUS.OK, null, 'Device removed successfully');
  res.status(response.statusCode).json(response);
};

export const listNotifications = async (req, res) => {
  const { page, limit, isRead, type, sortOrder } = req.query;
  const filter = { recipient: req.auth.userId };

  if (isRead != null) {
    filter.isRead = isRead;
  }

  if (type) {
    filter.type = type;
  }

  const skip = (page - 1) * limit;
  const sort = { createdAt: sortOrder === 'asc' ? 1 : -1 };

  const [notifications, total] = await Promise.all([
    Notification.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { notifications: notifications.map(toPublicNotification) },
    'Notifications fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const markNotificationRead = async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.notificationId, recipient: req.auth.userId },
    { isRead: true, readAt: new Date() },
    { new: true }
  ).lean();

  if (!notification) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Notification not found');
  }

  emitToUser(req.auth.userId, 'notification:read', { notificationId: notification._id });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { notification: toPublicNotification(notification) },
    'Notification marked as read'
  );
  res.status(response.statusCode).json(response);
};

export const markAllNotificationsRead = async (req, res) => {
  const result = await Notification.updateMany(
    { recipient: req.auth.userId, isRead: false },
    { isRead: true, readAt: new Date() }
  );

  emitToUser(req.auth.userId, 'notification:read', { all: true });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { updatedCount: result.modifiedCount },
    'All notifications marked as read'
  );
  res.status(response.statusCode).json(response);
};

export const getNotificationPreferences = async (req, res) => {
  const preferences = await getOrCreatePreferences(req.auth.userId);
  const response = new ApiResponse(HTTP_STATUS.OK, { preferences }, 'Notification preferences fetched');
  res.status(response.statusCode).json(response);
};

export const updateNotificationPreferences = async (req, res) => {
  const preferences = await NotificationPreference.findOneAndUpdate(
    { user: req.auth.userId },
    req.body,
    { upsert: true, new: true, runValidators: true }
  );

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { preferences },
    'Notification preferences updated successfully'
  );
  res.status(response.statusCode).json(response);
};
