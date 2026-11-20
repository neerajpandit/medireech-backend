import Joi from 'joi';
import { validateEmail, validateIndianMobile } from '../../utils/schemaValidators.js';

const mobileNumberField = Joi.string()
  .trim()
  .required()
  .custom((value, helpers) => {
    if (!validateIndianMobile(value)) {
      return helpers.error('any.invalid');
    }

    return value;
  })
  .messages({
    'any.invalid': 'Mobile number must be a valid Indian mobile number',
    'any.required': 'Mobile number is required',
  });

const usernameField = Joi.string()
  .trim()
  .lowercase()
  .min(3)
  .max(40)
  .pattern(/^[a-z0-9._-]+$/)
  .custom((value, helpers) => {
    if (validateEmail(value)) {
      return helpers.error('any.invalid');
    }

    if (validateIndianMobile(value)) {
      return helpers.error('any.invalid');
    }

    return value;
  })
  .messages({
    'any.invalid': 'Username login does not accept email addresses or mobile numbers',
    'string.pattern.base':
      'Username may contain lowercase letters, numbers, dots, underscores, and hyphens',
    'any.required': 'Username is required',
  });

const passwordField = Joi.string().min(8).max(128).required().messages({
  'any.required': 'Password is required',
  'string.min': 'Password must be at least 8 characters',
});

export const sendCustomerOtpSchema = {
  body: Joi.object({
    mobileNumber: mobileNumberField,
  }).unknown(false),
};

export const verifyCustomerOtpSchema = {
  body: Joi.object({
    mobileNumber: mobileNumberField,
    otp: Joi.string()
      .trim()
      .pattern(/^\d{4,8}$/)
      .required()
      .messages({
        'any.required': 'OTP is required',
        'string.pattern.base': 'OTP must be numeric',
      }),
  }).unknown(false),
};

const emailLoginField = Joi.string()
  .trim()
  .lowercase()
  .custom((value, helpers) => {
    if (!validateEmail(value)) {
      return helpers.error('any.invalid');
    }

    return value;
  })
  .messages({
    'any.invalid': 'Email must be a valid email address',
  });

export const loginSchema = {
  body: Joi.object({
    username: usernameField.optional(),
    email: emailLoginField.optional(),
    password: passwordField,
  })
    .xor('username', 'email')
    .messages({
      'object.xor': 'Provide either a username or an email address',
      'object.missing': 'Username or email is required',
    })
    .unknown(false),
};

export const refreshTokenSchema = {
  body: Joi.object({
    refreshToken: Joi.string().trim().optional(),
  }).unknown(false),
};

export const revokeSessionSchema = {
  params: Joi.object({
    sessionId: Joi.string().hex().length(24).required(),
  }),
};
