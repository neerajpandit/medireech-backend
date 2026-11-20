import mongoose from 'mongoose';
import { DOSAGE_FORMS, PRESCRIPTION_TYPES } from '../../constants/database.enums.js';

const { Schema } = mongoose;

/**
 * Global medicine catalogue entry. Price and stock live in Inventory, not here.
 */
const medicineSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Medicine name is required'],
      trim: true,
      maxlength: 200,
    },
    genericName: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    brandName: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    manufacturer: {
      type: String,
      trim: true,
      maxlength: 160,
    },
    composition: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    strength: {
      type: String,
      trim: true,
      maxlength: 80,
    },
    dosageForm: {
      type: String,
      enum: {
        values: Object.values(DOSAGE_FORMS),
        message: 'Invalid dosage form',
      },
      required: [true, 'Dosage form is required'],
    },
    packSize: {
      type: String,
      trim: true,
      maxlength: 80,
    },
    unit: {
      type: String,
      trim: true,
      maxlength: 40,
    },
    medicineCategory: {
      type: String,
      trim: true,
      maxlength: 80,
      index: true,
    },
    prescriptionType: {
      type: String,
      enum: {
        values: Object.values(PRESCRIPTION_TYPES),
        message: 'Invalid prescription type',
      },
      required: [true, 'Prescription type is required'],
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    image: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    searchKeywords: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

medicineSchema.index(
  {
    name: 'text',
    genericName: 'text',
    brandName: 'text',
    composition: 'text',
    searchKeywords: 'text',
  },
  {
    name: 'medicine_search_text',
    weights: {
      name: 10,
      genericName: 8,
      brandName: 6,
      composition: 5,
      searchKeywords: 4,
    },
  }
);

medicineSchema.index(
  { name: 1, strength: 1, dosageForm: 1, packSize: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
    name: 'medicine_catalogue_dedupe_active',
  }
);

medicineSchema.index({ genericName: 1, brandName: 1 }, { name: 'medicine_generic_brand' });
medicineSchema.index({ isActive: 1, prescriptionType: 1 }, { name: 'medicine_active_prescription_type' });
medicineSchema.index({ manufacturer: 1, isActive: 1 }, { name: 'medicine_manufacturer_active' });
medicineSchema.index({ dosageForm: 1, isActive: 1 }, { name: 'medicine_dosage_form_active' });

const normalizeSearchToken = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

medicineSchema.pre('save', function normalizeMedicineSearchFields() {
  const keywordSet = new Set((this.searchKeywords || []).map(normalizeSearchToken).filter(Boolean));

  for (const value of [this.name, this.genericName, this.brandName, this.manufacturer, this.composition]) {
    const token = normalizeSearchToken(value);
    if (token) {
      keywordSet.add(token);
    }
  }

  this.searchKeywords = [...keywordSet];
});

export const Medicine = mongoose.models.Medicine || mongoose.model('Medicine', medicineSchema);
