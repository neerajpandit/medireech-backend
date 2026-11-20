import mongoose from 'mongoose';
import { OTP_PURPOSE } from '../../constants/auth.constants.js';

const { Schema } = mongoose;

const otpSchema = new Schema(
  {
    mobileNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    otpHash: {
      type: String,
      required: true,
      select: false,
    },
    purpose: {
      type: String,
      enum: Object.values(OTP_PURPOSE),
      default: OTP_PURPOSE.CUSTOMER_LOGIN,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
      min: 1,
    },
    consumedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

otpSchema.index({ mobileNumber: 1, purpose: 1, createdAt: -1 }, { name: 'otp_mobile_purpose_created' });

export const Otp = mongoose.models.Otp || mongoose.model('Otp', otpSchema);
