import mongoose from 'mongoose';

const { Schema } = mongoose;

const messageAttachmentSchema = new Schema(
  {
    fileKey: { type: String, required: true, trim: true, maxlength: 512, select: false },
    fileType: { type: String, required: true, trim: true, maxlength: 120 },
    fileName: { type: String, trim: true, maxlength: 200 },
    sizeBytes: { type: Number, min: 1, max: 5 * 1024 * 1024 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const supportTicketMessageSchema = new Schema(
  {
    ticket: {
      type: Schema.Types.ObjectId,
      ref: 'SupportTicket',
      required: true,
      index: true,
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    senderRole: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    attachments: {
      type: [messageAttachmentSchema],
      default: [],
    },
    isInternalNote: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

supportTicketMessageSchema.index({ ticket: 1, createdAt: 1 }, { name: 'support_ticket_message_thread' });

export const SupportTicketMessage =
  mongoose.models.SupportTicketMessage ||
  mongoose.model('SupportTicketMessage', supportTicketMessageSchema);
