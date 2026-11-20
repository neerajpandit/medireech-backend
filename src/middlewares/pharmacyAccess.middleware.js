import { HTTP_STATUS } from '../constants/index.js';
import {
  PHARMACY_OPERATIONAL_STATUS,
  PHARMACY_VERIFICATION_STATUS,
  USER_ROLES,
} from '../constants/database.enums.js';
import { ApiError } from '../utils/ApiError.js';
import { Pharmacy } from '../modules/pharmacies/pharmacy.model.js';

export const loadOwnedPharmacy = async (req, _res, next) => {
  if (req.auth?.role !== USER_ROLES.PHARMACY_OWNER) {
    next(new ApiError(HTTP_STATUS.FORBIDDEN, 'Only pharmacy owners can access this resource'));
    return;
  }

  const pharmacy = await Pharmacy.findOne({ owner: req.auth.userId }).select(
    '+verificationDocuments.fileKey'
  );

  if (!pharmacy) {
    next(new ApiError(HTTP_STATUS.NOT_FOUND, 'Pharmacy application not found for this owner'));
    return;
  }

  req.pharmacy = pharmacy;
  next();
};

export const requirePharmacyOperational = async (req, _res, next) => {
  const pharmacyId = req.pharmacy?._id || req.params.pharmacyId;

  if (!pharmacyId) {
    next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'Pharmacy context is required'));
    return;
  }

  const pharmacy = await Pharmacy.findById(pharmacyId).lean();

  if (!pharmacy) {
    next(new ApiError(HTTP_STATUS.NOT_FOUND, 'Pharmacy not found'));
    return;
  }

  const isOperational =
    pharmacy.verificationStatus === PHARMACY_VERIFICATION_STATUS.APPROVED &&
    pharmacy.operationalStatus === PHARMACY_OPERATIONAL_STATUS.ACTIVE;

  if (!isOperational) {
    next(
      new ApiError(
        HTTP_STATUS.FORBIDDEN,
        'Pharmacy must be approved and operationally active for this action'
      )
    );
    return;
  }

  req.pharmacy = pharmacy;
  next();
};
