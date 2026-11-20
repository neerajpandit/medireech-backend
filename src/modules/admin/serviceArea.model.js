import mongoose from 'mongoose';

const { Schema } = mongoose;

const serviceAreaSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    country: { type: String, trim: true, default: 'India', maxlength: 80 },
    state: { type: String, required: true, trim: true, maxlength: 80 },
    district: { type: String, trim: true, maxlength: 80 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 500 },
    pinCodes: { type: [String], default: [] },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true },
    customerSearchEnabled: { type: Boolean, default: true },
    pharmacyOnboardingAllowed: { type: Boolean, default: true },
  },
  { timestamps: true }
);

serviceAreaSchema.index({ name: 1 }, { unique: true });

export const ServiceArea = mongoose.models.ServiceArea || mongoose.model('ServiceArea', serviceAreaSchema);
