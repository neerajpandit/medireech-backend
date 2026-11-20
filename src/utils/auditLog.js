import { AuditLog } from '../modules/audit-logs/auditLog.model.js';

export const recordAuditLog = async ({
  actorId,
  action,
  resourceType,
  resourceId,
  pharmacyId,
  previousValues,
  newValues,
  metadata,
  req,
}) => {
  const ipAddress = req?.ip;
  const userAgent = req?.get?.('user-agent') || undefined;

  return AuditLog.create({
    actor: actorId,
    action,
    resourceType,
    resourceId,
    pharmacy: pharmacyId,
    previousValues,
    newValues,
    metadata,
    ipAddress,
    userAgent,
  });
};
