import Joi from 'joi';
import { EMPLOYMENT_STATUS } from '../../constants/database.enums.js';
import { validateIndianMobile } from '../../utils/schemaValidators.js';

const objectId = Joi.string().hex().length(24);

const indianMobileField = Joi.string()
  .trim()
  .required()
  .custom((value, helpers) => {
    if (!validateIndianMobile(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  })
  .messages({ 'any.invalid': 'Mobile number must be a valid Indian mobile number' });

export const listStaffQuerySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(50),
  }).unknown(false),
};

export const inviteStaffSchema = {
  body: Joi.object({
    fullName: Joi.string().trim().min(2).max(120).required(),
    username: Joi.string()
      .trim()
      .lowercase()
      .min(3)
      .max(40)
      .pattern(/^[a-z0-9._-]+$/)
      .required(),
    password: Joi.string().min(8).max(128).required(),
    email: Joi.string().trim().email().required(),
    mobileNumber: indianMobileField,
    designation: Joi.string().trim().valid('PHARMACIST', 'STAFF').default('STAFF'),
  }).unknown(false),
};

export const staffIdParamSchema = {
  params: Joi.object({
    staffId: objectId.required(),
  }),
};

export const updateStaffSchema = {
  ...staffIdParamSchema,
  body: Joi.object({
    designation: Joi.string().trim().valid('PHARMACIST', 'STAFF'),
    employmentStatus: Joi.string().valid(...Object.values(EMPLOYMENT_STATUS)),
  })
    .unknown(false)
    .min(1),
};
