import bcrypt from 'bcrypt';
import { HTTP_STATUS } from '../../constants/index.js';
import { EMPLOYMENT_STATUS, USER_ACCOUNT_STATUS, USER_ROLES } from '../../constants/database.enums.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { normalizeIndianMobile } from '../../utils/schemaValidators.js';
import { User } from '../users/user.model.js';
import { PharmacyStaff } from './pharmacyStaff.model.js';

const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

const staffPermissionsForDesignation = (designation) =>
  designation === 'PHARMACIST' ? ['inventory:manage', 'reservation:manage'] : ['inventory:manage'];

const toStaffResponse = (row) => ({
  id: row._id,
  pharmacyId: row.pharmacy,
  userId: row.user?._id || row.user,
  name: row.user?.fullName,
  email: row.user?.email,
  mobile: row.user?.mobileNumber,
  username: row.user?.username,
  role: row.designation,
  designation: row.designation,
  status: row.employmentStatus,
  permissions: row.permissions,
  joinedAt: row.joinedAt,
  isOwner: false,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const listPharmacyStaff = async (req, res) => {
  const { page, limit } = req.query;
  const filter = { pharmacy: req.pharmacy._id };

  const [rows, total] = await Promise.all([
    PharmacyStaff.find(filter)
      .populate('user', 'fullName email mobileNumber username accountStatus')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PharmacyStaff.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { staff: rows.map(toStaffResponse) },
    'Pharmacy staff fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const invitePharmacyStaff = async (req, res) => {
  const username = req.body.username.trim().toLowerCase();
  const mobileNumber = normalizeIndianMobile(req.body.mobileNumber);
  const designation = req.body.designation || 'STAFF';

  const [existingUsername, existingMobile, existingEmail] = await Promise.all([
    User.findOne({ username }).lean(),
    User.findOne({ mobileNumber }).lean(),
    User.findOne({ email: req.body.email.trim().toLowerCase() }).lean(),
  ]);

  if (existingUsername) throw new ApiError(HTTP_STATUS.CONFLICT, 'Username already exists');
  if (existingMobile) throw new ApiError(HTTP_STATUS.CONFLICT, 'Mobile number already exists');
  if (existingEmail) throw new ApiError(HTTP_STATUS.CONFLICT, 'Email already exists');

  const passwordHash = await bcrypt.hash(req.body.password, env.bcryptSaltRounds);
  const user = await User.create({
    fullName: req.body.fullName.trim(),
    username,
    passwordHash,
    email: req.body.email,
    mobileNumber,
    role: USER_ROLES.PHARMACY_STAFF,
    accountStatus: USER_ACCOUNT_STATUS.ACTIVE,
  });

  const staff = await PharmacyStaff.create({
    user: user._id,
    pharmacy: req.pharmacy._id,
    designation,
    permissions: staffPermissionsForDesignation(designation),
    employmentStatus: EMPLOYMENT_STATUS.ACTIVE,
    invitedBy: req.auth.userId,
  });

  const populated = await PharmacyStaff.findById(staff._id)
    .populate('user', 'fullName email mobileNumber username accountStatus')
    .lean();

  const response = new ApiResponse(
    HTTP_STATUS.CREATED,
    { staff: toStaffResponse(populated) },
    'Staff member created successfully'
  );
  res.status(response.statusCode).json(response);
};

export const updatePharmacyStaff = async (req, res) => {
  const staff = await PharmacyStaff.findOne({
    _id: req.params.staffId,
    pharmacy: req.pharmacy._id,
  });

  if (!staff) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Staff member not found');

  if (req.body.designation) {
    staff.designation = req.body.designation;
    staff.permissions = staffPermissionsForDesignation(req.body.designation);
  }

  if (req.body.employmentStatus) {
    staff.employmentStatus = req.body.employmentStatus;
  }

  await staff.save();

  const populated = await PharmacyStaff.findById(staff._id)
    .populate('user', 'fullName email mobileNumber username accountStatus')
    .lean();

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { staff: toStaffResponse(populated) },
    'Staff member updated successfully'
  );
  res.status(response.statusCode).json(response);
};
