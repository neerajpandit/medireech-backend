import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Batch-level stock for a pharmacy.
 *
 * Stock semantics:
 * - physicalQuantity: on-hand units in the batch.
 * - reservedQuantity: units held for accepted reservations (Phase 7).
 * - availableQuantity (sellable) = physicalQuantity - reservedQuantity (computed in controllers/utilities).
 *
 * Expired or inactive batches do not contribute to sellable stock.
 */
const inventoryBatchSchema = new Schema(
  {
    batchNumber: {
      type: String,
      required: [true, 'Batch number is required'],
      trim: true,
      uppercase: true,
      maxlength: 64,
    },
    manufacturingDate: {
      type: Date,
    },
    expiryDate: {
      type: Date,
      required: [true, 'Batch expiry date is required'],
    },
    physicalQuantity: {
      type: Number,
      required: [true, 'Physical quantity is required'],
      min: [0, 'Physical quantity cannot be negative'],
    },
    reservedQuantity: {
      type: Number,
      default: 0,
      min: [0, 'Reserved quantity cannot be negative'],
      validate: {
        validator(value) {
          return value <= this.physicalQuantity;
        },
        message: 'Reserved quantity cannot exceed physical quantity for the batch',
      },
    },
    unitPrice: {
      type: Number,
      required: [true, 'Unit price is required'],
      min: [0.01, 'Unit price must be positive'],
      validate: {
        validator(value) {
          return value <= this.mrp;
        },
        message: 'Unit price cannot exceed MRP',
      },
    },
    mrp: {
      type: Number,
      required: [true, 'MRP is required'],
      min: [0.01, 'MRP must be positive'],
    },
    purchasePrice: {
      type: Number,
      min: [0, 'Purchase price cannot be negative'],
      select: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true, _id: true }
);

const inventorySchema = new Schema(
  {
    pharmacy: {
      type: Schema.Types.ObjectId,
      ref: 'Pharmacy',
      required: [true, 'Pharmacy reference is required'],
      index: true,
    },
    medicine: {
      type: Schema.Types.ObjectId,
      ref: 'Medicine',
      required: [true, 'Medicine reference is required'],
      index: true,
    },
    batches: {
      type: [inventoryBatchSchema],
      default: [],
      validate: {
        validator(batches) {
          return batches.every((batch) => {
            if (batch.reservedQuantity > batch.physicalQuantity) {
              return false;
            }

            if (batch.unitPrice > batch.mrp) {
              return false;
            }

            if (batch.manufacturingDate && batch.expiryDate && batch.manufacturingDate > batch.expiryDate) {
              return false;
            }

            return true;
          });
        },
        message: 'One or more inventory batches have invalid quantity, price or date values',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastStockUpdatedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

inventorySchema.index(
  { pharmacy: 1, medicine: 1 },
  { unique: true, name: 'inventory_pharmacy_medicine_unique' }
);
inventorySchema.index({ pharmacy: 1, isActive: 1 }, { name: 'inventory_pharmacy_active' });
inventorySchema.index({ medicine: 1, isActive: 1 }, { name: 'inventory_medicine_active' });
inventorySchema.index({ 'batches.expiryDate': 1 }, { name: 'inventory_batch_expiry' });

export const Inventory = mongoose.models.Inventory || mongoose.model('Inventory', inventorySchema);
