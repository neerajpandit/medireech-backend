import mongoose from 'mongoose';
import {
  PHARMACY_OPERATIONAL_STATUS,
  PHARMACY_VERIFICATION_STATUS,
} from '../../constants/database.enums.js';
import {
  normalizeEmail,
  normalizeIndianMobile,
  validateEmail,
  validateGeoJsonPoint,
  validateGstNumber,
  validateIndianMobile,
  validatePincode,
} from '../../utils/schemaValidators.js';

const { Schema } = mongoose;

const addressSchema = new Schema(
  {
    addressLine: {
      type: String,
      required: [true, 'Address line is required'],
      trim: true,
      maxlength: 300,
    },
    landmark: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
      maxlength: 80,
    },
    district: {
      type: String,
      required: [true, 'District is required'],
      trim: true,
      maxlength: 80,
    },
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true,
      maxlength: 80,
    },
    pincode: {
      type: String,
      required: [true, 'Pincode is required'],
      trim: true,
      validate: {
        validator: validatePincode,
        message: 'Pincode must be a valid 6-digit Indian pincode',
      },
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      trim: true,
      default: 'India',
      maxlength: 80,
    },
  },
  { _id: false }
);

const openingHoursSchema = new Schema(
  {
    dayOfWeek: {
      type: Number,
      required: true,
      min: 0,
      max: 6,
    },
    opensAt: {
      type: String,
      trim: true,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'opensAt must be in HH:mm format'],
    },
    closesAt: {
      type: String,
      trim: true,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'closesAt must be in HH:mm format'],
    },
    isClosed: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const verificationDocumentSchema = new Schema(
  {
    documentType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    fileKey: {
      type: String,
      required: true,
      trim: true,
      select: false,
    },
    fileType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    fileUrl: {
      type: String,
      trim: true,
      select: false,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const applicationHistorySchema = new Schema(
  {
    eventType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    verificationStatus: {
      type: String,
      enum: Object.values(PHARMACY_VERIFICATION_STATUS),
    },
    operationalStatus: {
      type: String,
      enum: Object.values(PHARMACY_OPERATIONAL_STATUS),
    },
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const superAdminFlagSchema = new Schema(
  {
    isFlagged: {
      type: Boolean,
      default: false,
    },
    flaggedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    flaggedAt: {
      type: Date,
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  { _id: false }
);

/**
 * Pharmacy profile. Final approval is restricted to SUPER_ADMIN in application logic.
 * verificationStatus and operationalStatus are independent — unverified pharmacies must not be treated as operational.
 */
const pharmacySchema = new Schema(
  {
    pharmacyName: {
      type: String,
      required: [true, 'Pharmacy name is required'],
      trim: true,
      maxlength: 160,
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Pharmacy owner is required'],
    },
    pharmacyCode: {
      type: String,
      required: [true, 'Pharmacy code is required'],
      trim: true,
      uppercase: true,
      maxlength: 32,
    },
    registrationNumber: {
      type: String,
      required: [true, 'Registration number is required'],
      trim: true,
      maxlength: 80,
    },
    drugLicenseNumber: {
      type: String,
      required: [true, 'Drug license number is required'],
      trim: true,
      maxlength: 80,
    },
    gstNumber: {
      type: String,
      trim: true,
      uppercase: true,
      validate: {
        validator: validateGstNumber,
        message: 'GST number format is invalid',
      },
    },
    phone: {
      type: String,
      required: [true, 'Pharmacy phone is required'],
      trim: true,
      set: normalizeIndianMobile,
      validate: {
        validator: validateIndianMobile,
        message: 'Pharmacy phone must be a valid 10-digit Indian mobile number',
      },
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      set: normalizeEmail,
      validate: {
        validator: validateEmail,
        message: 'Pharmacy email must be valid',
      },
    },
    address: {
      type: addressSchema,
      required: [true, 'Pharmacy address is required'],
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        required: [true, 'Location type must be Point'],
      },
      coordinates: {
        type: [Number],
        required: [true, 'Location coordinates are required'],
        validate: {
          validator(value) {
            return validateGeoJsonPoint({ type: 'Point', coordinates: value });
          },
          message: 'Location coordinates must be [longitude, latitude] within valid ranges',
        },
      },
    },
    openingHours: {
      type: [openingHoursSchema],
      default: [],
    },
    acceptsReservations: {
      type: Boolean,
      default: true,
      index: true,
    },
    verificationStatus: {
      type: String,
      enum: {
        values: Object.values(PHARMACY_VERIFICATION_STATUS),
        message: 'Invalid pharmacy verification status',
      },
      default: PHARMACY_VERIFICATION_STATUS.PENDING,
      index: true,
    },
    operationalStatus: {
      type: String,
      enum: {
        values: Object.values(PHARMACY_OPERATIONAL_STATUS),
        message: 'Invalid pharmacy operational status',
      },
      default: PHARMACY_OPERATIONAL_STATUS.INACTIVE,
      index: true,
    },
    verificationDocuments: {
      type: [verificationDocumentSchema],
      default: [],
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    actionRequiredReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    verifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    verifiedAt: {
      type: Date,
    },
    requestedDocuments: {
      type: [String],
      default: [],
    },
    applicationHistory: {
      type: [applicationHistorySchema],
      default: [],
    },
    superAdminFlag: {
      type: superAdminFlagSchema,
      default: () => ({ isFlagged: false }),
    },
  },
  { timestamps: true }
);

pharmacySchema.index({ pharmacyCode: 1 }, { unique: true, name: 'pharmacy_code_unique' });
pharmacySchema.index({ owner: 1 }, { unique: true, name: 'pharmacy_owner_unique' });
pharmacySchema.index({ registrationNumber: 1 }, { unique: true, name: 'pharmacy_registration_unique' });
pharmacySchema.index({ drugLicenseNumber: 1 }, { unique: true, name: 'pharmacy_drug_license_unique' });
pharmacySchema.index(
  { verificationStatus: 1, operationalStatus: 1 },
  { name: 'pharmacy_verification_operational' }
);
pharmacySchema.index({ location: '2dsphere' }, { name: 'pharmacy_location_2dsphere' });
pharmacySchema.index({ 'address.city': 1, 'address.state': 1 }, { name: 'pharmacy_city_state' });
pharmacySchema.index({ pharmacyName: 'text', registrationNumber: 'text' }, { name: 'pharmacy_search_text' });
pharmacySchema.index({ createdAt: -1 }, { name: 'pharmacy_created_at' });

pharmacySchema.methods.isOperationallyPermitted = function isOperationallyPermitted() {
  return (
    this.verificationStatus === PHARMACY_VERIFICATION_STATUS.APPROVED &&
    this.operationalStatus === PHARMACY_OPERATIONAL_STATUS.ACTIVE
  );
};

export const Pharmacy = mongoose.models.Pharmacy || mongoose.model('Pharmacy', pharmacySchema);
