import { HTTP_STATUS, MESSAGES } from '../constants/index.js';
import { ApiError } from '../utils/ApiError.js';

const JOI_OPTIONS = {
  abortEarly: false,
  stripUnknown: true,
  convert: true,
  errors: {
    wrap: {
      label: false,
    },
  },
};

const REQUEST_SEGMENTS = ['body', 'params', 'query'];

const assignRequestValue = (req, segment, value) => {
  if (segment === 'query') {
    Object.defineProperty(req, 'query', {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    return;
  }

  req[segment] = value;
};

export const validate = (schema) => (req, res, next) => {
  const source = typeof schema?.validate === 'function' ? { body: schema } : schema;

  if (!source || typeof source !== 'object') {
    next(new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Invalid validation schema'));
    return;
  }

  const errors = [];
  const sanitized = {};

  for (const segment of REQUEST_SEGMENTS) {
    const segmentSchema = source[segment];
    if (!segmentSchema) {
      continue;
    }

    const { error, value } = segmentSchema.validate(req[segment] ?? {}, JOI_OPTIONS);

    if (error) {
      for (const detail of error.details) {
        errors.push({
          field: detail.path.length > 0 ? detail.path.join('.') : segment,
          message: detail.message,
        });
      }
      continue;
    }

    sanitized[segment] = value;
  }

  if (errors.length > 0) {
    next(new ApiError(HTTP_STATUS.BAD_REQUEST, MESSAGES.VALIDATION_FAILED, errors));
    return;
  }

  for (const [segment, value] of Object.entries(sanitized)) {
    assignRequestValue(req, segment, value);
  }

  next();
};
