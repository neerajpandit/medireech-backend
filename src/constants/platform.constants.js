export const PLATFORM_AUDIT_ACTIONS = Object.freeze({
  CUSTOMER_BLOCKED: 'CUSTOMER_BLOCKED',
  CUSTOMER_UNBLOCKED: 'CUSTOMER_UNBLOCKED',
  OPERATIONS_ADMIN_CREATED: 'OPERATIONS_ADMIN_CREATED',
  OPERATIONS_ADMIN_STATUS_UPDATED: 'OPERATIONS_ADMIN_STATUS_UPDATED',
  OPERATIONS_ADMIN_PERMISSIONS_UPDATED: 'OPERATIONS_ADMIN_PERMISSIONS_UPDATED',
});

/** Permissions Operations Admin accounts may be granted (never includes platform:admin:full). */
export const OPERATIONS_ADMIN_ASSIGNABLE_PERMISSIONS = Object.freeze([
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
  'support:tickets:read:platform',
  'support:tickets:manage',
]);
