import { HTTP_STATUS } from '../constants/index.js';
import { PHARMACY_STAFF_PERMISSIONS } from '../constants/inventory.constants.js';
import { hasPermission } from '../constants/rbac.js';
import {
  EMPLOYMENT_STATUS,
  USER_ROLES,
} from '../constants/database.enums.js';
import { ApiError } from '../utils/ApiError.js';
import { Pharmacy } from '../modules/pharmacies/pharmacy.model.js';
import { PharmacyStaff } from '../modules/pharmacy-staff/pharmacyStaff.model.js';

const staffCanManageInventory = (staffRecord) => {
  if (!staffRecord) {
    return false;
  }

  if (staffRecord.permissions.length === 0) {
    return hasPermission(USER_ROLES.PHARMACY_STAFF, 'inventory:manage:assigned');
  }

  return staffRecord.permissions.includes(PHARMACY_STAFF_PERMISSIONS.INVENTORY_MANAGE);
};

export const resolveInventoryPharmacyContext = async (req, _res, next) => {
  const { role, userId } = req.auth;

  if (role === USER_ROLES.PHARMACY_OWNER) {
    const pharmacy = await Pharmacy.findOne({ owner: userId }).lean();

    if (!pharmacy) {
      next(new ApiError(HTTP_STATUS.NOT_FOUND, 'Pharmacy not found for this owner'));
      return;
    }

    req.pharmacy = pharmacy;
    req.pharmacyId = pharmacy._id.toString();
    req.canViewPurchasePrice = true;
    next();
    return;
  }

  if (role === USER_ROLES.PHARMACY_STAFF) {
    const staffRecord = await PharmacyStaff.findOne({
      user: userId,
      employmentStatus: EMPLOYMENT_STATUS.ACTIVE,
    }).lean();

    if (!staffRecord || !staffCanManageInventory(staffRecord)) {
      next(new ApiError(HTTP_STATUS.FORBIDDEN, 'Inventory management permission is required'));
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
    req.canViewPurchasePrice = staffRecord.permissions.includes('inventory:purchase:read');
    next();
    return;
  }

  if (role === USER_ROLES.SUPER_ADMIN) {
    req.canViewPurchasePrice = true;
    next();
    return;
  }

  if (role === USER_ROLES.OPERATIONS_ADMIN && hasPermission(role, 'platform:operations:manage')) {
    req.canViewPurchasePrice = true;
    next();
    return;
  }

  next(new ApiError(HTTP_STATUS.FORBIDDEN, 'You do not have permission to manage inventory'));
};

export const requireInventoryManagementPermission = (req, _res, next) => {
  const { role } = req.auth;

  if (role === USER_ROLES.PHARMACY_OWNER && hasPermission(role, 'inventory:manage:own')) {
    next();
    return;
  }

  if (role === USER_ROLES.PHARMACY_STAFF && req.pharmacyStaff && staffCanManageInventory(req.pharmacyStaff)) {
    next();
    return;
  }

  if (role === USER_ROLES.SUPER_ADMIN) {
    next();
    return;
  }

  next(new ApiError(HTTP_STATUS.FORBIDDEN, 'Inventory management permission is required'));
};
