import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { authorize, authorizeRoles } from '../../middlewares/authorize.middleware.js';
import {
  getPlatformPharmacyById,
  getPlatformPharmacyInventory,
  getPlatformPharmacyReservations,
  listPlatformPharmacies,
} from '../admin/pharmacyPlatform.controller.js';
import {
  approvePharmacyApplication,
  flagPharmacyApplication,
  getPharmacyApplication,
  listPharmacyApplications,
  reactivatePharmacy,
  rejectPharmacyApplication,
  requestPharmacyDocuments,
  suspendPharmacy,
} from './admin.controller.js';
import {
  approveApplicationSchema,
  flagApplicationSchema,
  listApplicationsQuerySchema,
  pharmacyIdParamSchema,
  reactivatePharmacySchema,
  rejectApplicationSchema,
  requestDocumentsSchema,
  suspendPharmacySchema,
} from './admin.validation.js';
import {
  listPharmacyInventoryQuerySchema,
  listPharmacyReservationsQuerySchema,
  listPlatformPharmaciesQuerySchema,
  pharmacyIdParamSchema as platformPharmacyIdParamSchema,
} from '../admin/admin.validation.js';

export const adminPharmacyRouter = Router();

adminPharmacyRouter.get(
  '/',
  authenticate,
  authorize(['pharmacy:read:platform']),
  validate(listPlatformPharmaciesQuerySchema),
  asyncHandler(listPlatformPharmacies)
);

adminPharmacyRouter.get(
  '/applications',
  authenticate,
  authorize(['pharmacy:applications:read']),
  validate(listApplicationsQuerySchema),
  asyncHandler(listPharmacyApplications)
);

adminPharmacyRouter.get(
  '/applications/:pharmacyId',
  authenticate,
  authorize(['pharmacy:applications:read']),
  validate(pharmacyIdParamSchema),
  asyncHandler(getPharmacyApplication)
);

adminPharmacyRouter.patch(
  '/:pharmacyId/approve',
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  validate(approveApplicationSchema),
  asyncHandler(approvePharmacyApplication)
);

adminPharmacyRouter.patch(
  '/:pharmacyId/reject',
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  validate(rejectApplicationSchema),
  asyncHandler(rejectPharmacyApplication)
);

adminPharmacyRouter.patch(
  '/:pharmacyId/request-documents',
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  validate(requestDocumentsSchema),
  asyncHandler(requestPharmacyDocuments)
);

adminPharmacyRouter.patch(
  '/:pharmacyId/suspend',
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  validate(suspendPharmacySchema),
  asyncHandler(suspendPharmacy)
);

adminPharmacyRouter.patch(
  '/:pharmacyId/reactivate',
  authenticate,
  authorizeRoles('SUPER_ADMIN'),
  validate(reactivatePharmacySchema),
  asyncHandler(reactivatePharmacy)
);

adminPharmacyRouter.patch(
  '/:pharmacyId/flag',
  authenticate,
  authorize(['pharmacy:applications:flag']),
  validate(flagApplicationSchema),
  asyncHandler(flagPharmacyApplication)
);

adminPharmacyRouter.get(
  '/:pharmacyId/inventory',
  authenticate,
  authorize(['pharmacy:read:platform']),
  validate(listPharmacyInventoryQuerySchema),
  asyncHandler(getPlatformPharmacyInventory)
);

adminPharmacyRouter.get(
  '/:pharmacyId/reservations',
  authenticate,
  authorize(['pharmacy:read:platform', 'reservation:read:platform'], { mode: 'any' }),
  validate(listPharmacyReservationsQuerySchema),
  asyncHandler(getPlatformPharmacyReservations)
);

adminPharmacyRouter.get(
  '/:pharmacyId',
  authenticate,
  authorize(['pharmacy:read:platform']),
  validate(platformPharmacyIdParamSchema),
  asyncHandler(getPlatformPharmacyById)
);
