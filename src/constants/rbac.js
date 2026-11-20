import { USER_ROLES } from './database.enums.js';

/**
 * Role-based permission map. Authentication establishes identity; authorization checks these permissions.
 */
export const ROLE_PERMISSIONS = Object.freeze({
  [USER_ROLES.CUSTOMER]: Object.freeze([
    'reservation:create',
    'reservation:read:own',
    'payment:create:own',
    'payment:read:own',
    'payment:verify:own',
    'prescription:upload:own',
    'profile:read:own',
    'profile:update:own',
    'support:ticket:create',
    'support:ticket:read:own',
  ]),
  [USER_ROLES.PHARMACY_OWNER]: Object.freeze([
    'pharmacy:read:own',
    'pharmacy:update:own',
    'pharmacy:onboarding:own',
    'inventory:manage:own',
    'reservation:manage:own-pharmacy',
    'staff:manage:own-pharmacy',
    'prescription:verify:own-pharmacy',
    'payment:read:own-pharmacy',
    'payment:collect:own-pharmacy',
    'profile:read:own',
    'support:ticket:create',
    'support:ticket:read:own',
  ]),
  [USER_ROLES.PHARMACY_STAFF]: Object.freeze([
    'pharmacy:read:assigned',
    'inventory:manage:assigned',
    'reservation:manage:assigned-pharmacy',
    'prescription:verify:assigned-pharmacy',
    'payment:read:own-pharmacy',
    'payment:collect:own-pharmacy',
    'profile:read:own',
  ]),
  [USER_ROLES.SUPER_ADMIN]: Object.freeze(['platform:admin:full']),
  [USER_ROLES.OPERATIONS_ADMIN]: Object.freeze([
    'platform:operations:read',
    'platform:operations:manage',
    'platform:dashboard:read',
    'pharmacy:verification:review',
    'pharmacy:applications:read',
    'pharmacy:applications:flag',
    'pharmacy:read:platform',
    'customer:read:platform',
    'customer:manage:platform',
    'reservation:read:platform',
    'medicine:catalogue:manage',
    'payment:read:platform',
    'refund:read:platform',
    'audit:read',
    'support:tickets:read',
    'support:tickets:manage',
  ]),
});

export const hasPermission = (role, permission, extraPermissions = []) => {
  const permissions = ROLE_PERMISSIONS[role] || [];

  if (permissions.includes('platform:admin:full')) {
    return true;
  }

  if (extraPermissions.includes(permission)) {
    return true;
  }

  return permissions.includes(permission);
};

export const hasAnyPermission = (role, requiredPermissions = [], extraPermissions = []) =>
  requiredPermissions.some((permission) => hasPermission(role, permission, extraPermissions));

export const hasAllPermissions = (role, requiredPermissions = [], extraPermissions = []) =>
  requiredPermissions.every((permission) => hasPermission(role, permission, extraPermissions));
