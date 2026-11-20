import { HTTP_STATUS } from '../constants/index.js';
import { hasAllPermissions, hasAnyPermission } from '../constants/rbac.js';
import { ApiError } from '../utils/ApiError.js';

export const authorize =
  (requiredPermissions = [], { mode = 'any' } = {}) =>
  (req, _res, next) => {
    if (!req.auth?.role) {
      next(new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Authentication is required'));
      return;
    }

    if (requiredPermissions.length === 0) {
      next();
      return;
    }

    const extraPermissions = req.auth.operationsPermissions || [];
    const allowed =
      mode === 'all'
        ? hasAllPermissions(req.auth.role, requiredPermissions, extraPermissions)
        : hasAnyPermission(req.auth.role, requiredPermissions, extraPermissions);

    if (!allowed) {
      next(new ApiError(HTTP_STATUS.FORBIDDEN, 'You do not have permission to perform this action'));
      return;
    }

    next();
  };

export const authorizeRoles =
  (...roles) =>
  (req, _res, next) => {
    if (!req.auth?.role) {
      next(new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Authentication is required'));
      return;
    }

    if (!roles.includes(req.auth.role)) {
      next(new ApiError(HTTP_STATUS.FORBIDDEN, 'You do not have permission to perform this action'));
      return;
    }

    next();
  };
