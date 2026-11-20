import Joi from 'joi';
import {
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  REFUND_STATUS,
} from '../../constants/payment.constants.js';

export const createPaymentOrderSchema = {
  body: Joi.object({
    reservationId: Joi.string().hex().length(24).required(),
    idempotencyKey: Joi.string().trim().min(8).max(128).required(),
  }).unknown(false),
};

export const verifyPaymentSchema = {
  body: Joi.object({
    razorpay_order_id: Joi.string().trim().required(),
    razorpay_payment_id: Joi.string().trim().required(),
    razorpay_signature: Joi.string().trim().required(),
  }).unknown(false),
};

export const paymentIdParamSchema = {
  params: Joi.object({
    paymentId: Joi.string().hex().length(24).required(),
  }),
};

export const retryPaymentSchema = {
  ...paymentIdParamSchema,
  body: Joi.object({
    idempotencyKey: Joi.string().trim().min(8).max(128).required(),
  }).unknown(false),
};

export const collectCashPaymentSchema = {
  ...paymentIdParamSchema,
  body: Joi.object({
    paymentReference: Joi.string().trim().max(120).optional(),
  }).unknown(false),
};

export const createRefundSchema = {
  ...paymentIdParamSchema,
  body: Joi.object({
    amount: Joi.number().positive().precision(2).required(),
    reason: Joi.string().trim().min(3).max(500).required(),
    idempotencyKey: Joi.string().trim().min(8).max(128).optional(),
  }).unknown(false),
};

export const listMyPaymentsQuerySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    status: Joi.string()
      .valid(...Object.values(PAYMENT_STATUS))
      .optional(),
    paymentMethod: Joi.string()
      .valid(...Object.values(PAYMENT_METHODS))
      .optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }).unknown(false),
};

export const listAdminPaymentsQuerySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    status: Joi.string()
      .valid(...Object.values(PAYMENT_STATUS))
      .optional(),
    paymentMethod: Joi.string()
      .valid(...Object.values(PAYMENT_METHODS))
      .optional(),
    pharmacyId: Joi.string().hex().length(24).optional(),
    customerId: Joi.string().hex().length(24).optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }).unknown(false),
};

export const refundIdParamSchema = {
  params: Joi.object({
    refundId: Joi.string().hex().length(24).required(),
  }),
};

export const listAdminRefundsQuerySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    status: Joi.string()
      .valid(...Object.values(REFUND_STATUS))
      .optional(),
    pharmacyId: Joi.string().hex().length(24).optional(),
    customerId: Joi.string().hex().length(24).optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }).unknown(false),
};
