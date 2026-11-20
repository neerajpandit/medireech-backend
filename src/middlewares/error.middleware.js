import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { HTTP_STATUS, MESSAGES } from '../constants/index.js';
import { ApiError } from '../utils/ApiError.js';
import { redactSecrets } from '../utils/redact.js';

const duplicateField = (err) => {
  const source = err.keyPattern || err.keyValue || err.cause?.keyPattern || err.cause?.keyValue || {};
  return Object.keys(source)[0];
};

export const toPublicError = (err) => {
  if (err instanceof ApiError) {
    return err;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const errors = Object.values(err.errors).map((item) => ({
      field: item.path,
      message: item.message,
    }));
    return new ApiError(HTTP_STATUS.BAD_REQUEST, MESSAGES.VALIDATION_FAILED, errors);
  }

  if (err instanceof mongoose.Error.CastError) {
    return new ApiError(HTTP_STATUS.BAD_REQUEST, `Invalid value for ${err.path}`);
  }

  if (err?.code === 11000 || err?.cause?.code === 11000) {
    const field = duplicateField(err);
    const message = field ? `${field} already exists` : 'Duplicate value';
    return new ApiError(HTTP_STATUS.CONFLICT, message);
  }

  if (err?.type === 'entity.parse.failed') {
    return new ApiError(HTTP_STATUS.BAD_REQUEST, 'Invalid JSON payload');
  }

  if (err?.type === 'entity.too.large' || err?.status === 413 || err?.statusCode === 413) {
    return new ApiError(HTTP_STATUS.PAYLOAD_TOO_LARGE, 'Request payload is too large');
  }

  const statusCode = Number(err.statusCode || err.status) || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const isServerError = statusCode >= 500;
  const rawMessage = err instanceof Error ? err.message : '';
  const message =
    isServerError && env.isProduction
      ? MESSAGES.INTERNAL_ERROR
      : redactSecrets(rawMessage || MESSAGES.INTERNAL_ERROR);

  const apiError = new ApiError(statusCode, message);
  if (err instanceof Error && err.stack) {
    apiError.stack = redactSecrets(err.stack);
  }

  return apiError;
};

export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const error = toPublicError(err);
  const statusCode = error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const safeMessage = redactSecrets(error.message || MESSAGES.INTERNAL_ERROR);

  if (!env.isTest && !process.env.JEST_WORKER_ID && statusCode >= 500) {
    const logPayload = {
      message: redactSecrets(err instanceof Error ? err.message : safeMessage),
      statusCode,
      method: req.method,
      path: req.originalUrl,
    };

    if (env.isDevelopment && err instanceof Error && err.stack) {
      logPayload.stack = redactSecrets(err.stack);
    }

    console.error(logPayload);
  }

  const body = {
    success: false,
    message: safeMessage,
    errors: Array.isArray(error.errors) ? error.errors : [],
    data: null,
  };

  if (env.isDevelopment && error.stack) {
    body.stack = redactSecrets(error.stack);
  }

  res.status(statusCode).json(body);
};
