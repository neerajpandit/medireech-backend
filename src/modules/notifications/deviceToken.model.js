import mongoose from 'mongoose';
import { DEVICE_PLATFORMS } from '../../constants/notification.types.js';

const { Schema } = mongoose;

const deviceTokenSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      trim: true,
      select: false,
    },
    platform: {
      type: String,
      enum: Object.values(DEVICE_PLATFORMS),
      required: true,
    },
    deviceId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },
    deviceName: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

deviceTokenSchema.index({ user: 1, deviceId: 1 }, { unique: true, name: 'device_token_user_device' });
deviceTokenSchema.index({ user: 1, isActive: 1 }, { name: 'device_token_user_active' });

export const DeviceToken =
  mongoose.models.DeviceToken || mongoose.model('DeviceToken', deviceTokenSchema);
