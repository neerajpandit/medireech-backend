import Joi from 'joi';
import { DOSAGE_FORMS, PRESCRIPTION_TYPES } from '../../constants/database.enums.js';

const dosageFormField = Joi.string()
  .valid(...Object.values(DOSAGE_FORMS))
  .required();

const prescriptionTypeField = Joi.string()
  .valid(...Object.values(PRESCRIPTION_TYPES))
  .required();

const medicinePayloadSchema = Joi.object({
  name: Joi.string().trim().min(2).max(200).required(),
  genericName: Joi.string().trim().max(200).optional(),
  brandName: Joi.string().trim().max(200).optional(),
  manufacturer: Joi.string().trim().max(160).optional(),
  composition: Joi.string().trim().max(500).optional(),
  strength: Joi.string().trim().max(80).optional(),
  dosageForm: dosageFormField,
  packSize: Joi.string().trim().max(80).optional(),
  unit: Joi.string().trim().max(40).optional(),
  medicineCategory: Joi.string().trim().max(80).optional(),
  prescriptionType: prescriptionTypeField,
  description: Joi.string().trim().max(2000).optional(),
  image: Joi.string().trim().max(500).optional(),
  searchKeywords: Joi.array().items(Joi.string().trim().max(80)).optional(),
}).unknown(false);

export const createMedicineSchema = {
  body: medicinePayloadSchema,
};

export const updateMedicineSchema = {
  params: Joi.object({
    medicineId: Joi.string().hex().length(24).required(),
  }),
  body: Joi.object({
    name: Joi.string().trim().min(2).max(200),
    genericName: Joi.string().trim().max(200),
    brandName: Joi.string().trim().max(200),
    manufacturer: Joi.string().trim().max(160),
    composition: Joi.string().trim().max(500),
    strength: Joi.string().trim().max(80),
    dosageForm: Joi.string().valid(...Object.values(DOSAGE_FORMS)),
    packSize: Joi.string().trim().max(80),
    unit: Joi.string().trim().max(40),
    medicineCategory: Joi.string().trim().max(80),
    prescriptionType: Joi.string().valid(...Object.values(PRESCRIPTION_TYPES)),
    description: Joi.string().trim().max(2000),
    image: Joi.string().trim().max(500),
    searchKeywords: Joi.array().items(Joi.string().trim().max(80)),
  })
    .unknown(false)
    .min(1),
};

export const medicineIdParamSchema = {
  params: Joi.object({
    medicineId: Joi.string().hex().length(24).required(),
  }),
};

export const updateMedicineStatusSchema = {
  ...medicineIdParamSchema,
  body: Joi.object({
    isActive: Joi.boolean().required(),
  }).unknown(false),
};

const catalogueSortFields = ['createdAt', 'name', 'genericName', 'brandName', 'updatedAt', 'relevance'];

export const autocompleteQuerySchema = {
  query: Joi.object({
    q: Joi.string().trim().min(2).max(80).required(),
    limit: Joi.number().integer().min(1).max(20).default(10),
  }).unknown(false),
};

export const advancedMedicineSearchQuerySchema = {
  query: Joi.object({
    q: Joi.string().trim().min(2).max(120).optional(),
    search: Joi.string().trim().min(2).max(120).optional(),
    genericName: Joi.string().trim().max(200).optional(),
    brandName: Joi.string().trim().max(200).optional(),
    composition: Joi.string().trim().max(500).optional(),
    manufacturer: Joi.string().trim().max(160).optional(),
    dosageForm: Joi.string()
      .valid(...Object.values(DOSAGE_FORMS))
      .optional(),
    medicineCategory: Joi.string().trim().max(80).optional(),
    prescriptionType: Joi.string()
      .valid(...Object.values(PRESCRIPTION_TYPES))
      .optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().valid(...catalogueSortFields).default('relevance'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  })
    .unknown(false)
    .custom((value, helpers) => {
      const hasFilter = Boolean(
        value.q ||
          value.search ||
          value.genericName ||
          value.brandName ||
          value.composition ||
          value.manufacturer ||
          value.dosageForm ||
          value.medicineCategory ||
          value.prescriptionType
      );

      if (!hasFilter) {
        return helpers.error('any.invalid');
      }

      return value;
    })
    .messages({ 'any.invalid': 'At least one search filter is required' }),
};

export const medicineAvailabilityQuerySchema = {
  params: Joi.object({
    medicineId: Joi.string().hex().length(24).required(),
  }),
  query: Joi.object({
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    radiusKm: Joi.number().positive().max(100).default(10),
    radius: Joi.number().positive().max(100).optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().valid('distance', 'price', 'availability', 'recommended').default('distance'),
    minPrice: Joi.number().min(0).optional(),
    maxPrice: Joi.number().min(0).optional(),
    availableOnly: Joi.boolean().default(true),
    pincode: Joi.string().trim().pattern(/^[1-9][0-9]{5}$/).optional(),
    city: Joi.string().trim().max(80).optional(),
    state: Joi.string().trim().max(80).optional(),
    area: Joi.string().trim().max(120).optional(),
  })
    .unknown(false)
    .custom((value, helpers) => {
      if (value.maxPrice != null && value.minPrice != null && value.maxPrice < value.minPrice) {
        return helpers.error('any.invalid');
      }

      const hasManualLocation = Boolean(value.pincode || value.city || value.state || value.area);
      if (hasManualLocation) {
        return helpers.error('any.invalid');
      }

      return value;
    })
    .messages({
      'any.invalid':
        'Invalid availability filters or manual location is not supported until geocoding is configured. Provide latitude and longitude.',
    }),
};

export const listMedicinesQuerySchema = {
  query: Joi.object({
    search: Joi.string().trim().min(2).max(120).optional(),
    genericName: Joi.string().trim().max(200).optional(),
    brandName: Joi.string().trim().max(200).optional(),
    manufacturer: Joi.string().trim().max(160).optional(),
    dosageForm: Joi.string()
      .valid(...Object.values(DOSAGE_FORMS))
      .optional(),
    medicineCategory: Joi.string().trim().max(80).optional(),
    prescriptionType: Joi.string()
      .valid(...Object.values(PRESCRIPTION_TYPES))
      .optional(),
    includeInactive: Joi.boolean().optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string()
      .valid('createdAt', 'name', 'genericName', 'brandName', 'updatedAt')
      .default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }).unknown(false),
};
