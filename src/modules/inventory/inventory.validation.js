import Joi from 'joi';
import { DOSAGE_FORMS } from '../../constants/database.enums.js';
import { STOCK_ADJUSTMENT_TYPES } from '../../constants/inventory.constants.js';
import { validateGeoJsonPoint } from '../../utils/schemaValidators.js';

const batchInputSchema = Joi.object({
  batchNumber: Joi.string().trim().min(1).max(64).required(),
  manufacturingDate: Joi.date().iso().optional(),
  expiryDate: Joi.date().iso().required(),
  physicalQuantity: Joi.number().integer().min(0).required(),
  unitPrice: Joi.number().positive().required(),
  mrp: Joi.number().positive().required(),
  purchasePrice: Joi.number().min(0).optional(),
}).custom((value, helpers) => {
  if (value.unitPrice > value.mrp) {
    return helpers.error('any.invalid');
  }

  if (value.manufacturingDate && new Date(value.manufacturingDate) > new Date(value.expiryDate)) {
    return helpers.error('any.invalid');
  }

  return value;
}, 'batch validation')
  .messages({ 'any.invalid': 'Batch has invalid price or date values' });

export const createInventorySchema = {
  body: Joi.object({
    medicineId: Joi.string().hex().length(24).required(),
    batch: batchInputSchema.required(),
  }).unknown(false),
};

export const inventoryIdParamSchema = {
  params: Joi.object({
    inventoryId: Joi.string().hex().length(24).required(),
  }),
};

export const inventoryBatchParamSchema = {
  params: Joi.object({
    inventoryId: Joi.string().hex().length(24).required(),
    batchId: Joi.string().hex().length(24).required(),
  }),
};

export const updateBatchSchema = {
  ...inventoryBatchParamSchema,
  body: Joi.object({
    expiryDate: Joi.date().iso().optional(),
    unitPrice: Joi.number().positive().optional(),
    mrp: Joi.number().positive().optional(),
    purchasePrice: Joi.number().min(0).optional(),
    isActive: Joi.boolean().optional(),
  })
    .unknown(false)
    .min(1)
    .custom((value, helpers) => {
      if (value.unitPrice != null && value.mrp != null && value.unitPrice > value.mrp) {
        return helpers.error('any.invalid');
      }

      return value;
    })
    .messages({ 'any.invalid': 'Unit price cannot exceed MRP' }),
};

export const adjustStockSchema = {
  ...inventoryBatchParamSchema,
  body: Joi.object({
    adjustmentType: Joi.string()
      .valid(...Object.values(STOCK_ADJUSTMENT_TYPES))
      .required(),
    quantity: Joi.number().integer().min(0).required(),
    reason: Joi.string().trim().min(3).max(500).required(),
  })
    .unknown(false)
    .custom((value, helpers) => {
      if (value.adjustmentType !== STOCK_ADJUSTMENT_TYPES.CORRECTION && value.quantity < 1) {
        return helpers.error('any.invalid');
      }

      return value;
    })
    .messages({ 'any.invalid': 'Quantity must be at least 1 for add and remove adjustments' }),
};

export const updateInventoryStatusSchema = {
  ...inventoryIdParamSchema,
  body: Joi.object({
    isActive: Joi.boolean().required(),
  }).unknown(false),
};

export const listStockMovementsQuerySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(50),
    inventoryId: Joi.string().hex().length(24).optional(),
  }).unknown(false),
};

export const listInventoryQuerySchema = {
  query: Joi.object({
    search: Joi.string().trim().min(2).max(120).optional(),
    availableOnly: Joi.boolean().optional(),
    nearExpiry: Joi.boolean().optional(),
    lowStock: Joi.boolean().optional(),
    outOfStock: Joi.boolean().optional(),
    dosageForm: Joi.string()
      .valid(...Object.values(DOSAGE_FORMS))
      .optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().valid('createdAt', 'updatedAt', 'lastStockUpdatedAt').default('updatedAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }).unknown(false),
};

export const nearbyInventoryQuerySchema = {
  query: Joi.object({
    medicineId: Joi.string().hex().length(24).optional(),
    q: Joi.string().trim().min(2).max(120).optional(),
    search: Joi.string().trim().min(2).max(120).optional(),
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    radiusKm: Joi.number().positive().max(100).default(10),
    radius: Joi.number().positive().max(100).optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().valid('distance', 'price', 'availability', 'recommended').default('distance'),
    minPrice: Joi.number().min(0).optional(),
    maxPrice: Joi.number().min(0).optional(),
    dosageForm: Joi.string()
      .valid(...Object.values(DOSAGE_FORMS))
      .optional(),
    availableOnly: Joi.boolean().default(true),
    pincode: Joi.string().trim().pattern(/^[1-9][0-9]{5}$/).optional(),
    city: Joi.string().trim().max(80).optional(),
    state: Joi.string().trim().max(80).optional(),
    area: Joi.string().trim().max(120).optional(),
  })
    .unknown(false)
    .custom((value, helpers) => {
      if (!value.medicineId && !value.q && !value.search) {
        return helpers.error('any.invalid');
      }

      if (value.maxPrice != null && value.minPrice != null && value.maxPrice < value.minPrice) {
        return helpers.error('any.invalid');
      }

      const hasManualLocation = Boolean(value.pincode || value.city || value.state || value.area);
      if (hasManualLocation) {
        return helpers.error('any.invalid');
      }

      if (
        !validateGeoJsonPoint({
          type: 'Point',
          coordinates: [value.longitude, value.latitude],
        })
      ) {
        return helpers.error('any.invalid');
      }

      return value;
    })
    .messages({
      'any.invalid':
        'Nearby search requires medicineId or q, valid coordinates, and manual location is not supported until geocoding is configured',
    }),
};
