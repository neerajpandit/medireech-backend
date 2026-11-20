import Joi from 'joi';
import { RESERVATION_STATUS, USER_ACCOUNT_STATUS } from '../../constants/database.enums.js';
import { OPERATIONS_ADMIN_ASSIGNABLE_PERMISSIONS } from '../../constants/platform.constants.js';

const paginationQuery = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
};

export const dashboardAnalyticsQuerySchema = {
  query: Joi.object({
    startDate: Joi.date().iso().required(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).required(),
    interval: Joi.string().valid('daily', 'weekly', 'monthly').default('daily'),
  }).unknown(false),
};

export const customerIdParamSchema = {
  params: Joi.object({
    customerId: Joi.string().hex().length(24).required(),
  }),
};

export const listAdminCustomersQuerySchema = {
  query: Joi.object({
    ...paginationQuery,
    sortBy: Joi.string().valid('createdAt', 'fullName', 'updatedAt').default('createdAt'),
    search: Joi.string().trim().max(120).optional(),
    accountStatus: Joi.string()
      .valid(...Object.values(USER_ACCOUNT_STATUS))
      .optional(),
    createdFrom: Joi.date().iso().optional(),
    createdTo: Joi.date().iso().optional(),
  }).unknown(false),
};

export const blockCustomerSchema = {
  ...customerIdParamSchema,
  body: Joi.object({
    reason: Joi.string().trim().min(3).max(500).required(),
  }).unknown(false),
};

export const unblockCustomerSchema = {
  ...customerIdParamSchema,
  body: Joi.object({
    reason: Joi.string().trim().min(3).max(500).optional(),
  }).unknown(false),
};

export const listCustomerReservationsQuerySchema = {
  ...customerIdParamSchema,
  query: Joi.object({
    page: paginationQuery.page,
    limit: paginationQuery.limit,
    sortOrder: paginationQuery.sortOrder,
    status: Joi.string()
      .valid(...Object.values(RESERVATION_STATUS))
      .optional(),
  }).unknown(false),
};

export const listPlatformPharmaciesQuerySchema = {
  query: Joi.object({
    ...paginationQuery,
    sortBy: Joi.string().valid('createdAt', 'pharmacyName', 'updatedAt').default('createdAt'),
    search: Joi.string().trim().max(120).optional(),
    verificationStatus: Joi.string().trim().optional(),
    operationalStatus: Joi.string().trim().optional(),
    city: Joi.string().trim().max(80).optional(),
    state: Joi.string().trim().max(80).optional(),
  }).unknown(false),
};

export const pharmacyIdParamSchema = {
  params: Joi.object({
    pharmacyId: Joi.string().hex().length(24).required(),
  }),
};

export const listPharmacyInventoryQuerySchema = {
  ...pharmacyIdParamSchema,
  query: Joi.object({
    page: paginationQuery.page,
    limit: paginationQuery.limit,
  }).unknown(false),
};

export const listPharmacyReservationsQuerySchema = {
  ...pharmacyIdParamSchema,
  query: Joi.object({
    page: paginationQuery.page,
    limit: paginationQuery.limit,
    sortOrder: paginationQuery.sortOrder,
    status: Joi.string()
      .valid(...Object.values(RESERVATION_STATUS))
      .optional(),
  }).unknown(false),
};

export const reservationIdParamSchema = {
  params: Joi.object({
    reservationId: Joi.string().hex().length(24).required(),
  }),
};

export const listAdminReservationsQuerySchema = {
  query: Joi.object({
    ...paginationQuery,
    sortBy: Joi.string().valid('createdAt', 'updatedAt', 'expiresAt').default('createdAt'),
    status: Joi.string()
      .valid(...Object.values(RESERVATION_STATUS))
      .optional(),
    customerId: Joi.string().hex().length(24).optional(),
    pharmacyId: Joi.string().hex().length(24).optional(),
    reservationCode: Joi.string().trim().max(32).optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
  }).unknown(false),
};

export const listAuditLogsQuerySchema = {
  query: Joi.object({
    ...paginationQuery,
    actor: Joi.string().hex().length(24).optional(),
    action: Joi.string().trim().max(120).optional(),
    resourceType: Joi.string().trim().max(80).optional(),
    resourceId: Joi.string().hex().length(24).optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
  }).unknown(false),
};

export const reportQuerySchema = {
  query: Joi.object({
    startDate: Joi.date().iso().required(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).required(),
    groupBy: Joi.string().valid('daily', 'weekly', 'monthly').default('daily'),
    page: paginationQuery.page,
    limit: paginationQuery.limit,
  }).unknown(false),
};

export const createOperationsAdminSchema = {
  body: Joi.object({
    fullName: Joi.string().trim().min(2).max(120).required(),
    username: Joi.string().trim().min(3).max(40).required(),
    password: Joi.string().min(8).max(128).required(),
    email: Joi.string().email().optional(),
    permissions: Joi.array()
      .items(Joi.string().valid(...OPERATIONS_ADMIN_ASSIGNABLE_PERMISSIONS))
      .optional(),
  }).unknown(false),
};

export const adminIdParamSchema = {
  params: Joi.object({
    adminId: Joi.string().hex().length(24).required(),
  }),
};

export const listOperationsAdminsQuerySchema = {
  query: Joi.object({
    page: paginationQuery.page,
    limit: paginationQuery.limit,
    sortOrder: paginationQuery.sortOrder,
  }).unknown(false),
};

export const updateOperationsAdminStatusSchema = {
  ...adminIdParamSchema,
  body: Joi.object({
    accountStatus: Joi.string()
      .valid(USER_ACCOUNT_STATUS.ACTIVE, USER_ACCOUNT_STATUS.BLOCKED)
      .required(),
    reason: Joi.string().trim().min(3).max(500).required(),
  }).unknown(false),
};

export const updateOperationsAdminPermissionsSchema = {
  ...adminIdParamSchema,
  body: Joi.object({
    permissions: Joi.array()
      .items(Joi.string().valid(...OPERATIONS_ADMIN_ASSIGNABLE_PERMISSIONS))
      .required(),
  }).unknown(false),
};
