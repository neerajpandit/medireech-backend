import mongoose from 'mongoose';
import {
  RESERVATION_PHARMACY_RESPONSE_SLA_MINUTES,
  RESERVATION_STATUS,
} from '../../constants/database.enums.js';
import { PAYMENT_METHODS, PAYMENT_STATUS } from '../../constants/payment.constants.js';

const { Schema } = mongoose;

/**
 * Reservation lifecycle rules (enforced in controllers with transactions in later phases):
 * - Pharmacy response SLA: exactly 15 minutes from creation while status is PENDING.
 * - PENDING reservations do not hold stock.
 * - expiresAt is set at creation; expiry and acceptance must be race-safe and idempotent.
 * - Stock is held only after pharmacy acceptance using atomic inventory updates.
 */
const batchAllocationSchema = new Schema(
  {
    batchId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    batchNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Batch allocation quantity must be at least 1'],
    },
    unitPrice: {
      type: Number,
      required: true,
      min: [0, 'Batch allocation unit price cannot be negative'],
    },
  },
  { _id: false }
);

const reservationItemSchema = new Schema(
  {
    medicine: {
      type: Schema.Types.ObjectId,
      ref: 'Medicine',
      required: true,
    },
    inventory: {
      type: Schema.Types.ObjectId,
      ref: 'Inventory',
      required: true,
    },
    medicineName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    strength: {
      type: String,
      trim: true,
      maxlength: 80,
    },
    dosageForm: {
      type: String,
      trim: true,
      maxlength: 40,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Item quantity must be at least 1'],
    },
    unitPrice: {
      type: Number,
      required: true,
      min: [0, 'Item unit price cannot be negative'],
    },
    mrpAtRequest: {
      type: Number,
      min: [0, 'MRP snapshot cannot be negative'],
    },
    acceptedUnitPrice: {
      type: Number,
      min: [0, 'Accepted unit price cannot be negative'],
    },
    batchAllocations: {
      type: [batchAllocationSchema],
      default: [],
    },
  },
  { _id: true }
);

const statusHistorySchema = new Schema(
  {
    status: {
      type: String,
      enum: {
        values: Object.values(RESERVATION_STATUS),
        message: 'Invalid reservation status in history',
      },
      required: true,
    },
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    actorRole: {
      type: String,
      trim: true,
      maxlength: 40,
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const reservationSchema = new Schema(
  {
    reservationCode: {
      type: String,
      required: [true, 'Reservation code is required'],
      trim: true,
      uppercase: true,
      maxlength: 32,
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Customer reference is required'],
      index: true,
    },
    pharmacy: {
      type: Schema.Types.ObjectId,
      ref: 'Pharmacy',
      required: [true, 'Pharmacy reference is required'],
      index: true,
    },
    items: {
      type: [reservationItemSchema],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: 'At least one reservation item is required',
      },
    },
    prescription: {
      type: Schema.Types.ObjectId,
      ref: 'Prescription',
    },
    status: {
      type: String,
      enum: {
        values: Object.values(RESERVATION_STATUS),
        message: 'Invalid reservation status',
      },
      default: RESERVATION_STATUS.PENDING,
      index: true,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    customerNote: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    pharmacyNote: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    expiresAt: {
      type: Date,
      required: [true, 'Reservation expiry time is required'],
      index: true,
    },
    confirmedAt: {
      type: Date,
    },
    rejectedAt: {
      type: Date,
    },
    rejectedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    readyAt: {
      type: Date,
    },
    collectedAt: {
      type: Date,
    },
    collectedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    cancelledAt: {
      type: Date,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 128,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PAYMENT_METHODS),
      default: PAYMENT_METHODS.PAY_AT_PHARMACY,
    },
    /** Denormalized mirror of Payment.status — Payment document is authoritative. */
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.NOT_REQUIRED,
      index: true,
    },
    /** Total payable in paise from confirmed item price snapshots. */
    totalAmount: {
      type: Number,
      min: 0,
    },
    paidAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    paymentDeadline: {
      type: Date,
      index: true,
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },
  },
  { timestamps: true }
);

reservationSchema.index({ reservationCode: 1 }, { unique: true, name: 'reservation_code_unique' });
reservationSchema.index({ customer: 1, createdAt: -1 }, { name: 'reservation_customer_created' });
reservationSchema.index({ pharmacy: 1, status: 1, createdAt: -1 }, { name: 'reservation_pharmacy_status_created' });
reservationSchema.index({ status: 1, expiresAt: 1 }, { name: 'reservation_status_expires' });
reservationSchema.index({ pharmacy: 1, status: 1, expiresAt: 1 }, { name: 'reservation_pharmacy_status_expires' });
reservationSchema.index(
  { customer: 1, idempotencyKey: 1 },
  { unique: true, sparse: true, name: 'reservation_customer_idempotency' }
);

/**
 * Returns UTC expiry based on the 15-minute pharmacy response SLA.
 */
reservationSchema.statics.buildPendingExpiry = function buildPendingExpiry(fromDate = new Date()) {
  return new Date(fromDate.getTime() + RESERVATION_PHARMACY_RESPONSE_SLA_MINUTES * 60 * 1000);
};

export const Reservation =
  mongoose.models.Reservation || mongoose.model('Reservation', reservationSchema);
