import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Append-only audit trail for sensitive administrative and pharmacy actions.
 * Application code must not update or delete audit records.
 * Do not store passwords, OTPs, tokens, or prescription file contents in previousValues/newValues/metadata.
 */
const auditLogSchema = new Schema(
  {
    actor: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Actor reference is required'],
      index: true,
    },
    action: {
      type: String,
      required: [true, 'Audit action is required'],
      trim: true,
      maxlength: 120,
      index: true,
    },
    resourceType: {
      type: String,
      required: [true, 'Resource type is required'],
      trim: true,
      maxlength: 80,
      index: true,
    },
    resourceId: {
      type: Schema.Types.ObjectId,
      required: [true, 'Resource ID is required'],
      index: true,
    },
    pharmacy: {
      type: Schema.Types.ObjectId,
      ref: 'Pharmacy',
      index: true,
    },
    previousValues: {
      type: Schema.Types.Mixed,
    },
    newValues: {
      type: Schema.Types.Mixed,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
      trim: true,
      maxlength: 64,
    },
    userAgent: {
      type: String,
      trim: true,
      maxlength: 512,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
      index: true,
    },
  },
  {
    timestamps: false,
    strict: true,
  }
);

auditLogSchema.index({ actor: 1, createdAt: -1 }, { name: 'audit_actor_created' });
auditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 }, { name: 'audit_resource_created' });
auditLogSchema.index({ pharmacy: 1, createdAt: -1 }, { name: 'audit_pharmacy_created', sparse: true });
auditLogSchema.index({ action: 1, createdAt: -1 }, { name: 'audit_action_created' });

export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
