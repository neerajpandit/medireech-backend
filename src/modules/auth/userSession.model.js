import mongoose from 'mongoose';

const { Schema } = mongoose;

const userSessionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    refreshTokenHash: {
      type: String,
      required: true,
      select: false,
    },
    ipAddress: {
      type: String,
      trim: true,
      maxlength: 64,
    },
    userAgent: {
      type: String,
      trim: true,
      maxlength: 512,
    },
    deviceLabel: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
    revokedAt: {
      type: Date,
    },
    isRevoked: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

userSessionSchema.index({ user: 1, isRevoked: 1, createdAt: -1 }, { name: 'session_user_active_created' });

export const UserSession = mongoose.models.UserSession || mongoose.model('UserSession', userSessionSchema);
