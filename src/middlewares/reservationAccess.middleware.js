import { HTTP_STATUS } from '../constants/index.js';
import { PHARMACY_STAFF_RESERVATION_PERMISSION } from '../constants/reservation.constants.js';
import { hasPermission } from '../constants/rbac.js';
import { EMPLOYMENT_STATUS, USER_ROLES } from '../constants/database.enums.js';
import { ApiError } from '../utils/ApiError.js';
import { Pharmacy } from '../modules/pharmacies/pharmacy.model.js';
import { PharmacyStaff } from '../modules/pharmacy-staff/pharmacyStaff.model.js';

const staffCanManageReservations = (staffRecord) => {
  if (!staffRecord) {
    return false;
  }

  if (staffRecord.permissions.length === 0) {
    return hasPermission(USER_ROLES.PHARMACY_STAFF, 'reservation:manage:assigned-pharmacy');
  }

  return staffRecord.permissions.includes(PHARMACY_STAFF_RESERVATION_PERMISSION);
};

export const resolveReservationPharmacyContext = async (req, _res, next) => {
  const { role, userId } = req.auth;

  if (role === USER_ROLES.PHARMACY_OWNER) {
    const pharmacy = await Pharmacy.findOne({ owner: userId }).lean();
    if (!pharmacy) {
      next(new ApiError(HTTP_STATUS.NOT_FOUND, 'Pharmacy not found for this owner'));
      return;
    }

    req.pharmacy = pharmacy;
    req.pharmacyId = pharmacy._id.toString();
    next();
    return;
  }

  if (role === USER_ROLES.PHARMACY_STAFF) {
    const staffRecord = await PharmacyStaff.findOne({
      user: userId,
      employmentStatus: EMPLOYMENT_STATUS.ACTIVE,
    }).lean();

    if (!staffRecord || !staffCanManageReservations(staffRecord)) {
      next(new ApiError(HTTP_STATUS.FORBIDDEN, 'Reservation management permission is required'));
      return;
    }

    const pharmacy = await Pharmacy.findById(staffRecord.pharmacy).lean();
    if (!pharmacy) {
      next(new ApiError(HTTP_STATUS.NOT_FOUND, 'Assigned pharmacy not found'));
      return;
    }

    req.pharmacy = pharmacy;
    req.pharmacyId = pharmacy._id.toString();
    req.pharmacyStaff = staffRecord;
    next();
    return;
  }

  next(new ApiError(HTTP_STATUS.FORBIDDEN, 'You do not have permission to manage reservations'));
};

export const requireReservationManagementPermission = (req, _res, next) => {
  const { role } = req.auth;

  if (role === USER_ROLES.PHARMACY_OWNER && hasPermission(role, 'reservation:manage:own-pharmacy')) {
    next();
    return;
  }

  if (role === USER_ROLES.PHARMACY_STAFF && req.pharmacyStaff && staffCanManageReservations(req.pharmacyStaff)) {
    next();
    return;
  }

  next(new ApiError(HTTP_STATUS.FORBIDDEN, 'Reservation management permission is required'));
};
