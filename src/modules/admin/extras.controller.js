import bcrypt from 'bcrypt';
import { HTTP_STATUS } from '../../constants/index.js';
import { USER_ACCOUNT_STATUS, USER_ROLES } from '../../constants/database.enums.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { recordAuditLog } from '../../utils/auditLog.js';
import { AuditLog } from '../audit-logs/auditLog.model.js';
import { Notification } from '../notifications/notification.model.js';
import { Pharmacy } from '../pharmacies/pharmacy.model.js';
import { User } from '../users/user.model.js';
import { MedicineSuggestion } from './medicineSuggestion.model.js';
import { PlatformSettings } from './platformSettings.model.js';
import { ServiceArea } from './serviceArea.model.js';

const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

const toServiceArea = (area) => ({
  id: area._id,
  name: area.name,
  country: area.country,
  state: area.state,
  district: area.district,
  city: area.city,
  description: area.description,
  pinCodes: area.pinCodes,
  status: area.status,
  customerSearchEnabled: area.customerSearchEnabled,
  pharmacyOnboardingAllowed: area.pharmacyOnboardingAllowed,
  createdAt: area.createdAt,
  updatedAt: area.updatedAt,
});

export const listServiceAreas = async (req, res) => {
  const { page, limit, search, status } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (search) filter.name = { $regex: search.trim(), $options: 'i' };

  const [areas, total] = await Promise.all([
    ServiceArea.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ServiceArea.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { areas: areas.map(toServiceArea) },
    'Service areas fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const getServiceArea = async (req, res) => {
  const area = await ServiceArea.findById(req.params.areaId).lean();
  if (!area) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Service area not found');
  const response = new ApiResponse(HTTP_STATUS.OK, { area: toServiceArea(area) }, 'Service area fetched successfully');
  res.status(response.statusCode).json(response);
};

export const createServiceArea = async (req, res) => {
  const area = await ServiceArea.create(req.body);
  const response = new ApiResponse(HTTP_STATUS.CREATED, { area: toServiceArea(area.toObject()) }, 'Service area created');
  res.status(response.statusCode).json(response);
};

export const updateServiceArea = async (req, res) => {
  const area = await ServiceArea.findByIdAndUpdate(req.params.areaId, req.body, {
    returnDocument: 'after',
    runValidators: true,
  });
  if (!area) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Service area not found');
  const response = new ApiResponse(HTTP_STATUS.OK, { area: toServiceArea(area.toObject()) }, 'Service area updated');
  res.status(response.statusCode).json(response);
};

const toSuggestion = (row) => ({
  id: row._id,
  pharmacyId: row.pharmacy,
  submittedBy: row.submittedBy,
  name: row.name,
  genericName: row.genericName,
  strength: row.strength,
  dosageForm: row.dosageForm,
  manufacturer: row.manufacturer,
  notes: row.notes,
  status: row.status,
  reviewNote: row.reviewNote,
  reviewedAt: row.reviewedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const listMedicineSuggestions = async (req, res) => {
  const { page, limit, status, search } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (search) filter.name = { $regex: search.trim(), $options: 'i' };

  const [rows, total] = await Promise.all([
    MedicineSuggestion.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    MedicineSuggestion.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { suggestions: rows.map(toSuggestion) },
    'Medicine suggestions fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const getMedicineSuggestion = async (req, res) => {
  const row = await MedicineSuggestion.findById(req.params.suggestionId).lean();
  if (!row) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Suggestion not found');
  const response = new ApiResponse(HTTP_STATUS.OK, { suggestion: toSuggestion(row) }, 'Suggestion fetched successfully');
  res.status(response.statusCode).json(response);
};

export const reviewMedicineSuggestion = async (req, res) => {
  const row = await MedicineSuggestion.findById(req.params.suggestionId);
  if (!row) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Suggestion not found');
  if (row.status !== 'PENDING') {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Suggestion has already been reviewed');
  }

  row.status = req.body.status;
  row.reviewNote = req.body.reviewNote;
  row.reviewedBy = req.auth.userId;
  row.reviewedAt = new Date();
  await row.save();

  const response = new ApiResponse(HTTP_STATUS.OK, { suggestion: toSuggestion(row.toObject()) }, 'Suggestion reviewed');
  res.status(response.statusCode).json(response);
};

const toOwner = (user, pharmacy) => ({
  id: user._id,
  fullName: user.fullName,
  username: user.username,
  email: user.email,
  mobileNumber: user.mobileNumber,
  accountStatus: user.accountStatus,
  pharmacy: pharmacy
    ? { id: pharmacy._id, pharmacyName: pharmacy.pharmacyName, verificationStatus: pharmacy.verificationStatus }
    : null,
  createdAt: user.createdAt,
});

export const listPharmacyOwners = async (req, res) => {
  const { page, limit, search } = req.query;
  const filter = { role: USER_ROLES.PHARMACY_OWNER };
  if (search) {
    filter.$or = [
      { fullName: { $regex: search.trim(), $options: 'i' } },
      { username: { $regex: search.trim(), $options: 'i' } },
    ];
  }

  const [owners, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  const pharmacies = await Pharmacy.find({ owner: { $in: owners.map((owner) => owner._id) } }).lean();
  const pharmacyMap = new Map(pharmacies.map((pharmacy) => [pharmacy.owner.toString(), pharmacy]));

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { owners: owners.map((owner) => toOwner(owner, pharmacyMap.get(owner._id.toString()))) },
    'Pharmacy owners fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const getPharmacyOwner = async (req, res) => {
  const owner = await User.findOne({ _id: req.params.ownerId, role: USER_ROLES.PHARMACY_OWNER }).lean();
  if (!owner) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Pharmacy owner not found');
  const pharmacy = await Pharmacy.findOne({ owner: owner._id }).lean();
  const response = new ApiResponse(HTTP_STATUS.OK, { owner: toOwner(owner, pharmacy) }, 'Pharmacy owner fetched');
  res.status(response.statusCode).json(response);
};

export const invitePharmacyOwner = async (req, res) => {
  const username = req.body.username.trim().toLowerCase();
  const existing = await User.findOne({ username }).lean();
  if (existing) throw new ApiError(HTTP_STATUS.CONFLICT, 'Username already exists');

  const passwordHash = await bcrypt.hash(req.body.password, env.bcryptSaltRounds);
  const owner = await User.create({
    fullName: req.body.fullName.trim(),
    username,
    passwordHash,
    email: req.body.email,
    mobileNumber: req.body.mobileNumber,
    role: USER_ROLES.PHARMACY_OWNER,
    accountStatus: USER_ACCOUNT_STATUS.ACTIVE,
  });

  await recordAuditLog({
    actorId: req.auth.userId,
    action: 'PHARMACY_OWNER_INVITED',
    resourceType: 'User',
    resourceId: owner._id,
    req,
  });

  const response = new ApiResponse(HTTP_STATUS.CREATED, { owner: toOwner(owner.toObject()) }, 'Pharmacy owner created');
  res.status(response.statusCode).json(response);
};

export const getPlatformSettings = async (_req, res) => {
  const settings = await PlatformSettings.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: { key: 'global' } },
    { returnDocument: 'after', upsert: true }
  ).lean();

  const response = new ApiResponse(HTTP_STATUS.OK, { settings }, 'Platform settings fetched');
  res.status(response.statusCode).json(response);
};

export const updatePlatformSettings = async (req, res) => {
  const settings = await PlatformSettings.findOneAndUpdate(
    { key: 'global' },
    { $set: req.body },
    { returnDocument: 'after', upsert: true, runValidators: true }
  ).lean();

  const response = new ApiResponse(HTTP_STATUS.OK, { settings }, 'Platform settings updated');
  res.status(response.statusCode).json(response);
};

export const listAdminNotifications = async (req, res) => {
  const { page, limit } = req.query;
  const [notifications, total] = await Promise.all([
    Notification.find({ recipient: req.auth.userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments({ recipient: req.auth.userId }),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      notifications: notifications.map((row) => ({
        id: row._id,
        type: row.type,
        title: row.title,
        message: row.message,
        createdAt: row.createdAt,
      })),
    },
    'Notifications fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const getAdminAuditLogById = async (req, res) => {
  const entry = await AuditLog.findById(req.params.logId).lean();
  if (!entry) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Audit log not found');

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      auditLog: {
        id: entry._id,
        actor: entry.actor,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        pharmacy: entry.pharmacy,
        previousValues: entry.previousValues,
        newValues: entry.newValues,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
      },
    },
    'Audit log fetched successfully'
  );
  res.status(response.statusCode).json(response);
};
