import mongoose from 'mongoose';
import { NOTIFICATION_LANGUAGES } from '../../constants/notification.types.js';

const { Schema } = mongoose;

const notificationPreferenceSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    pushEnabled: {
      type: Boolean,
      default: true,
    },
    inAppEnabled: {
      type: Boolean,
      default: true,
    },
    reservationUpdates: {
      type: Boolean,
      default: true,
    },
    pharmacyUpdates: {
      type: Boolean,
      default: true,
    },
    promotionalUpdates: {
      type: Boolean,
      default: false,
    },
    language: {
      type: String,
      enum: Object.values(NOTIFICATION_LANGUAGES),
      default: NOTIFICATION_LANGUAGES.HI,
    },
  },
  { timestamps: true }
);

export const NotificationPreference =
  mongoose.models.NotificationPreference ||
  mongoose.model('NotificationPreference', notificationPreferenceSchema);
