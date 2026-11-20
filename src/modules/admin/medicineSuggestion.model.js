import mongoose from 'mongoose';

const { Schema } = mongoose;

const medicineSuggestionSchema = new Schema(
  {
    pharmacy: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true, index: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    genericName: { type: String, trim: true, maxlength: 160 },
    strength: { type: String, trim: true, maxlength: 80 },
    dosageForm: { type: String, trim: true, maxlength: 80 },
    manufacturer: { type: String, trim: true, maxlength: 160 },
    notes: { type: String, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    reviewNote: { type: String, trim: true, maxlength: 500 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

export const MedicineSuggestion =
  mongoose.models.MedicineSuggestion || mongoose.model('MedicineSuggestion', medicineSuggestionSchema);
