import Joi from 'joi';
import { RESERVATION_STATUS } from '../../constants/database.enums.js';
import { PAYMENT_METHODS } from '../../constants/payment.constants.js';
import { env } from '../../config/env.js';

const reservationItemSchema = Joi.object({
  medicineId: Joi.string().hex().length(24).required(),
  quantity: Joi.number().integer().min(1).required(),
}).unknown(false);

export const createReservationSchema = {
  body: Joi.object({
    pharmacyId: Joi.string().hex().length(24).required(),
    items: Joi.array().items(reservationItemSchema).min(1).max(env.reservationMaxItems).required(),
    prescriptionId: Joi.string().hex().length(24).allow(null).optional(),
    customerNote: Joi.string().trim().max(500).optional(),
    idempotencyKey: Joi.string().trim().min(8).max(128).optional(),
    paymentMethod: Joi.string()
      .valid(...Object.values(PAYMENT_METHODS))
      .default(PAYMENT_METHODS.PAY_AT_PHARMACY),
  })
    .unknown(false)
    .custom((value, helpers) => {
      const medicineIds = value.items.map((item) => item.medicineId);
      if (new Set(medicineIds).size !== medicineIds.length) {
        return helpers.error('any.invalid');
      }

      return value;
    })
    .messages({ 'any.invalid': 'Duplicate medicine IDs are not allowed in one reservation' }),
};

export const reservationIdParamSchema = {
  params: Joi.object({
    reservationId: Joi.string().hex().length(24).required(),
  }),
};

export const rejectReservationSchema = {
  ...reservationIdParamSchema,
  body: Joi.object({
    reason: Joi.string().trim().min(3).max(500).required(),
  }).unknown(false),
};

export const cancelReservationSchema = {
  ...reservationIdParamSchema,
  body: Joi.object({
    reason: Joi.string().trim().min(3).max(500).optional(),
  }).unknown(false),
};

export const acceptReservationSchema = {
  ...reservationIdParamSchema,
  body: Joi.object({
    confirmUpdatedPricing: Joi.boolean().optional(),
    pharmacyNote: Joi.string().trim().max(500).optional(),
  }).unknown(false),
};

export const collectReservationSchema = {
  ...reservationIdParamSchema,
  body: Joi.object({
    reservationCode: Joi.string().trim().min(6).max(32).required(),
  }).unknown(false),
};

export const listMyReservationsQuerySchema = {
  query: Joi.object({
    status: Joi.string()
      .valid(...Object.values(RESERVATION_STATUS))
      .optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().valid('createdAt', 'expiresAt', 'updatedAt').default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }).unknown(false),
};

export const listPharmacyReservationsQuerySchema = {
  query: Joi.object({
    status: Joi.string()
      .valid(...Object.values(RESERVATION_STATUS))
      .optional(),
    reservationCode: Joi.string().trim().max(32).optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().valid('createdAt', 'expiresAt', 'updatedAt').default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }).unknown(false),
};
