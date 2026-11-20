import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import {
  createMedicine,
  deleteMedicine,
  listAdminMedicines,
  updateMedicine,
  updateMedicineStatus,
} from './medicine.controller.js';
import {
  createMedicineSchema,
  listMedicinesQuerySchema,
  medicineIdParamSchema,
  updateMedicineSchema,
  updateMedicineStatusSchema,
} from './medicine.validation.js';

export const adminMedicineRouter = Router();

adminMedicineRouter.get(
  '/',
  authenticate,
  authorize(['medicine:catalogue:manage']),
  validate(listMedicinesQuerySchema),
  asyncHandler(listAdminMedicines)
);

adminMedicineRouter.post(
  '/',
  authenticate,
  authorize(['medicine:catalogue:manage']),
  validate(createMedicineSchema),
  asyncHandler(createMedicine)
);

adminMedicineRouter.patch(
  '/:medicineId',
  authenticate,
  authorize(['medicine:catalogue:manage']),
  validate(updateMedicineSchema),
  asyncHandler(updateMedicine)
);

adminMedicineRouter.patch(
  '/:medicineId/status',
  authenticate,
  authorize(['medicine:catalogue:manage']),
  validate(updateMedicineStatusSchema),
  asyncHandler(updateMedicineStatus)
);

adminMedicineRouter.delete(
  '/:medicineId',
  authenticate,
  authorize(['medicine:catalogue:manage']),
  validate(medicineIdParamSchema),
  asyncHandler(deleteMedicine)
);
