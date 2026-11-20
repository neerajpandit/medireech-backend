import Joi from 'joi';
import { validateGeoJsonPoint, validateIndianMobile } from '../../utils/schemaValidators.js';

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

const storageReferenceSchema = Joi.object({
  fileKey: Joi.string().trim().min(3).max(512).required(),
  fileType: Joi.string().trim().min(3).max(120).required(),
}).unknown(false);

const addressSchema = Joi.object({
  addressLine: Joi.string().trim().min(3).max(300).required(),
  landmark: Joi.string().trim().max(120).optional(),
  city: Joi.string().trim().min(2).max(80).required(),
  district: Joi.string().trim().min(2).max(80).required(),
  state: Joi.string().trim().min(2).max(80).required(),
  pincode: Joi.string()
    .trim()
    .pattern(/^[1-9][0-9]{5}$/)
    .required(),
  country: Joi.string().trim().min(2).max(80).default('India'),
}).unknown(false);

const openingHoursSchema = Joi.object({
  dayOfWeek: Joi.number().integer().min(0).max(6).required(),
  opensAt: Joi.string()
    .trim()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .when('isClosed', { is: true, then: Joi.optional(), otherwise: Joi.required() }),
  closesAt: Joi.string()
    .trim()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .when('isClosed', { is: true, then: Joi.optional(), otherwise: Joi.required() }),
  isClosed: Joi.boolean().default(false),
}).unknown(false);

const locationSchema = Joi.object({
  longitude: Joi.number().min(-180).max(180).required(),
  latitude: Joi.number().min(-90).max(90).required(),
})
  .required()
  .custom((value, helpers) => {
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
  .messages({ 'any.invalid': 'Location coordinates are invalid' });

export const registerPharmacySchema = {
  body: Joi.object({
    owner: Joi.object({
      fullName: Joi.string().trim().min(2).max(120).required(),
      username: Joi.string()
        .trim()
        .lowercase()
        .min(3)
        .max(40)
        .pattern(/^[a-z0-9._-]+$/)
        .required(),
      password: Joi.string().min(8).max(128).required(),
      mobileNumber: indianMobileField,
      email: Joi.string().trim().email().optional(),
    })
      .unknown(false)
      .required(),
    pharmacy: Joi.object({
      pharmacyName: Joi.string().trim().min(2).max(160).required(),
      registrationNumber: Joi.string().trim().min(2).max(80).required(),
      drugLicenseNumber: Joi.string().trim().min(2).max(80).required(),
      gstNumber: Joi.string().trim().max(15).optional(),
      phone: indianMobileField,
      email: Joi.string().trim().email().required(),
      address: addressSchema.required(),
      location: locationSchema,
      openingHours: Joi.array().items(openingHoursSchema).min(1).required(),
    })
      .unknown(false)
      .required(),
    verificationDocuments: Joi.object({
      drugLicenseDocument: storageReferenceSchema.required(),
      ownerIdentityDocument: storageReferenceSchema.required(),
      additionalDocuments: Joi.array().items(storageReferenceSchema).optional(),
    })
      .unknown(false)
      .optional(),
  }).unknown(false),
};

export const updatePharmacyProfileSchema = {
  body: Joi.object({
    pharmacyName: Joi.string().trim().min(2).max(160).optional(),
    phone: Joi.string().trim().optional(),
    email: Joi.string().trim().email().optional(),
    address: addressSchema.optional(),
    openingHours: Joi.array().items(openingHoursSchema).min(1).optional(),
  })
    .unknown(false)
    .min(1),
};

export const resubmitApplicationSchema = {
  body: Joi.object({
    pharmacyName: Joi.string().trim().min(2).max(160).optional(),
    phone: Joi.string().trim().optional(),
    email: Joi.string().trim().email().optional(),
    address: addressSchema.optional(),
    openingHours: Joi.array().items(openingHoursSchema).min(1).optional(),
    verificationDocuments: Joi.object({
      drugLicenseDocument: storageReferenceSchema.optional(),
      ownerIdentityDocument: storageReferenceSchema.optional(),
      additionalDocuments: Joi.array().items(storageReferenceSchema).optional(),
    })
      .unknown(false)
      .optional(),
    note: Joi.string().trim().max(500).optional(),
  })
    .unknown(false)
    .min(1),
};

export const publicPharmacyParamSchema = {
  params: Joi.object({
    pharmacyId: Joi.string().hex().length(24).required(),
  }),
};

export const nearbyPharmaciesQuerySchema = {
  query: Joi.object({
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    radiusKm: Joi.number().positive().max(100).default(10),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().valid('distance', 'name').default('distance'),
  }).unknown(false),
};

export const createMedicineSuggestionSchema = {
  body: Joi.object({
    name: Joi.string().trim().min(2).max(160).required(),
    genericName: Joi.string().trim().max(160).optional(),
    strength: Joi.string().trim().max(80).optional(),
    dosageForm: Joi.string().trim().max(80).optional(),
    manufacturer: Joi.string().trim().max(160).optional(),
    notes: Joi.string().trim().max(500).optional(),
  }).unknown(false),
};

export const medicineSuggestionParamSchema = {
  params: Joi.object({
    suggestionId: Joi.string().hex().length(24).required(),
  }),
};

export const listMedicineSuggestionsQuerySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(50),
    status: Joi.string().valid('PENDING', 'APPROVED', 'REJECTED').optional(),
  }).unknown(false),
};
