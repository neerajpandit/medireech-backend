import mongoose from 'mongoose';
import { NOTIFICATION_EVENT_TYPES, OUTBOX_STATUS } from '../../constants/notification.types.js';

const { Schema } = mongoose;

const notificationOutboxSchema = new Schema(
  {
    eventType: {
      type: String,
      enum: Object.values(NOTIFICATION_EVENT_TYPES),
      required: true,
      index: true,
    },
    recipient: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },
    relatedResourceType: {
      type: String,
      trim: true,
      maxlength: 80,
    },
    relatedResourceId: {
      type: Schema.Types.ObjectId,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(OUTBOX_STATUS),
      default: OUTBOX_STATUS.PENDING,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    nextRetryAt: {
      type: Date,
      index: true,
    },
    processedAt: {
      type: Date,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 128,
    },
    lastError: {
      type: String,
      trim: true,
      maxlength: 500,
      select: false,
    },
  },
  { timestamps: true }
);

notificationOutboxSchema.index(
  { idempotencyKey: 1 },
  { unique: true, sparse: true, name: 'notification_outbox_idempotency' }
);
notificationOutboxSchema.index({ status: 1, nextRetryAt: 1, createdAt: 1 }, { name: 'notification_outbox_dispatch' });

export const NotificationOutbox =
  mongoose.models.NotificationOutbox || mongoose.model('NotificationOutbox', notificationOutboxSchema);
