import mongoose from 'mongoose';

const { Schema } = mongoose;

const platformSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    reservationSlaMinutes: { type: Number, default: 15 },
    customerSearchEnabled: { type: Boolean, default: true },
    pharmacyOnboardingEnabled: { type: Boolean, default: true },
    supportEnabled: { type: Boolean, default: true },
    maintenanceMode: { type: Boolean, default: false },
    notes: { type: String, trim: true, maxlength: 500 },
    sections: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const PlatformSettings =
  mongoose.models.PlatformSettings || mongoose.model('PlatformSettings', platformSettingsSchema);
