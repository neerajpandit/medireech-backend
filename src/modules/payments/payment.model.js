import mongoose from 'mongoose';
import {
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUS,
} from '../../constants/payment.constants.js';

const { Schema } = mongoose;

const paymentSchema = new Schema(
  {
    paymentCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 32,
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
      index: true,
    },
    pharmacy: {
      type: Schema.Types.ObjectId,
      ref: 'Pharmacy',
      required: true,
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PAYMENT_METHODS),
      required: true,
    },
    provider: {
      type: String,
      enum: Object.values(PAYMENT_PROVIDERS),
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, 'Payment amount must be at least 1 paise'],
    },
    currency: {
      type: String,
      default: 'INR',
      trim: true,
      uppercase: true,
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
      index: true,
    },
    razorpayOrderId: {
      type: String,
      trim: true,
      index: true,
      sparse: true,
    },
    razorpayPaymentId: {
      type: String,
      trim: true,
      index: true,
      sparse: true,
    },
    receipt: {
      type: String,
      trim: true,
      maxlength: 40,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 128,
    },
    failureReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    paidAt: {
      type: Date,
    },
    capturedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    refundedAmountPaise: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

paymentSchema.index({ paymentCode: 1 }, { unique: true, name: 'payment_code_unique' });
paymentSchema.index(
  { reservation: 1, status: 1 },
  { name: 'payment_reservation_status' }
);
paymentSchema.index(
  { customer: 1, idempotencyKey: 1 },
  { unique: true, sparse: true, name: 'payment_customer_idempotency' }
);
paymentSchema.index(
  { razorpayOrderId: 1 },
  { unique: true, sparse: true, name: 'payment_razorpay_order_unique' }
);
paymentSchema.index(
  { razorpayPaymentId: 1 },
  { unique: true, sparse: true, name: 'payment_razorpay_payment_unique' }
);

export const Payment = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);
