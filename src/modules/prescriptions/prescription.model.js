import mongoose from 'mongoose';
import {
  PRESCRIPTION_ACCESS_LEVEL,
  PRESCRIPTION_VERIFICATION_STATUS,
} from '../../constants/database.enums.js';

const { Schema } = mongoose;

/**
 * Prescription metadata only — binary files stay in private object storage.
 * Never expose file URLs publicly; access is enforced in controllers for authorized pharmacy staff and workflows.
 */
const prescriptionSchema = new Schema(
  {
    customer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Customer reference is required'],
      index: true,
    },
    reservation: {
      type: Schema.Types.ObjectId,
      ref: 'Reservation',
      index: true,
    },
    fileUrl: {
      type: String,
      trim: true,
      select: false,
    },
    fileKey: {
      type: String,
      required: [true, 'Private file key is required'],
      trim: true,
      select: false,
    },
    fileType: {
      type: String,
      required: [true, 'File type is required'],
      trim: true,
      maxlength: 120,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
    verificationStatus: {
      type: String,
      enum: {
        values: Object.values(PRESCRIPTION_VERIFICATION_STATUS),
        message: 'Invalid prescription verification status',
      },
      default: PRESCRIPTION_VERIFICATION_STATUS.PENDING,
      index: true,
    },
    verifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    verifiedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    accessLevel: {
      type: String,
      enum: {
        values: Object.values(PRESCRIPTION_ACCESS_LEVEL),
        message: 'Invalid prescription access level',
      },
      default: PRESCRIPTION_ACCESS_LEVEL.PHARMACY_ASSIGNED,
    },
  },
  { timestamps: true }
);

prescriptionSchema.index({ customer: 1, uploadedAt: -1 }, { name: 'prescription_customer_uploaded' });
prescriptionSchema.index(
  { verificationStatus: 1, uploadedAt: -1 },
  { name: 'prescription_verification_uploaded' }
);
prescriptionSchema.index({ reservation: 1 }, { sparse: true, name: 'prescription_reservation_sparse' });

export const Prescription =
  mongoose.models.Prescription || mongoose.model('Prescription', prescriptionSchema);
