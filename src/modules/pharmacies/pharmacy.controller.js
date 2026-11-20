import bcrypt from 'bcrypt';
import { HTTP_STATUS } from '../../constants/index.js';
import {
  PHARMACY_APPLICATION_EVENTS,
  PHARMACY_AUDIT_ACTIONS,
  PHARMACY_DOCUMENT_TYPES,
} from '../../constants/pharmacy.constants.js';
import {
  PHARMACY_OPERATIONAL_STATUS,
  PHARMACY_VERIFICATION_STATUS,
  USER_ACCOUNT_STATUS,
  USER_ROLES,
} from '../../constants/database.enums.js';
import { env } from '../../config/env.js';
import { NOTIFICATION_EVENT_TYPES } from '../../constants/notification.types.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { recordAuditLog } from '../../utils/auditLog.js';
import { enqueueNotificationOutbox } from '../../utils/enqueueNotificationOutbox.js';
import { fetchNearbyPharmacies } from '../../utils/fetchNearbyMedicineAvailability.js';
import { generatePharmacyCode } from '../../utils/pharmacyCode.js';
import { runWithTransactionRetry, sessionOption } from '../../utils/transactionRetry.js';
import { normalizeEmail, normalizeIndianMobile } from '../../utils/schemaValidators.js';
import { User } from '../users/user.model.js';
import { Pharmacy } from './pharmacy.model.js';

const appendHistory = (pharmacy, entry) => {
  pharmacy.applicationHistory.push({
    ...entry,
    changedAt: new Date(),
  });
};

const mapVerificationDocuments = (verificationDocuments) => {
  const documents = [
    {
      documentType: PHARMACY_DOCUMENT_TYPES.DRUG_LICENSE,
      ...verificationDocuments.drugLicenseDocument,
    },
    {
      documentType: PHARMACY_DOCUMENT_TYPES.OWNER_IDENTITY,
      ...verificationDocuments.ownerIdentityDocument,
    },
  ];

  for (const document of verificationDocuments.additionalDocuments || []) {
    documents.push({
      documentType: PHARMACY_DOCUMENT_TYPES.ADDITIONAL,
      ...document,
    });
  }

  return documents;
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

const toApplicationResponse = (pharmacy, owner) => ({
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
  verifiedAt: pharmacy.verifiedAt,
  documents: toDocumentMetadata(pharmacy.verificationDocuments),
  applicationTimeline: pharmacy.applicationHistory,
  superAdminFlag: pharmacy.superAdminFlag,
  createdAt: pharmacy.createdAt,
  updatedAt: pharmacy.updatedAt,
  owner: owner ? toSafeOwner(owner) : undefined,
});

const assertRegistrationUniqueness = async ({ owner, pharmacy }) => {
  const username = owner.username.trim().toLowerCase();
  const mobileNumber = normalizeIndianMobile(owner.mobileNumber);

  const [existingUsername, existingMobile, existingRegistration, existingDrugLicense] = await Promise.all([
    User.findOne({ username }).lean(),
    User.findOne({ mobileNumber }).lean(),
    Pharmacy.findOne({ registrationNumber: pharmacy.registrationNumber.trim() }).lean(),
    Pharmacy.findOne({ drugLicenseNumber: pharmacy.drugLicenseNumber.trim() }).lean(),
  ]);

  if (existingUsername) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Username already exists');
  }

  if (existingMobile) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Mobile number already exists');
  }

  if (existingRegistration) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Registration number already exists');
  }

  if (existingDrugLicense) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Drug licence number already exists');
  }
};

export const registerPharmacy = async (req, res) => {
  const { owner, pharmacy, verificationDocuments } = req.body;

  if (owner.role && owner.role !== USER_ROLES.PHARMACY_OWNER) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Invalid owner role supplied in registration');
  }

  await assertRegistrationUniqueness({ owner, pharmacy });

  const passwordHash = await bcrypt.hash(owner.password, env.bcryptSaltRounds);
  const normalizedMobile = normalizeIndianMobile(owner.mobileNumber);
  const normalizedUsername = owner.username.trim().toLowerCase();
  const verificationDocs = verificationDocuments
    ? mapVerificationDocuments(verificationDocuments)
    : [];
  const pharmacyCode = generatePharmacyCode();

  const { createdOwner, createdPharmacy } = await runWithTransactionRetry(async (session) => {
    const writeOptions = sessionOption(session);
    const [createdOwner] = await User.create(
      [
        {
          fullName: owner.fullName.trim(),
          username: normalizedUsername,
          passwordHash,
          mobileNumber: normalizedMobile,
          email: owner.email ? normalizeEmail(owner.email) : undefined,
          role: USER_ROLES.PHARMACY_OWNER,
          accountStatus: USER_ACCOUNT_STATUS.ACTIVE,
          isMobileVerified: false,
        },
      ],
      writeOptions
    );

    try {
      const [createdPharmacy] = await Pharmacy.create(
        [
          {
            pharmacyName: pharmacy.pharmacyName.trim(),
            owner: createdOwner._id,
            pharmacyCode,
            registrationNumber: pharmacy.registrationNumber.trim(),
            drugLicenseNumber: pharmacy.drugLicenseNumber.trim(),
            gstNumber: pharmacy.gstNumber?.trim().toUpperCase(),
            phone: normalizeIndianMobile(pharmacy.phone),
            email: normalizeEmail(pharmacy.email),
            address: pharmacy.address,
            location: {
              type: 'Point',
              coordinates: [pharmacy.location.longitude, pharmacy.location.latitude],
            },
            openingHours: pharmacy.openingHours,
            verificationStatus: PHARMACY_VERIFICATION_STATUS.PENDING,
            operationalStatus: PHARMACY_OPERATIONAL_STATUS.INACTIVE,
            verificationDocuments: verificationDocs,
            applicationHistory: [
              {
                eventType: PHARMACY_APPLICATION_EVENTS.REGISTERED,
                verificationStatus: PHARMACY_VERIFICATION_STATUS.PENDING,
                operationalStatus: PHARMACY_OPERATIONAL_STATUS.INACTIVE,
                changedBy: createdOwner._id,
                reason: 'Pharmacy registration submitted',
                metadata: {
                  pharmacyCode,
                },
              },
            ],
          },
        ],
        writeOptions
      );
      return { createdOwner, createdPharmacy };
    } catch (error) {
      if (!session) {
        await User.deleteOne({ _id: createdOwner._id });
      }
      throw error;
    }
  });

  const adminRecipients = await User.find({
    role: { $in: [USER_ROLES.SUPER_ADMIN, USER_ROLES.OPERATIONS_ADMIN] },
    accountStatus: USER_ACCOUNT_STATUS.ACTIVE,
  })
    .select('_id')
    .lean();

  await Promise.all(
    adminRecipients.map((admin) =>
      enqueueNotificationOutbox({
        eventType: NOTIFICATION_EVENT_TYPES.PHARMACY_APPLICATION_SUBMITTED,
        recipient: admin._id,
        payload: {
          pharmacyId: createdPharmacy._id,
          pharmacyName: createdPharmacy.pharmacyName,
        },
        relatedResourceType: 'Pharmacy',
        relatedResourceId: createdPharmacy._id,
        idempotencyKey: `pharmacy-submitted:${createdPharmacy._id.toString()}:${admin._id.toString()}`,
      })
    )
  );

  await recordAuditLog({
    actorId: createdOwner._id,
    action: PHARMACY_AUDIT_ACTIONS.PHARMACY_REGISTERED,
    resourceType: 'Pharmacy',
    resourceId: createdPharmacy._id,
    pharmacyId: createdPharmacy._id,
    newValues: {
      verificationStatus: createdPharmacy.verificationStatus,
      operationalStatus: createdPharmacy.operationalStatus,
      pharmacyCode: createdPharmacy.pharmacyCode,
    },
    metadata: {
      registrationNumber: createdPharmacy.registrationNumber,
    },
    req,
  });

  const response = new ApiResponse(
    HTTP_STATUS.CREATED,
    {
      application: toApplicationResponse(createdPharmacy, createdOwner),
    },
    'Pharmacy registration submitted successfully'
  );

  res.status(response.statusCode).json(response);
};

export const getMyApplication = async (req, res) => {
  const owner = await User.findById(req.auth.userId);
  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { application: toApplicationResponse(req.pharmacy, owner) },
    'Pharmacy application fetched successfully'
  );
  res.status(response.statusCode).json(response);
};

export const getMyPharmacyProfile = async (req, res) => {
  const owner = await User.findById(req.auth.userId);
  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { pharmacy: toApplicationResponse(req.pharmacy, owner) },
    'Pharmacy profile fetched successfully'
  );
  res.status(response.statusCode).json(response);
};

export const updateMyPharmacyProfile = async (req, res) => {
  const allowedFields = ['pharmacyName', 'phone', 'email', 'address', 'openingHours'];
  const pharmacy = req.pharmacy;

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      if (field === 'phone') {
        pharmacy.phone = normalizeIndianMobile(req.body.phone);
      } else if (field === 'email') {
        pharmacy.email = normalizeEmail(req.body.email);
      } else {
        pharmacy[field] = req.body[field];
      }
    }
  }

  await pharmacy.save();

  const owner = await User.findById(req.auth.userId);
  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { pharmacy: toApplicationResponse(pharmacy, owner) },
    'Pharmacy profile updated successfully'
  );
  res.status(response.statusCode).json(response);
};

export const resubmitMyApplication = async (req, res) => {
  const pharmacy = req.pharmacy;

  if (pharmacy.verificationStatus !== PHARMACY_VERIFICATION_STATUS.ACTION_REQUIRED) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      'Application can only be resubmitted when additional documents are requested'
    );
  }

  const previousStatus = pharmacy.verificationStatus;

  if (req.body.pharmacyName) pharmacy.pharmacyName = req.body.pharmacyName.trim();
  if (req.body.phone) pharmacy.phone = normalizeIndianMobile(req.body.phone);
  if (req.body.email) pharmacy.email = normalizeEmail(req.body.email);
  if (req.body.address) pharmacy.address = req.body.address;
  if (req.body.openingHours) pharmacy.openingHours = req.body.openingHours;

  if (req.body.verificationDocuments) {
    const resubmittedDocuments = mapVerificationDocuments({
      drugLicenseDocument:
        req.body.verificationDocuments.drugLicenseDocument ||
        pharmacy.verificationDocuments.find(
          (document) => document.documentType === PHARMACY_DOCUMENT_TYPES.DRUG_LICENSE
        ),
      ownerIdentityDocument:
        req.body.verificationDocuments.ownerIdentityDocument ||
        pharmacy.verificationDocuments.find(
          (document) => document.documentType === PHARMACY_DOCUMENT_TYPES.OWNER_IDENTITY
        ),
      additionalDocuments: req.body.verificationDocuments.additionalDocuments,
    });

    pharmacy.verificationDocuments = resubmittedDocuments;
  }

  pharmacy.verificationStatus = PHARMACY_VERIFICATION_STATUS.PENDING;
  pharmacy.requestedDocuments = [];
  pharmacy.actionRequiredReason = undefined;

  appendHistory(pharmacy, {
    eventType: PHARMACY_APPLICATION_EVENTS.RESUBMITTED,
    verificationStatus: PHARMACY_VERIFICATION_STATUS.PENDING,
    operationalStatus: pharmacy.operationalStatus,
    changedBy: req.auth.userId,
    reason: req.body.note || 'Application resubmitted by pharmacy owner',
    metadata: {
      previousVerificationStatus: previousStatus,
    },
  });

  await pharmacy.save();

  await recordAuditLog({
    actorId: req.auth.userId,
    action: PHARMACY_AUDIT_ACTIONS.PHARMACY_APPLICATION_RESUBMITTED,
    resourceType: 'Pharmacy',
    resourceId: pharmacy._id,
    pharmacyId: pharmacy._id,
    previousValues: { verificationStatus: previousStatus },
    newValues: { verificationStatus: pharmacy.verificationStatus },
    req,
  });

  const owner = await User.findById(req.auth.userId);
  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { application: toApplicationResponse(pharmacy, owner) },
    'Pharmacy application resubmitted successfully'
  );
  res.status(response.statusCode).json(response);
};

export const probeOperationalAccess = async (_req, res) => {
  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { allowed: true },
    'Operational pharmacy access verified'
  );
  res.status(response.statusCode).json(response);
};

export const listNearbyPharmacies = async (req, res) => {
  const { latitude, longitude, radiusKm, page, limit, sortBy } = req.query;

  const { items, meta } = await fetchNearbyPharmacies({
    latitude,
    longitude,
    radiusKm,
    page,
    limit,
    sortBy,
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { pharmacies: items },
    'Nearby pharmacies fetched successfully',
    meta
  );
  res.status(response.statusCode).json(response);
};

export const getPublicPharmacyProfile = async (req, res) => {
  const pharmacy = await Pharmacy.findOne({
    _id: req.params.pharmacyId,
    verificationStatus: PHARMACY_VERIFICATION_STATUS.APPROVED,
    operationalStatus: PHARMACY_OPERATIONAL_STATUS.ACTIVE,
  })
    .select(
      'pharmacyName address location phone openingHours acceptsReservations operationalStatus verificationStatus'
    )
    .lean();

  if (!pharmacy) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Pharmacy not found');
  }

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      pharmacy: {
        pharmacyId: pharmacy._id,
        pharmacyName: pharmacy.pharmacyName,
        address: pharmacy.address,
        location: {
          longitude: pharmacy.location.coordinates[0],
          latitude: pharmacy.location.coordinates[1],
        },
        phone: pharmacy.phone,
        openingHours: pharmacy.openingHours,
        acceptsReservations: pharmacy.acceptsReservations !== false,
        operationalStatus: pharmacy.operationalStatus,
        verificationStatus: PHARMACY_VERIFICATION_STATUS.APPROVED,
      },
    },
    'Public pharmacy profile fetched successfully'
  );

  res.status(response.statusCode).json(response);
};
