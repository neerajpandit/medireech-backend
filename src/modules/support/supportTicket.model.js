import mongoose from 'mongoose';
import {
  SUPPORT_CREATOR_ROLES,
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
} from '../../constants/support.constants.js';

const { Schema } = mongoose;

const attachmentSchema = new Schema(
  {
    fileKey: { type: String, required: true, trim: true, maxlength: 512, select: false },
    fileType: { type: String, required: true, trim: true, maxlength: 120 },
    fileName: { type: String, trim: true, maxlength: 200 },
    sizeBytes: { type: Number, min: 1, max: 5 * 1024 * 1024 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const supportTicketSchema = new Schema(
  {
    ticketNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 32,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    creatorRole: {
      type: String,
      enum: Object.values(SUPPORT_CREATOR_ROLES),
      required: true,
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    category: {
      type: String,
      enum: Object.values(SUPPORT_TICKET_CATEGORIES),
      required: true,
      index: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    priority: {
      type: String,
      enum: Object.values(SUPPORT_TICKET_PRIORITIES),
      default: SUPPORT_TICKET_PRIORITIES.MEDIUM,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(SUPPORT_TICKET_STATUSES),
      default: SUPPORT_TICKET_STATUSES.OPEN,
      index: true,
    },
    relatedReservation: {
      type: Schema.Types.ObjectId,
      ref: 'Reservation',
      index: true,
    },
    relatedPayment: {
      type: Schema.Types.ObjectId,
      ref: 'Payment',
      index: true,
    },
    attachments: {
      type: [attachmentSchema],
      default: [],
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    resolvedAt: {
      type: Date,
    },
    closedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

supportTicketSchema.index({ ticketNumber: 1 }, { unique: true, name: 'support_ticket_number_unique' });
supportTicketSchema.index({ createdBy: 1, status: 1, createdAt: -1 }, { name: 'support_ticket_creator_status_created' });
supportTicketSchema.index({ assignedTo: 1, status: 1, priority: 1 }, { name: 'support_ticket_assignee_queue' });
supportTicketSchema.index({ status: 1, priority: 1, createdAt: -1 }, { name: 'support_ticket_status_priority_created' });

export const SupportTicket =
  mongoose.models.SupportTicket || mongoose.model('SupportTicket', supportTicketSchema);
