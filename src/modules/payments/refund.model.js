import mongoose from 'mongoose';
import { REFUND_STATUS } from '../../constants/payment.constants.js';

const { Schema } = mongoose;

const refundSchema = new Schema(
  {
    payment: {
      type: Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
      index: true,
    },
    reservation: {
      type: Schema.Types.ObjectId,
      ref: 'Reservation',
      required: true,
      index: true,
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    pharmacy: {
      type: Schema.Types.ObjectId,
      ref: 'Pharmacy',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, 'Refund amount must be at least 1 paise'],
    },
    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(REFUND_STATUS),
      default: REFUND_STATUS.PENDING,
      index: true,
    },
    providerRefundId: {
      type: String,
      trim: true,
      sparse: true,
      index: true,
    },
    initiatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 128,
    },
    processedAt: {
      type: Date,
    },
    failureReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  { timestamps: true }
);

refundSchema.index(
  { payment: 1, idempotencyKey: 1 },
  { unique: true, sparse: true, name: 'refund_payment_idempotency' }
);

export const Refund = mongoose.models.Refund || mongoose.model('Refund', refundSchema);
