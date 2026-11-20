import { HTTP_STATUS } from '../../constants/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { Inventory } from '../inventory/inventory.model.js';
import { Reservation } from '../reservations/reservation.model.js';
import { User } from '../users/user.model.js';
import { Pharmacy } from '../pharmacies/pharmacy.model.js';

const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

const toPlatformPharmacy = (pharmacy, owner) => ({
  id: pharmacy._id,
  pharmacyCode: pharmacy.pharmacyCode,
  pharmacyName: pharmacy.pharmacyName,
  registrationNumber: pharmacy.registrationNumber,
  drugLicenseNumber: pharmacy.drugLicenseNumber,
  phone: pharmacy.phone,
  email: pharmacy.email,
  verificationStatus: pharmacy.verificationStatus,
  operationalStatus: pharmacy.operationalStatus,
  actionRequiredReason: pharmacy.actionRequiredReason,
  verifiedAt: pharmacy.verifiedAt,
  openingHours: pharmacy.openingHours,
  address: pharmacy.address,
  location: pharmacy.location
    ? {
        longitude: pharmacy.location.coordinates?.[0],
        latitude: pharmacy.location.coordinates?.[1],
      }
    : undefined,
  verificationDocuments: (pharmacy.verificationDocuments || []).map((document) => ({
    documentType: document.documentType,
    fileType: document.fileType,
    uploadedAt: document.uploadedAt,
  })),
  applicationTimeline: pharmacy.applicationHistory,
  owner: owner
    ? {
        id: owner._id,
        fullName: owner.fullName,
        username: owner.username,
        email: owner.email,
        mobileNumber: owner.mobileNumber,
        accountStatus: owner.accountStatus,
      }
    : undefined,
  createdAt: pharmacy.createdAt,
  updatedAt: pharmacy.updatedAt,
});

const buildPharmacyFilter = (query) => {
  const filter = {};

  if (query.verificationStatus) {
    filter.verificationStatus = query.verificationStatus;
  }

  if (query.operationalStatus) {
    filter.operationalStatus = query.operationalStatus;
  }

  if (query.city) {
    filter['address.city'] = query.city;
  }

  if (query.state) {
    filter['address.state'] = query.state;
  }

  if (query.search) {
    filter.pharmacyName = { $regex: query.search.trim(), $options: 'i' };
  }

  return filter;
};

export const listPlatformPharmacies = async (req, res) => {
  const { page, limit, sortBy, sortOrder } = req.query;
  const filter = buildPharmacyFilter(req.query);
  const skip = (page - 1) * limit;
  const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

  const [pharmacies, total] = await Promise.all([
    Pharmacy.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Pharmacy.countDocuments(filter),
  ]);

  const owners = await User.find({ _id: { $in: pharmacies.map((pharmacy) => pharmacy.owner) } }).lean();
  const ownerMap = new Map(owners.map((owner) => [owner._id.toString(), owner]));

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      pharmacies: pharmacies.map((pharmacy) =>
        toPlatformPharmacy(pharmacy, ownerMap.get(pharmacy.owner.toString()))
      ),
    },
    'Pharmacies fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const getPlatformPharmacyById = async (req, res) => {
  const pharmacy = await Pharmacy.findById(req.params.pharmacyId).lean();

  if (!pharmacy) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Pharmacy not found');
  }

  const owner = await User.findById(pharmacy.owner).lean();

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { pharmacy: toPlatformPharmacy(pharmacy, owner) },
    'Pharmacy fetched successfully'
  );
  res.status(response.statusCode).json(response);
};

export const getPlatformPharmacyInventory = async (req, res) => {
  const pharmacy = await Pharmacy.findById(req.params.pharmacyId).select('_id').lean();

  if (!pharmacy) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Pharmacy not found');
  }

  const { page, limit } = req.query;
  const skip = (page - 1) * limit;

  const [inventory, total] = await Promise.all([
    Inventory.find({ pharmacy: pharmacy._id, isActive: true })
      .populate('medicine', 'name strength dosageForm')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Inventory.countDocuments({ pharmacy: pharmacy._id, isActive: true }),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      inventory: inventory.map((entry) => ({
        id: entry._id,
        medicine: entry.medicine,
        batchCount: entry.batches?.length || 0,
        updatedAt: entry.updatedAt,
      })),
    },
    'Pharmacy inventory fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const getPlatformPharmacyReservations = async (req, res) => {
  const pharmacy = await Pharmacy.findById(req.params.pharmacyId).select('_id').lean();

  if (!pharmacy) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Pharmacy not found');
  }

  const { page, limit, sortOrder, status } = req.query;
  const filter = { pharmacy: pharmacy._id };

  if (status) {
    filter.status = status;
  }

  const skip = (page - 1) * limit;
  const sort = { createdAt: sortOrder === 'asc' ? 1 : -1 };

  const [reservations, total] = await Promise.all([
    Reservation.find(filter)
      .select('reservationCode status customer paymentStatus createdAt')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Reservation.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { reservations },
    'Pharmacy reservations fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};
