import mongoose from 'mongoose';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATION_EVENT_TYPES,
} from '../../constants/notification.types.js';

const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    recipient: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(NOTIFICATION_EVENT_TYPES),
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    data: {
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
    channel: {
      type: String,
      enum: Object.values(NOTIFICATION_CHANNELS),
      default: NOTIFICATION_CHANNELS.BOTH,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
    },
    deliveryStatus: {
      type: String,
      enum: Object.values(NOTIFICATION_DELIVERY_STATUS),
      default: NOTIFICATION_DELIVERY_STATUS.PENDING,
      index: true,
    },
    deliveredAt: {
      type: Date,
    },
    failureReason: {
      type: String,
      trim: true,
      maxlength: 500,
      select: false,
    },
    outboxIdempotencyKey: {
      type: String,
      trim: true,
      maxlength: 128,
    },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, createdAt: -1 }, { name: 'notification_recipient_created' });
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 }, { name: 'notification_recipient_read_created' });
notificationSchema.index(
  { outboxIdempotencyKey: 1, recipient: 1 },
  { unique: true, sparse: true, name: 'notification_outbox_idempotency_recipient' }
);

export const Notification =
  mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
