import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { HTTP_STATUS } from '../../constants/index.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { authorize, authorizeRoles } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { getDashboardAnalytics, getDashboardOverview } from './dashboard.controller.js';
import {
  blockAdminCustomer,
  getAdminCustomerById,
  listAdminCustomerReservations,
  listAdminCustomers,
  unblockAdminCustomer,
} from './customer.controller.js';
import { listAdminReservations, getAdminReservationById } from './reservation.controller.js';
import { listAdminAuditLogs } from './audit.controller.js';
import {
  getCustomerReport,
  getPaymentReport,
  getPharmacyReport,
  getReservationReport,
} from './reports.controller.js';
import {
  createOperationsAdmin,
  getOperationsAdminById,
  listOperationsAdmins,
  updateOperationsAdminPermissions,
  updateOperationsAdminStatus,
} from './operationsAdmin.controller.js';
import {
  adminIdParamSchema,
  blockCustomerSchema,
  createOperationsAdminSchema,
  customerIdParamSchema,
  dashboardAnalyticsQuerySchema,
  listAdminCustomersQuerySchema,
  listAdminReservationsQuerySchema,
  listAuditLogsQuerySchema,
  listCustomerReservationsQuerySchema,
  listOperationsAdminsQuerySchema,
  reportQuerySchema,
  reservationIdParamSchema,
  unblockCustomerSchema,
  updateOperationsAdminPermissionsSchema,
  updateOperationsAdminStatusSchema,
} from './admin.validation.js';
import { listAdminRefunds, getAdminRefundById } from '../payments/payment.controller.js';
import {
  listAdminRefundsQuerySchema,
  refundIdParamSchema,
} from '../payments/payment.validation.js';
import {
  createServiceArea,
  getAdminAuditLogById,
  getMedicineSuggestion,
  getPharmacyOwner,
  getPlatformSettings,
  getServiceArea,
  invitePharmacyOwner,
  listAdminNotifications,
  listMedicineSuggestions,
  listPharmacyOwners,
  listServiceAreas,
  reviewMedicineSuggestion,
  updatePlatformSettings,
  updateServiceArea,
} from './extras.controller.js';
import {
  auditLogParamSchema,
  inviteOwnerSchema,
  listQuerySchema,
  ownerParamSchema,
  reviewSuggestionSchema,
  serviceAreaBodySchema,
  serviceAreaParamSchema,
  serviceAreaUpdateSchema,
  suggestionParamSchema,
  updatePlatformSettingsSchema,
} from './extras.validation.js';

export const adminRouter = Router();

const sensitiveAdminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
      success: false,
      message: 'Too many admin actions, please try again later',
      errors: [],
      data: null,
    });
  },
});

adminRouter.get(
  '/dashboard/overview',
  authenticate,
  authorize(['platform:dashboard:read']),
  asyncHandler(getDashboardOverview)
);

adminRouter.get(
  '/dashboard/analytics',
  authenticate,
  authorize(['platform:dashboard:read']),
  validate(dashboardAnalyticsQuerySchema),
  asyncHandler(getDashboardAnalytics)
);

adminRouter.get(
  '/customers',
  authenticate,
  authorize(['customer:read:platform']),
  validate(listAdminCustomersQuerySchema),
  asyncHandler(listAdminCustomers)
);

adminRouter.get(
  '/customers/:customerId',
  authenticate,
  authorize(['customer:read:platform']),
  validate(customerIdParamSchema),
  asyncHandler(getAdminCustomerById)
);

adminRouter.patch(
  '/customers/:customerId/block',
  sensitiveAdminLimiter,
  authenticate,
  authorize(['customer:manage:platform']),
  validate(blockCustomerSchema),
  asyncHandler(blockAdminCustomer)
);

adminRouter.patch(
  '/customers/:customerId/unblock',
  sensitiveAdminLimiter,
  authenticate,
  authorize(['customer:manage:platform']),
  validate(unblockCustomerSchema),
  asyncHandler(unblockAdminCustomer)
);

adminRouter.get(
  '/customers/:customerId/reservations',
  authenticate,
  authorize(['customer:read:platform', 'reservation:read:platform'], { mode: 'any' }),
  validate(listCustomerReservationsQuerySchema),
  asyncHandler(listAdminCustomerReservations)
);

adminRouter.get(
  '/reservations',
  authenticate,
  authorize(['reservation:read:platform']),
  validate(listAdminReservationsQuerySchema),
  asyncHandler(listAdminReservations)
);

adminRouter.get(
  '/reservations/:reservationId',
  authenticate,
  authorize(['reservation:read:platform']),
  validate(reservationIdParamSchema),
  asyncHandler(getAdminReservationById)
);

adminRouter.get(
  '/refunds',
  authenticate,
  authorize(['refund:read:platform']),
  validate(listAdminRefundsQuerySchema),
  asyncHandler(listAdminRefunds)
);

adminRouter.get(
  '/refunds/:refundId',
  authenticate,
  authorize(['refund:read:platform']),
  validate(refundIdParamSchema),
  asyncHandler(getAdminRefundById)
);

adminRouter.get(
  '/audit-logs',
  authenticate,
  authorize(['audit:read']),
  validate(listAuditLogsQuerySchema),
  asyncHandler(listAdminAuditLogs)
);

adminRouter.get(
  '/reports/reservations',
  authenticate,
  authorize(['platform:dashboard:read']),
  validate(reportQuerySchema),
  asyncHandler(getReservationReport)
);

adminRouter.get(
  '/reports/payments',
  authenticate,
  authorize(['platform:dashboard:read']),
  validate(reportQuerySchema),
  asyncHandler(getPaymentReport)
);

adminRouter.get(
  '/reports/pharmacies',
  authenticate,
  authorize(['platform:dashboard:read']),
  validate(reportQuerySchema),
  asyncHandler(getPharmacyReport)
);

adminRouter.get(
  '/reports/customers',
  authenticate,
  authorize(['platform:dashboard:read']),
  validate(reportQuerySchema),
  asyncHandler(getCustomerReport)
);

adminRouter.post(
  '/operations-admins',
  sensitiveAdminLimiter,
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  validate(createOperationsAdminSchema),
  asyncHandler(createOperationsAdmin)
);

adminRouter.get(
  '/operations-admins',
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  validate(listOperationsAdminsQuerySchema),
  asyncHandler(listOperationsAdmins)
);

adminRouter.get(
  '/operations-admins/:adminId',
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  validate(adminIdParamSchema),
  asyncHandler(getOperationsAdminById)
);

adminRouter.patch(
  '/operations-admins/:adminId/status',
  sensitiveAdminLimiter,
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  validate(updateOperationsAdminStatusSchema),
  asyncHandler(updateOperationsAdminStatus)
);

adminRouter.patch(
  '/operations-admins/:adminId/permissions',
  sensitiveAdminLimiter,
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  validate(updateOperationsAdminPermissionsSchema),
  asyncHandler(updateOperationsAdminPermissions)
);

adminRouter.get(
  '/audit-logs/:logId',
  authenticate,
  authorize(['audit:read']),
  validate(auditLogParamSchema),
  asyncHandler(getAdminAuditLogById)
);

adminRouter.get(
  '/service-areas',
  authenticate,
  authorize(['platform:dashboard:read']),
  validate(listQuerySchema),
  asyncHandler(listServiceAreas)
);

adminRouter.post(
  '/service-areas',
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  validate(serviceAreaBodySchema),
  asyncHandler(createServiceArea)
);

adminRouter.get(
  '/service-areas/:areaId',
  authenticate,
  authorize(['platform:dashboard:read']),
  validate(serviceAreaParamSchema),
  asyncHandler(getServiceArea)
);

adminRouter.patch(
  '/service-areas/:areaId',
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  validate(serviceAreaUpdateSchema),
  asyncHandler(updateServiceArea)
);

adminRouter.get(
  '/medicine-suggestions',
  authenticate,
  authorize(['medicine:catalogue:manage']),
  validate(listQuerySchema),
  asyncHandler(listMedicineSuggestions)
);

adminRouter.get(
  '/medicine-suggestions/:suggestionId',
  authenticate,
  authorize(['medicine:catalogue:manage']),
  validate(suggestionParamSchema),
  asyncHandler(getMedicineSuggestion)
);

adminRouter.patch(
  '/medicine-suggestions/:suggestionId',
  authenticate,
  authorize(['medicine:catalogue:manage']),
  validate(reviewSuggestionSchema),
  asyncHandler(reviewMedicineSuggestion)
);

adminRouter.get(
  '/pharmacy-owners',
  authenticate,
  authorize(['pharmacy:read:platform']),
  validate(listQuerySchema),
  asyncHandler(listPharmacyOwners)
);

adminRouter.post(
  '/pharmacy-owners/invite',
  sensitiveAdminLimiter,
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  validate(inviteOwnerSchema),
  asyncHandler(invitePharmacyOwner)
);

adminRouter.get(
  '/pharmacy-owners/:ownerId',
  authenticate,
  authorize(['pharmacy:read:platform']),
  validate(ownerParamSchema),
  asyncHandler(getPharmacyOwner)
);

adminRouter.get(
  '/platform-settings',
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  asyncHandler(getPlatformSettings)
);

adminRouter.patch(
  '/platform-settings',
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  validate(updatePlatformSettingsSchema),
  asyncHandler(updatePlatformSettings)
);

adminRouter.get(
  '/notifications',
  authenticate,
  authorize(['platform:dashboard:read']),
  validate(listQuerySchema),
  asyncHandler(listAdminNotifications)
);
