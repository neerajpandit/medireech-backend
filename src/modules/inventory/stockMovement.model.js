import mongoose from 'mongoose';
import { STOCK_MOVEMENT_TYPES } from '../../constants/inventory.constants.js';

const { Schema } = mongoose;

/**
 * Append-only stock movement history. Reservation-related movement types are reserved for later phases.
 */
const stockMovementSchema = new Schema(
  {
    pharmacy: {
      type: Schema.Types.ObjectId,
      ref: 'Pharmacy',
      required: true,
      index: true,
    },
    inventory: {
      type: Schema.Types.ObjectId,
      ref: 'Inventory',
      required: true,
      index: true,
    },
    medicine: {
      type: Schema.Types.ObjectId,
      ref: 'Medicine',
      required: true,
      index: true,
    },
    batchId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    batchNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    movementType: {
      type: String,
      enum: Object.values(STOCK_MOVEMENT_TYPES),
      required: true,
      index: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    previousPhysicalQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
    newPhysicalQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
    previousReservedQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
    newReservedQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    referenceId: {
      type: Schema.Types.ObjectId,
      index: true,
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
      index: true,
    },
  },
  {
    timestamps: false,
    strict: true,
  }
);

stockMovementSchema.index({ pharmacy: 1, createdAt: -1 }, { name: 'stock_movement_pharmacy_created' });
stockMovementSchema.index({ inventory: 1, createdAt: -1 }, { name: 'stock_movement_inventory_created' });

export const StockMovement =
  mongoose.models.StockMovement || mongoose.model('StockMovement', stockMovementSchema);
