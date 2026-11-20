import mongoose from 'mongoose';
import { WEBHOOK_PROCESSING_STATUS } from '../../constants/payment.constants.js';
import { PAYMENT_PROVIDERS } from '../../constants/payment.constants.js';

const { Schema } = mongoose;

const paymentWebhookEventSchema = new Schema(
  {
    provider: {
      type: String,
      enum: Object.values(PAYMENT_PROVIDERS),
      default: PAYMENT_PROVIDERS.RAZORPAY,
      required: true,
    },
    eventId: {
      type: String,
      required: true,
      trim: true,
    },
    eventType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    payloadHash: {
      type: String,
      trim: true,
      maxlength: 128,
    },
    processingStatus: {
      type: String,
      enum: Object.values(WEBHOOK_PROCESSING_STATUS),
      default: WEBHOOK_PROCESSING_STATUS.RECEIVED,
      index: true,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    processedAt: {
      type: Date,
    },
    failureReason: {
      type: String,
      trim: true,
      maxlength: 500,
      select: false,
    },
  },
  { timestamps: true }
);

paymentWebhookEventSchema.index(
  { provider: 1, eventId: 1 },
  { unique: true, name: 'payment_webhook_provider_event_unique' }
);

export const PaymentWebhookEvent =
  mongoose.models.PaymentWebhookEvent ||
  mongoose.model('PaymentWebhookEvent', paymentWebhookEventSchema);
