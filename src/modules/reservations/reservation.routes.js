import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import { requirePharmacyOperational } from '../../middlewares/pharmacyAccess.middleware.js';
import {
  requireReservationManagementPermission,
  resolveReservationPharmacyContext,
} from '../../middlewares/reservationAccess.middleware.js';
import {
  acceptReservation,
  cancelReservation,
  collectReservation,
  createReservation,
  getPharmacyReservationById,
  getReservationById,
  listMyReservations,
  listPharmacyReservations,
  markReservationReady,
  rejectReservation,
} from './reservation.controller.js';
import {
  acceptReservationSchema,
  cancelReservationSchema,
  collectReservationSchema,
  createReservationSchema,
  listMyReservationsQuerySchema,
  listPharmacyReservationsQuerySchema,
  rejectReservationSchema,
  reservationIdParamSchema,
} from './reservation.validation.js';

export const reservationRouter = Router();

reservationRouter.post(
  '/',
  authenticate,
  authorize(['reservation:create']),
  validate(createReservationSchema),
  asyncHandler(createReservation)
);

reservationRouter.get(
  '/my',
  authenticate,
  authorize(['reservation:read:own']),
  validate(listMyReservationsQuerySchema),
  asyncHandler(listMyReservations)
);

const pharmacyReservationChain = [
  authenticate,
  resolveReservationPharmacyContext,
  requirePharmacyOperational,
  requireReservationManagementPermission,
];

reservationRouter.get(
  '/pharmacy',
  ...pharmacyReservationChain,
  validate(listPharmacyReservationsQuerySchema),
  asyncHandler(listPharmacyReservations)
);

reservationRouter.get(
  '/pharmacy/:reservationId',
  ...pharmacyReservationChain,
  validate(reservationIdParamSchema),
  asyncHandler(getPharmacyReservationById)
);

reservationRouter.patch(
  '/:reservationId/accept',
  ...pharmacyReservationChain,
  validate(acceptReservationSchema),
  asyncHandler(acceptReservation)
);

reservationRouter.patch(
  '/:reservationId/reject',
  ...pharmacyReservationChain,
  validate(rejectReservationSchema),
  asyncHandler(rejectReservation)
);

reservationRouter.patch(
  '/:reservationId/ready',
  ...pharmacyReservationChain,
  validate(reservationIdParamSchema),
  asyncHandler(markReservationReady)
);

reservationRouter.patch(
  '/:reservationId/collect',
  ...pharmacyReservationChain,
  validate(collectReservationSchema),
  asyncHandler(collectReservation)
);

reservationRouter.get(
  '/:reservationId',
  authenticate,
  authorize(['reservation:read:own']),
  validate(reservationIdParamSchema),
  asyncHandler(getReservationById)
);

reservationRouter.patch(
  '/:reservationId/cancel',
  authenticate,
  authorize(['reservation:read:own']),
  validate(cancelReservationSchema),
  asyncHandler(cancelReservation)
);
