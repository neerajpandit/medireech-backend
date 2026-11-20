import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { publicSearchRateLimit } from '../../middlewares/publicSearchRateLimit.middleware.js';
import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import { requirePharmacyOperational } from '../../middlewares/pharmacyAccess.middleware.js';
import {
  requireInventoryManagementPermission,
  resolveInventoryPharmacyContext,
} from '../../middlewares/inventoryAccess.middleware.js';
import {
  addInventory,
  adjustInventoryStock,
  deleteInventoryBatch,
  getInventoryById,
  listMyPharmacyInventory,
  listMyStockMovements,
  searchNearbyInventory,
  updateInventoryBatch,
  updateInventoryStatus,
} from './inventory.controller.js';
import {
  adjustStockSchema,
  createInventorySchema,
  inventoryBatchParamSchema,
  inventoryIdParamSchema,
  listInventoryQuerySchema,
  listStockMovementsQuerySchema,
  nearbyInventoryQuerySchema,
  updateBatchSchema,
  updateInventoryStatusSchema,
} from './inventory.validation.js';

export const inventoryRouter = Router();

inventoryRouter.get(
  '/nearby',
  publicSearchRateLimit,
  validate(nearbyInventoryQuerySchema),
  asyncHandler(searchNearbyInventory)
);

const inventoryManagementChain = [
  authenticate,
  resolveInventoryPharmacyContext,
  requirePharmacyOperational,
  requireInventoryManagementPermission,
];

inventoryRouter.post(
  '/',
  ...inventoryManagementChain,
  validate(createInventorySchema),
  asyncHandler(addInventory)
);

inventoryRouter.get(
  '/my-pharmacy',
  ...inventoryManagementChain,
  validate(listInventoryQuerySchema),
  asyncHandler(listMyPharmacyInventory)
);

inventoryRouter.get(
  '/movements',
  ...inventoryManagementChain,
  validate(listStockMovementsQuerySchema),
  asyncHandler(listMyStockMovements)
);

inventoryRouter.get(
  '/:inventoryId',
  ...inventoryManagementChain,
  validate(inventoryIdParamSchema),
  asyncHandler(getInventoryById)
);

inventoryRouter.patch(
  '/:inventoryId/batches/:batchId/adjust-stock',
  ...inventoryManagementChain,
  validate(adjustStockSchema),
  asyncHandler(adjustInventoryStock)
);

inventoryRouter.patch(
  '/:inventoryId/batches/:batchId',
  ...inventoryManagementChain,
  validate(updateBatchSchema),
  asyncHandler(updateInventoryBatch)
);

inventoryRouter.patch(
  '/:inventoryId/status',
  ...inventoryManagementChain,
  validate(updateInventoryStatusSchema),
  asyncHandler(updateInventoryStatus)
);

inventoryRouter.delete(
  '/:inventoryId/batches/:batchId',
  ...inventoryManagementChain,
  validate(inventoryBatchParamSchema),
  asyncHandler(deleteInventoryBatch)
);
