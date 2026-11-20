import { HTTP_STATUS } from '../../constants/index.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { AuditLog } from '../audit-logs/auditLog.model.js';

const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

const sanitizeMetadata = (metadata = {}) => {
  const clone = { ...metadata };
  delete clone.password;
  delete clone.passwordHash;
  delete clone.token;
  delete clone.refreshToken;
  delete clone.otp;
  return clone;
};

const toAuditEntry = (entry) => ({
  id: entry._id,
  actor: entry.actor,
  action: entry.action,
  resourceType: entry.resourceType,
  resourceId: entry.resourceId,
  pharmacy: entry.pharmacy,
  previousValues: entry.previousValues,
  newValues: entry.newValues,
  metadata: sanitizeMetadata(entry.metadata),
  createdAt: entry.createdAt,
});

export const listAdminAuditLogs = async (req, res) => {
  const { page, limit, sortOrder, actor, action, resourceType, resourceId, fromDate, toDate } =
    req.query;

  const filter = {};

  if (actor) {
    filter.actor = actor;
  }

  if (action) {
    filter.action = action;
  }

  if (resourceType) {
    filter.resourceType = resourceType;
  }

  if (resourceId) {
    filter.resourceId = resourceId;
  }

  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) {
      filter.createdAt.$gte = new Date(fromDate);
    }
    if (toDate) {
      filter.createdAt.$lte = new Date(toDate);
    }
  }

  const skip = (page - 1) * limit;
  const sort = { createdAt: sortOrder === 'asc' ? 1 : -1 };

  const [auditLogs, total] = await Promise.all([
    AuditLog.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { auditLogs: auditLogs.map(toAuditEntry) },
    'Audit logs fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};
