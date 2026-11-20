import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { publicSearchRateLimit } from '../../middlewares/publicSearchRateLimit.middleware.js';
import {
  autocompleteMedicines,
  getMedicineAvailability,
  getMedicineById,
  listMedicines,
  searchMedicines,
} from './medicine.controller.js';
import {
  advancedMedicineSearchQuerySchema,
  autocompleteQuerySchema,
  listMedicinesQuerySchema,
  medicineAvailabilityQuerySchema,
  medicineIdParamSchema,
} from './medicine.validation.js';

export const medicineRouter = Router();

medicineRouter.get('/', publicSearchRateLimit, validate(listMedicinesQuerySchema), asyncHandler(listMedicines));

medicineRouter.get(
  '/search',
  publicSearchRateLimit,
  validate(advancedMedicineSearchQuerySchema),
  asyncHandler(searchMedicines)
);

medicineRouter.get(
  '/autocomplete',
  publicSearchRateLimit,
  validate(autocompleteQuerySchema),
  asyncHandler(autocompleteMedicines)
);

medicineRouter.get(
  '/:medicineId/availability',
  publicSearchRateLimit,
  validate(medicineAvailabilityQuerySchema),
  asyncHandler(getMedicineAvailability)
);

medicineRouter.get(
  '/:medicineId',
  validate(medicineIdParamSchema),
  asyncHandler(getMedicineById)
);
