import { HTTP_STATUS } from '../../constants/index.js';
import {
  PHARMACY_APPLICATION_EVENTS,
  PHARMACY_AUDIT_ACTIONS,
} from '../../constants/pharmacy.constants.js';
import {
  PHARMACY_OPERATIONAL_STATUS,
  PHARMACY_VERIFICATION_STATUS,
  USER_ROLES,
} from '../../constants/database.enums.js';
import { NOTIFICATION_EVENT_TYPES } from '../../constants/notification.types.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { recordAuditLog } from '../../utils/auditLog.js';
import { enqueueNotificationOutbox } from '../../utils/enqueueNotificationOutbox.js';
import { applySession, runWithTransactionRetry, sessionOption } from '../../utils/transactionRetry.js';
import { User } from '../users/user.model.js';
import { Pharmacy } from './pharmacy.model.js';

const queuePharmacyOwnerNotification = async ({
  eventType,
  pharmacy,
  idempotencyKey,
  payload = {},
  session,
}) => {
  await enqueueNotificationOutbox({
    eventType,
    recipient: pharmacy.owner,
    payload: { pharmacyId: pharmacy._id, ...payload },
    relatedResourceType: 'Pharmacy',
    relatedResourceId: pharmacy._id,
    idempotencyKey,
    session,
  });
};

const toDocumentMetadata = (documents = []) =>
  documents.map((document) => ({
    documentType: document.documentType,
    fileType: document.fileType,
    uploadedAt: document.uploadedAt,
  }));

const toSafeOwner = (owner) => ({
  id: owner._id,
  fullName: owner.fullName,
  username: owner.username,
  mobileNumber: owner.mobileNumber,
  email: owner.email,
  role: owner.role,
  accountStatus: owner.accountStatus,
});

const toApplicationDetails = (pharmacy, owner) => ({
  id: pharmacy._id,
  pharmacyCode: pharmacy.pharmacyCode,
  pharmacyName: pharmacy.pharmacyName,
  registrationNumber: pharmacy.registrationNumber,
  drugLicenseNumber: pharmacy.drugLicenseNumber,
  gstNumber: pharmacy.gstNumber,
  phone: pharmacy.phone,
  email: pharmacy.email,
  address: pharmacy.address,
  location: {
    longitude: pharmacy.location.coordinates[0],
    latitude: pharmacy.location.coordinates[1],
  },
  openingHours: pharmacy.openingHours,
  verificationStatus: pharmacy.verificationStatus,
  operationalStatus: pharmacy.operationalStatus,
  rejectionReason: pharmacy.rejectionReason,
  actionRequiredReason: pharmacy.actionRequiredReason,
  requestedDocuments: pharmacy.requestedDocuments,
  verifiedBy: pharmacy.verifiedBy,
  verifiedAt: pharmacy.verifiedAt,
  documents: toDocumentMetadata(pharmacy.verificationDocuments),
  applicationTimeline: pharmacy.applicationHistory,
  superAdminFlag: pharmacy.superAdminFlag,
  createdAt: pharmacy.createdAt,
  updatedAt: pharmacy.updatedAt,
  owner: owner ? toSafeOwner(owner) : undefined,
});

const buildApplicationFilters = (query) => {
  const filter = {};

  if (query.verificationStatus) {
    filter.verificationStatus = query.verificationStatus;
  }

  if (query.city) {
    filter['address.city'] = query.city;
  }

  if (query.state) {
    filter['address.state'] = query.state;
  }

  if (query.createdFrom || query.createdTo) {
    filter.createdAt = {};
    if (query.createdFrom) {
      filter.createdAt.$gte = new Date(query.createdFrom);
    }
    if (query.createdTo) {
      filter.createdAt.$lte = new Date(query.createdTo);
    }
  }

  if (query.search) {
    filter.$text = { $search: query.search };
  }

  return filter;
};

const appendHistory = (pharmacy, entry) => {
  pharmacy.applicationHistory.push({
    ...entry,
    changedAt: new Date(),
  });
};

const getPharmacyOrThrow = async (pharmacyId) => {
  const pharmacy = await Pharmacy.findById(pharmacyId);

  if (!pharmacy) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Pharmacy application not found');
  }

  return pharmacy;
};

export const listPharmacyApplications = async (req, res) => {
  const { page, limit, sortBy, sortOrder } = req.query;
  const filter = buildApplicationFilters(req.query);
  const skip = (page - 1) * limit;
  const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

  const [applications, total] = await Promise.all([
    Pharmacy.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Pharmacy.countDocuments(filter),
  ]);

  const ownerIds = applications.map((application) => application.owner);
  const owners = await User.find({ _id: { $in: ownerIds } }).lean();
  const ownerMap = new Map(owners.map((owner) => [owner._id.toString(), owner]));

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      applications: applications.map((application) =>
        toApplicationDetails(application, ownerMap.get(application.owner.toString()))
      ),
    },
    'Pharmacy applications fetched successfully',
    {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    }
  );

  res.status(response.statusCode).json(response);
};

export const getPharmacyApplication = async (req, res) => {
  const pharmacy = await getPharmacyOrThrow(req.params.pharmacyId);
  const owner = await User.findById(pharmacy.owner).lean();

  await recordAuditLog({
    actorId: req.auth.userId,
    action: PHARMACY_AUDIT_ACTIONS.PHARMACY_APPLICATION_VIEWED,
    resourceType: 'Pharmacy',
    resourceId: pharmacy._id,
    pharmacyId: pharmacy._id,
    metadata: {
      viewedByRole: req.auth.role,
    },
    req,
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { application: toApplicationDetails(pharmacy, owner) },
    'Pharmacy application fetched successfully'
  );
  res.status(response.statusCode).json(response);
};

export const approvePharmacyApplication = async (req, res) => {
  const { pharmacy, previousValues } = await runWithTransactionRetry(async (session) => {
    const pharmacy = await applySession(
      Pharmacy.findOne({
        _id: req.params.pharmacyId,
        verificationStatus: {
          $in: [PHARMACY_VERIFICATION_STATUS.PENDING, PHARMACY_VERIFICATION_STATUS.ACTION_REQUIRED],
        },
      }),
      session
    );

    if (!pharmacy) {
      throw new ApiError(
        HTTP_STATUS.CONFLICT,
        'Pharmacy application is not eligible for approval'
      );
    }

    const previousValues = {
      verificationStatus: pharmacy.verificationStatus,
      operationalStatus: pharmacy.operationalStatus,
    };

    pharmacy.verificationStatus = PHARMACY_VERIFICATION_STATUS.APPROVED;
    pharmacy.operationalStatus = PHARMACY_OPERATIONAL_STATUS.ACTIVE;
    pharmacy.verifiedBy = req.auth.userId;
    pharmacy.verifiedAt = new Date();
    pharmacy.rejectionReason = undefined;
    pharmacy.actionRequiredReason = undefined;
    pharmacy.requestedDocuments = [];

    appendHistory(pharmacy, {
      eventType: PHARMACY_APPLICATION_EVENTS.APPROVED,
      verificationStatus: pharmacy.verificationStatus,
      operationalStatus: pharmacy.operationalStatus,
      changedBy: req.auth.userId,
      reason: req.body.note || 'Pharmacy application approved',
    });

    await pharmacy.save(sessionOption(session));

    await queuePharmacyOwnerNotification({
      eventType: NOTIFICATION_EVENT_TYPES.PHARMACY_APPLICATION_APPROVED,
      pharmacy,
      idempotencyKey: `pharmacy-approved:${pharmacy._id.toString()}`,
      session,
    });

    return { pharmacy, previousValues };
  });

  await recordAuditLog({
    actorId: req.auth.userId,
    action: PHARMACY_AUDIT_ACTIONS.PHARMACY_APPROVED,
    resourceType: 'Pharmacy',
    resourceId: pharmacy._id,
    pharmacyId: pharmacy._id,
    previousValues,
    newValues: {
      verificationStatus: pharmacy.verificationStatus,
      operationalStatus: pharmacy.operationalStatus,
    },
    req,
  });

  const owner = await User.findById(pharmacy.owner).lean();
  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { application: toApplicationDetails(pharmacy, owner) },
    'Pharmacy application approved successfully'
  );
  res.status(response.statusCode).json(response);
};

export const rejectPharmacyApplication = async (req, res) => {
  const pharmacy = await getPharmacyOrThrow(req.params.pharmacyId);

  if (
    pharmacy.verificationStatus === PHARMACY_VERIFICATION_STATUS.REJECTED ||
    pharmacy.verificationStatus === PHARMACY_VERIFICATION_STATUS.APPROVED
  ) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Pharmacy application cannot be rejected in its current state');
  }

  const previousValues = {
    verificationStatus: pharmacy.verificationStatus,
    operationalStatus: pharmacy.operationalStatus,
  };

  pharmacy.verificationStatus = PHARMACY_VERIFICATION_STATUS.REJECTED;
  pharmacy.operationalStatus = PHARMACY_OPERATIONAL_STATUS.INACTIVE;
  pharmacy.rejectionReason = req.body.reason;
  pharmacy.verifiedBy = req.auth.userId;
  pharmacy.verifiedAt = new Date();

  appendHistory(pharmacy, {
    eventType: PHARMACY_APPLICATION_EVENTS.REJECTED,
    verificationStatus: pharmacy.verificationStatus,
    operationalStatus: pharmacy.operationalStatus,
    changedBy: req.auth.userId,
    reason: req.body.reason,
  });

  await pharmacy.save();

  await queuePharmacyOwnerNotification({
    eventType: NOTIFICATION_EVENT_TYPES.PHARMACY_APPLICATION_REJECTED,
    pharmacy,
    idempotencyKey: `pharmacy-rejected:${pharmacy._id.toString()}:${pharmacy.verifiedAt.getTime()}`,
  });

  await recordAuditLog({
    actorId: req.auth.userId,
    action: PHARMACY_AUDIT_ACTIONS.PHARMACY_REJECTED,
    resourceType: 'Pharmacy',
    resourceId: pharmacy._id,
    pharmacyId: pharmacy._id,
    previousValues,
    newValues: {
      verificationStatus: pharmacy.verificationStatus,
      operationalStatus: pharmacy.operationalStatus,
      rejectionReason: pharmacy.rejectionReason,
    },
    req,
  });

  const owner = await User.findById(pharmacy.owner).lean();
  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { application: toApplicationDetails(pharmacy, owner) },
    'Pharmacy application rejected successfully'
  );
  res.status(response.statusCode).json(response);
};

export const requestPharmacyDocuments = async (req, res) => {
  const pharmacy = await getPharmacyOrThrow(req.params.pharmacyId);

  if (
    [PHARMACY_VERIFICATION_STATUS.REJECTED, PHARMACY_VERIFICATION_STATUS.APPROVED].includes(
      pharmacy.verificationStatus
    )
  ) {
    throw new ApiError(
      HTTP_STATUS.CONFLICT,
      'Additional documents cannot be requested for this application state'
    );
  }

  const previousValues = {
    verificationStatus: pharmacy.verificationStatus,
    requestedDocuments: pharmacy.requestedDocuments,
  };

  pharmacy.verificationStatus = PHARMACY_VERIFICATION_STATUS.ACTION_REQUIRED;
  pharmacy.operationalStatus = PHARMACY_OPERATIONAL_STATUS.INACTIVE;
  pharmacy.actionRequiredReason = req.body.reason;
  pharmacy.requestedDocuments = req.body.requiredDocuments;
  pharmacy.verifiedBy = req.auth.userId;
  pharmacy.verifiedAt = new Date();

  appendHistory(pharmacy, {
    eventType: PHARMACY_APPLICATION_EVENTS.DOCUMENTS_REQUESTED,
    verificationStatus: pharmacy.verificationStatus,
    operationalStatus: pharmacy.operationalStatus,
    changedBy: req.auth.userId,
    reason: req.body.reason,
    metadata: {
      requiredDocuments: req.body.requiredDocuments,
    },
  });

  await pharmacy.save();

  await queuePharmacyOwnerNotification({
    eventType: NOTIFICATION_EVENT_TYPES.PHARMACY_DOCUMENTS_REQUESTED,
    pharmacy,
    idempotencyKey: `pharmacy-docs-requested:${pharmacy._id.toString()}:${pharmacy.verifiedAt.getTime()}`,
    payload: { requiredDocuments: req.body.requiredDocuments },
  });

  await recordAuditLog({
    actorId: req.auth.userId,
    action: PHARMACY_AUDIT_ACTIONS.PHARMACY_DOCUMENTS_REQUESTED,
    resourceType: 'Pharmacy',
    resourceId: pharmacy._id,
    pharmacyId: pharmacy._id,
    previousValues,
    newValues: {
      verificationStatus: pharmacy.verificationStatus,
      requestedDocuments: pharmacy.requestedDocuments,
      actionRequiredReason: pharmacy.actionRequiredReason,
    },
    req,
  });

  const owner = await User.findById(pharmacy.owner).lean();
  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { application: toApplicationDetails(pharmacy, owner) },
    'Additional documents requested successfully'
  );
  res.status(response.statusCode).json(response);
};

export const suspendPharmacy = async (req, res) => {
  const pharmacy = await getPharmacyOrThrow(req.params.pharmacyId);

  if (pharmacy.verificationStatus !== PHARMACY_VERIFICATION_STATUS.APPROVED) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Only approved pharmacies can be suspended');
  }

  if (pharmacy.operationalStatus === PHARMACY_OPERATIONAL_STATUS.SUSPENDED) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Pharmacy is already suspended');
  }

  const previousValues = { operationalStatus: pharmacy.operationalStatus };

  pharmacy.operationalStatus = PHARMACY_OPERATIONAL_STATUS.SUSPENDED;

  appendHistory(pharmacy, {
    eventType: PHARMACY_APPLICATION_EVENTS.SUSPENDED,
    verificationStatus: pharmacy.verificationStatus,
    operationalStatus: pharmacy.operationalStatus,
    changedBy: req.auth.userId,
    reason: req.body.reason,
  });

  await pharmacy.save();

  await queuePharmacyOwnerNotification({
    eventType: NOTIFICATION_EVENT_TYPES.PHARMACY_SUSPENDED,
    pharmacy,
    idempotencyKey: `pharmacy-suspended:${pharmacy._id.toString()}:${Date.now()}`,
  });

  await recordAuditLog({
    actorId: req.auth.userId,
    action: PHARMACY_AUDIT_ACTIONS.PHARMACY_SUSPENDED,
    resourceType: 'Pharmacy',
    resourceId: pharmacy._id,
    pharmacyId: pharmacy._id,
    previousValues,
    newValues: { operationalStatus: pharmacy.operationalStatus },
    req,
  });

  const owner = await User.findById(pharmacy.owner).lean();
  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { application: toApplicationDetails(pharmacy, owner) },
    'Pharmacy suspended successfully'
  );
  res.status(response.statusCode).json(response);
};

export const reactivatePharmacy = async (req, res) => {
  const pharmacy = await getPharmacyOrThrow(req.params.pharmacyId);

  if (pharmacy.verificationStatus !== PHARMACY_VERIFICATION_STATUS.APPROVED) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Only approved pharmacies can be reactivated');
  }

  if (pharmacy.operationalStatus !== PHARMACY_OPERATIONAL_STATUS.SUSPENDED) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Pharmacy is not suspended');
  }

  const previousValues = { operationalStatus: pharmacy.operationalStatus };

  pharmacy.operationalStatus = PHARMACY_OPERATIONAL_STATUS.ACTIVE;

  appendHistory(pharmacy, {
    eventType: PHARMACY_APPLICATION_EVENTS.REACTIVATED,
    verificationStatus: pharmacy.verificationStatus,
    operationalStatus: pharmacy.operationalStatus,
    changedBy: req.auth.userId,
    reason: req.body.reason,
  });

  await pharmacy.save();

  await queuePharmacyOwnerNotification({
    eventType: NOTIFICATION_EVENT_TYPES.PHARMACY_REACTIVATED,
    pharmacy,
    idempotencyKey: `pharmacy-reactivated:${pharmacy._id.toString()}:${Date.now()}`,
  });

  await recordAuditLog({
    actorId: req.auth.userId,
    action: PHARMACY_AUDIT_ACTIONS.PHARMACY_REACTIVATED,
    resourceType: 'Pharmacy',
    resourceId: pharmacy._id,
    pharmacyId: pharmacy._id,
    previousValues,
    newValues: { operationalStatus: pharmacy.operationalStatus },
    req,
  });

  const owner = await User.findById(pharmacy.owner).lean();
  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { application: toApplicationDetails(pharmacy, owner) },
    'Pharmacy reactivated successfully'
  );
  res.status(response.statusCode).json(response);
};

export const flagPharmacyApplication = async (req, res) => {
  if (req.auth.role !== USER_ROLES.OPERATIONS_ADMIN) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Only operations admins can flag applications');
  }

  const pharmacy = await getPharmacyOrThrow(req.params.pharmacyId);

  pharmacy.superAdminFlag = {
    isFlagged: true,
    flaggedBy: req.auth.userId,
    flaggedAt: new Date(),
    reason: req.body.reason,
  };

  appendHistory(pharmacy, {
    eventType: PHARMACY_APPLICATION_EVENTS.FLAGGED,
    verificationStatus: pharmacy.verificationStatus,
    operationalStatus: pharmacy.operationalStatus,
    changedBy: req.auth.userId,
    reason: req.body.reason,
  });

  await pharmacy.save();

  await recordAuditLog({
    actorId: req.auth.userId,
    action: PHARMACY_AUDIT_ACTIONS.PHARMACY_APPLICATION_FLAGGED,
    resourceType: 'Pharmacy',
    resourceId: pharmacy._id,
    pharmacyId: pharmacy._id,
    newValues: {
      superAdminFlag: pharmacy.superAdminFlag,
    },
    req,
  });

  const owner = await User.findById(pharmacy.owner).lean();
  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { application: toApplicationDetails(pharmacy, owner) },
    'Pharmacy application flagged for Super Admin attention'
  );
  res.status(response.statusCode).json(response);
};
