import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

export const listQuerySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().max(120).optional(),
    status: Joi.string().trim().optional(),
  }).unknown(false),
};

export const serviceAreaBodySchema = {
  body: Joi.object({
    name: Joi.string().trim().min(2).max(160).required(),
    country: Joi.string().trim().max(80).optional(),
    state: Joi.string().trim().min(2).max(80).required(),
    district: Joi.string().trim().max(80).optional(),
    city: Joi.string().trim().min(2).max(80).required(),
    description: Joi.string().trim().max(500).optional(),
    pinCodes: Joi.array().items(Joi.string().trim().pattern(/^[1-9][0-9]{5}$/)).optional(),
    status: Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
    customerSearchEnabled: Joi.boolean().optional(),
    pharmacyOnboardingAllowed: Joi.boolean().optional(),
  }).unknown(false),
};

export const serviceAreaUpdateSchema = {
  params: Joi.object({ areaId: objectId.required() }),
  body: Joi.object({
    name: Joi.string().trim().min(2).max(160).optional(),
    country: Joi.string().trim().max(80).optional(),
    state: Joi.string().trim().min(2).max(80).optional(),
    district: Joi.string().trim().max(80).optional(),
    city: Joi.string().trim().min(2).max(80).optional(),
    description: Joi.string().trim().max(500).optional(),
    pinCodes: Joi.array().items(Joi.string().trim().pattern(/^[1-9][0-9]{5}$/)).optional(),
    status: Joi.string().valid('ACTIVE', 'INACTIVE').optional(),
    customerSearchEnabled: Joi.boolean().optional(),
    pharmacyOnboardingAllowed: Joi.boolean().optional(),
  })
    .unknown(false)
    .min(1),
};

export const serviceAreaParamSchema = {
  params: Joi.object({ areaId: objectId.required() }),
};

export const suggestionParamSchema = {
  params: Joi.object({ suggestionId: objectId.required() }),
};

export const reviewSuggestionSchema = {
  params: Joi.object({ suggestionId: objectId.required() }),
  body: Joi.object({
    status: Joi.string().valid('APPROVED', 'REJECTED').required(),
    reviewNote: Joi.string().trim().max(500).optional(),
  }).unknown(false),
};

export const inviteOwnerSchema = {
  body: Joi.object({
    fullName: Joi.string().trim().min(2).max(120).required(),
    username: Joi.string().trim().min(3).max(40).required(),
    password: Joi.string().min(8).max(128).required(),
    email: Joi.string().email().optional(),
    mobileNumber: Joi.string().trim().optional(),
    pharmacyId: objectId.optional(),
  }).unknown(false),
};

export const ownerParamSchema = {
  params: Joi.object({ ownerId: objectId.required() }),
};

export const updatePlatformSettingsSchema = {
  body: Joi.object({
    reservationSlaMinutes: Joi.number().integer().min(5).max(180).optional(),
    customerSearchEnabled: Joi.boolean().optional(),
    pharmacyOnboardingEnabled: Joi.boolean().optional(),
    supportEnabled: Joi.boolean().optional(),
    maintenanceMode: Joi.boolean().optional(),
    notes: Joi.string().trim().max(500).optional(),
    sections: Joi.object().unknown(true).optional(),
  })
    .unknown(false)
    .min(1),
};

export const auditLogParamSchema = {
  params: Joi.object({ logId: objectId.required() }),
};
