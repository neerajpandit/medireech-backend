import bcrypt from 'bcrypt';
import { HTTP_STATUS } from '../../constants/index.js';
import { USER_ACCOUNT_STATUS, USER_ROLES } from '../../constants/database.enums.js';
import {
  OPERATIONS_ADMIN_ASSIGNABLE_PERMISSIONS,
  PLATFORM_AUDIT_ACTIONS,
} from '../../constants/platform.constants.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { recordAuditLog } from '../../utils/auditLog.js';
import { revokeAllUserSessions } from '../../utils/revokeUserSessions.js';
import { User } from '../users/user.model.js';

const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

const toOperationsAdmin = (user) => ({
  id: user._id,
  fullName: user.fullName,
  username: user.username,
  email: user.email,
  accountStatus: user.accountStatus,
  operationsPermissions: user.operationsPermissions || [],
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  lastLoginAt: user.lastLoginAt,
});

const sanitizePermissions = (permissions = []) => {
  const unique = [...new Set(permissions)];
  return unique.filter((permission) => OPERATIONS_ADMIN_ASSIGNABLE_PERMISSIONS.includes(permission));
};

export const createOperationsAdmin = async (req, res) => {
  const { fullName, username, password, email, permissions } = req.body;

  const existing = await User.findOne({ username: username.trim().toLowerCase() }).lean();
  if (existing) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Username already exists');
  }

  const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);
  const operationsPermissions = sanitizePermissions(permissions);

  const admin = await User.create({
    fullName: fullName.trim(),
    username: username.trim().toLowerCase(),
    passwordHash,
    email,
    role: USER_ROLES.OPERATIONS_ADMIN,
    accountStatus: USER_ACCOUNT_STATUS.ACTIVE,
    operationsPermissions,
  });

  await recordAuditLog({
    actorId: req.auth.userId,
    action: PLATFORM_AUDIT_ACTIONS.OPERATIONS_ADMIN_CREATED,
    resourceType: 'User',
    resourceId: admin._id,
    newValues: {
      role: admin.role,
      operationsPermissions,
    },
    req,
  });

  const response = new ApiResponse(
    HTTP_STATUS.CREATED,
    { admin: toOperationsAdmin(admin.toObject()) },
    'Operations Admin created successfully'
  );
  res.status(response.statusCode).json(response);
};

export const listOperationsAdmins = async (req, res) => {
  const { page, limit, sortOrder } = req.query;
  const skip = (page - 1) * limit;
  const sort = { createdAt: sortOrder === 'asc' ? 1 : -1 };

  const filter = { role: USER_ROLES.OPERATIONS_ADMIN };

  const [admins, total] = await Promise.all([
    User.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { admins: admins.map(toOperationsAdmin) },
    'Operations Admins fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const getOperationsAdminById = async (req, res) => {
  const admin = await User.findOne({
    _id: req.params.adminId,
    role: USER_ROLES.OPERATIONS_ADMIN,
  }).lean();

  if (!admin) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Operations Admin not found');
  }

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { admin: toOperationsAdmin(admin) },
    'Operations Admin fetched successfully'
  );
  res.status(response.statusCode).json(response);
};

export const updateOperationsAdminStatus = async (req, res) => {
  const adminId = req.params.adminId;

  if (adminId === req.auth.userId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'You cannot change your own account status');
  }

  const admin = await User.findOne({ _id: adminId, role: USER_ROLES.OPERATIONS_ADMIN }).select('+passwordHash');

  if (!admin) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Operations Admin not found');
  }

  const previousStatus = admin.accountStatus;
  admin.accountStatus = req.body.accountStatus;
  await admin.save();

  if (admin.accountStatus === USER_ACCOUNT_STATUS.BLOCKED) {
    await revokeAllUserSessions(admin._id);
  }

  await recordAuditLog({
    actorId: req.auth.userId,
    action: PLATFORM_AUDIT_ACTIONS.OPERATIONS_ADMIN_STATUS_UPDATED,
    resourceType: 'User',
    resourceId: admin._id,
    previousValues: { accountStatus: previousStatus },
    newValues: { accountStatus: admin.accountStatus },
    metadata: { reason: req.body.reason },
    req,
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { admin: toOperationsAdmin(admin.toObject()) },
    'Operations Admin status updated successfully'
  );
  res.status(response.statusCode).json(response);
};

export const updateOperationsAdminPermissions = async (req, res) => {
  const adminId = req.params.adminId;

  if (adminId === req.auth.userId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'You cannot change your own permissions');
  }

  const admin = await User.findOne({ _id: adminId, role: USER_ROLES.OPERATIONS_ADMIN }).select('+passwordHash');

  if (!admin) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Operations Admin not found');
  }

  const previousPermissions = [...(admin.operationsPermissions || [])];
  const operationsPermissions = sanitizePermissions(req.body.permissions);

  admin.operationsPermissions = operationsPermissions;
  await admin.save();

  await recordAuditLog({
    actorId: req.auth.userId,
    action: PLATFORM_AUDIT_ACTIONS.OPERATIONS_ADMIN_PERMISSIONS_UPDATED,
    resourceType: 'User',
    resourceId: admin._id,
    previousValues: { operationsPermissions: previousPermissions },
    newValues: { operationsPermissions },
    req,
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { admin: toOperationsAdmin(admin.toObject()) },
    'Operations Admin permissions updated successfully'
  );
  res.status(response.statusCode).json(response);
};
