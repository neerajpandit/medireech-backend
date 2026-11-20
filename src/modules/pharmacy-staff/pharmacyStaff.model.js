import mongoose from 'mongoose';
import { EMPLOYMENT_STATUS } from '../../constants/database.enums.js';

const { Schema } = mongoose;

/**
 * Links a user to a pharmacy workforce record. Staff access is limited to the assigned pharmacy.
 * Duplicate active memberships for the same user and pharmacy are prevented via a partial unique index.
 */
const pharmacyStaffSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Staff user reference is required'],
      index: true,
    },
    pharmacy: {
      type: Schema.Types.ObjectId,
      ref: 'Pharmacy',
      required: [true, 'Pharmacy reference is required'],
      index: true,
    },
    designation: {
      type: String,
      required: [true, 'Designation is required'],
      trim: true,
      maxlength: 80,
    },
    permissions: {
      type: [String],
      default: [],
      validate: {
        validator: (value) => Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim()),
        message: 'Permissions must be an array of strings',
      },
    },
    employmentStatus: {
      type: String,
      enum: {
        values: Object.values(EMPLOYMENT_STATUS),
        message: 'Invalid employment status',
      },
      default: EMPLOYMENT_STATUS.ACTIVE,
      index: true,
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

pharmacyStaffSchema.index({ pharmacy: 1, employmentStatus: 1 }, { name: 'pharmacy_staff_pharmacy_status' });
pharmacyStaffSchema.index({ user: 1, employmentStatus: 1 }, { name: 'pharmacy_staff_user_status' });
pharmacyStaffSchema.index(
  { user: 1, pharmacy: 1 },
  {
    unique: true,
    partialFilterExpression: { employmentStatus: EMPLOYMENT_STATUS.ACTIVE },
    name: 'pharmacy_staff_active_membership_unique',
  }
);

export const PharmacyStaff =
  mongoose.models.PharmacyStaff || mongoose.model('PharmacyStaff', pharmacyStaffSchema);
