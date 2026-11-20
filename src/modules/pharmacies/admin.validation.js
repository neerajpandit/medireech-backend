import Joi from 'joi';
import {
  PHARMACY_OPERATIONAL_STATUS,
  PHARMACY_VERIFICATION_STATUS,
} from '../../constants/database.enums.js';

export const pharmacyIdParamSchema = {
  params: Joi.object({
    pharmacyId: Joi.string().hex().length(24).required(),
  }),
};

export const listApplicationsQuerySchema = {
  query: Joi.object({
    verificationStatus: Joi.string()
      .valid(...Object.values(PHARMACY_VERIFICATION_STATUS))
      .optional(),
    city: Joi.string().trim().max(80).optional(),
    state: Joi.string().trim().max(80).optional(),
    createdFrom: Joi.date().iso().optional(),
    createdTo: Joi.date().iso().optional(),
    search: Joi.string().trim().min(2).max(120).optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string()
      .valid('createdAt', 'pharmacyName', 'verificationStatus', 'updatedAt')
      .default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }).unknown(false),
};

export const rejectApplicationSchema = {
  ...pharmacyIdParamSchema,
  body: Joi.object({
    reason: Joi.string().trim().min(5).max(500).required(),
  }).unknown(false),
};

export const requestDocumentsSchema = {
  ...pharmacyIdParamSchema,
  body: Joi.object({
    reason: Joi.string().trim().min(5).max(500).required(),
    requiredDocuments: Joi.array()
      .items(Joi.string().trim().min(2).max(80))
      .min(1)
      .required(),
  }).unknown(false),
};

export const suspendPharmacySchema = {
  ...pharmacyIdParamSchema,
  body: Joi.object({
    reason: Joi.string().trim().min(5).max(500).required(),
  }).unknown(false),
};

export const reactivatePharmacySchema = {
  ...pharmacyIdParamSchema,
  body: Joi.object({
    reason: Joi.string().trim().min(5).max(500).required(),
  }).unknown(false),
};

export const flagApplicationSchema = {
  ...pharmacyIdParamSchema,
  body: Joi.object({
    reason: Joi.string().trim().min(5).max(500).required(),
  }).unknown(false),
};

export const approveApplicationSchema = {
  ...pharmacyIdParamSchema,
  body: Joi.object({
    note: Joi.string().trim().max(500).optional(),
  }).unknown(false),
};
