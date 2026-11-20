import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import { loadOwnedPharmacy, requirePharmacyOperational } from '../../middlewares/pharmacyAccess.middleware.js';
import { publicSearchRateLimit } from '../../middlewares/publicSearchRateLimit.middleware.js';
import {
  getMyApplication,
  getMyPharmacyProfile,
  listNearbyPharmacies,
  getPublicPharmacyProfile,
  probeOperationalAccess,
  registerPharmacy,
  resubmitMyApplication,
  updateMyPharmacyProfile,
} from './pharmacy.controller.js';
import {
  createMyMedicineSuggestion,
  getMyMedicineSuggestion,
  listMyMedicineSuggestions,
} from './pharmacySuggestion.controller.js';
import {
  invitePharmacyStaff,
  listPharmacyStaff,
  updatePharmacyStaff,
} from '../pharmacy-staff/staff.controller.js';
import {
  createMedicineSuggestionSchema,
  listMedicineSuggestionsQuerySchema,
  medicineSuggestionParamSchema,
  nearbyPharmaciesQuerySchema,
  publicPharmacyParamSchema,
  registerPharmacySchema,
  resubmitApplicationSchema,
  updatePharmacyProfileSchema,
} from './pharmacy.validation.js';
import {
  inviteStaffSchema,
  listStaffQuerySchema,
  updateStaffSchema,
} from '../pharmacy-staff/staff.validation.js';

export const pharmacyRouter = Router();

pharmacyRouter.post('/register', validate(registerPharmacySchema), asyncHandler(registerPharmacy));

const ownerPharmacyChain = [authenticate, loadOwnedPharmacy];

pharmacyRouter.get(
  '/staff',
  ...ownerPharmacyChain,
  authorize(['staff:manage:own-pharmacy']),
  validate(listStaffQuerySchema),
  asyncHandler(listPharmacyStaff)
);

pharmacyRouter.post(
  '/staff',
  ...ownerPharmacyChain,
  authorize(['staff:manage:own-pharmacy']),
  validate(inviteStaffSchema),
  asyncHandler(invitePharmacyStaff)
);

pharmacyRouter.patch(
  '/staff/:staffId',
  ...ownerPharmacyChain,
  authorize(['staff:manage:own-pharmacy']),
  validate(updateStaffSchema),
  asyncHandler(updatePharmacyStaff)
);

pharmacyRouter.get(
  '/medicine-suggestions',
  ...ownerPharmacyChain,
  authorize(['pharmacy:update:own']),
  validate(listMedicineSuggestionsQuerySchema),
  asyncHandler(listMyMedicineSuggestions)
);

pharmacyRouter.post(
  '/medicine-suggestions',
  ...ownerPharmacyChain,
  authorize(['pharmacy:update:own']),
  validate(createMedicineSuggestionSchema),
  asyncHandler(createMyMedicineSuggestion)
);

pharmacyRouter.get(
  '/medicine-suggestions/:suggestionId',
  ...ownerPharmacyChain,
  authorize(['pharmacy:update:own']),
  validate(medicineSuggestionParamSchema),
  asyncHandler(getMyMedicineSuggestion)
);

pharmacyRouter.get(
  '/nearby',
  publicSearchRateLimit,
  validate(nearbyPharmaciesQuerySchema),
  asyncHandler(listNearbyPharmacies)
);

pharmacyRouter.get(
  '/:pharmacyId/public',
  publicSearchRateLimit,
  validate(publicPharmacyParamSchema),
  asyncHandler(getPublicPharmacyProfile)
);

pharmacyRouter.get(
  '/my-application',
  authenticate,
  authorize(['pharmacy:onboarding:own']),
  loadOwnedPharmacy,
  asyncHandler(getMyApplication)
);

pharmacyRouter.get(
  '/my-profile',
  authenticate,
  authorize(['pharmacy:read:own']),
  loadOwnedPharmacy,
  asyncHandler(getMyPharmacyProfile)
);

pharmacyRouter.patch(
  '/my-profile',
  authenticate,
  authorize(['pharmacy:update:own']),
  loadOwnedPharmacy,
  validate(updatePharmacyProfileSchema),
  asyncHandler(updateMyPharmacyProfile)
);

pharmacyRouter.patch(
  '/my-application/resubmit',
  authenticate,
  authorize(['pharmacy:onboarding:own']),
  loadOwnedPharmacy,
  validate(resubmitApplicationSchema),
  asyncHandler(resubmitMyApplication)
);

pharmacyRouter.post(
  '/operational/probe',
  authenticate,
  authorize(['inventory:manage:own']),
  loadOwnedPharmacy,
  requirePharmacyOperational,
  asyncHandler(probeOperationalAccess)
);
