import { HTTP_STATUS } from '../../constants/index.js';
import { USER_ACCOUNT_STATUS, USER_ROLES } from '../../constants/database.enums.js';
import { PLATFORM_AUDIT_ACTIONS } from '../../constants/platform.constants.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { recordAuditLog } from '../../utils/auditLog.js';
import { revokeAllUserSessions } from '../../utils/revokeUserSessions.js';
import { Reservation } from '../reservations/reservation.model.js';
import { User } from '../users/user.model.js';

const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

const toAdminCustomer = (user) => ({
  id: user._id,
  fullName: user.fullName,
  mobileNumber: user.mobileNumber,
  email: user.email,
  accountStatus: user.accountStatus,
  isMobileVerified: user.isMobileVerified,
  isEmailVerified: user.isEmailVerified,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  lastLoginAt: user.lastLoginAt,
});

const buildCustomerFilter = (query) => {
  const filter = { role: USER_ROLES.CUSTOMER };

  if (query.accountStatus) {
    filter.accountStatus = query.accountStatus;
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
    const term = query.search.trim();
    filter.$or = [
      { fullName: { $regex: term, $options: 'i' } },
      { mobileNumber: { $regex: term, $options: 'i' } },
    ];
  }

  return filter;
};

export const listAdminCustomers = async (req, res) => {
  const { page, limit, sortBy, sortOrder } = req.query;
  const filter = buildCustomerFilter(req.query);
  const skip = (page - 1) * limit;
  const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

  const [customers, total] = await Promise.all([
    User.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { customers: customers.map(toAdminCustomer) },
    'Customers fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const getAdminCustomerById = async (req, res) => {
  const customer = await User.findOne({
    _id: req.params.customerId,
    role: USER_ROLES.CUSTOMER,
  }).lean();

  if (!customer) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Customer not found');
  }

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { customer: toAdminCustomer(customer) },
    'Customer fetched successfully'
  );
  res.status(response.statusCode).json(response);
};

export const blockAdminCustomer = async (req, res) => {
  const customer = await User.findOne({
    _id: req.params.customerId,
    role: USER_ROLES.CUSTOMER,
  });

  if (!customer) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Customer not found');
  }

  if (customer.accountStatus === USER_ACCOUNT_STATUS.BLOCKED) {
    const response = new ApiResponse(
      HTTP_STATUS.OK,
      { customer: toAdminCustomer(customer.toObject()) },
      'Customer is already blocked'
    );
    res.status(response.statusCode).json(response);
    return;
  }

  const previousStatus = customer.accountStatus;
  customer.accountStatus = USER_ACCOUNT_STATUS.BLOCKED;
  await customer.save();
  await revokeAllUserSessions(customer._id);

  await recordAuditLog({
    actorId: req.auth.userId,
    action: PLATFORM_AUDIT_ACTIONS.CUSTOMER_BLOCKED,
    resourceType: 'User',
    resourceId: customer._id,
    previousValues: { accountStatus: previousStatus },
    newValues: { accountStatus: USER_ACCOUNT_STATUS.BLOCKED },
    metadata: { reason: req.body.reason },
    req,
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { customer: toAdminCustomer(customer.toObject()) },
    'Customer blocked successfully'
  );
  res.status(response.statusCode).json(response);
};

export const unblockAdminCustomer = async (req, res) => {
  const customer = await User.findOne({
    _id: req.params.customerId,
    role: USER_ROLES.CUSTOMER,
  });

  if (!customer) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Customer not found');
  }

  if (customer.accountStatus === USER_ACCOUNT_STATUS.ACTIVE) {
    const response = new ApiResponse(
      HTTP_STATUS.OK,
      { customer: toAdminCustomer(customer.toObject()) },
      'Customer is already active'
    );
    res.status(response.statusCode).json(response);
    return;
  }

  const previousStatus = customer.accountStatus;
  customer.accountStatus = USER_ACCOUNT_STATUS.ACTIVE;
  await customer.save();

  await recordAuditLog({
    actorId: req.auth.userId,
    action: PLATFORM_AUDIT_ACTIONS.CUSTOMER_UNBLOCKED,
    resourceType: 'User',
    resourceId: customer._id,
    previousValues: { accountStatus: previousStatus },
    newValues: { accountStatus: USER_ACCOUNT_STATUS.ACTIVE },
    metadata: { reason: req.body.reason },
    req,
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { customer: toAdminCustomer(customer.toObject()) },
    'Customer unblocked successfully'
  );
  res.status(response.statusCode).json(response);
};

export const listAdminCustomerReservations = async (req, res) => {
  const customer = await User.findOne({
    _id: req.params.customerId,
    role: USER_ROLES.CUSTOMER,
  }).lean();

  if (!customer) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Customer not found');
  }

  const { page, limit, sortOrder, status } = req.query;
  const filter = { customer: customer._id };

  if (status) {
    filter.status = status;
  }

  const skip = (page - 1) * limit;
  const sort = { createdAt: sortOrder === 'asc' ? 1 : -1 };

  const [reservations, total] = await Promise.all([
    Reservation.find(filter)
      .select('-items.batchAllocations -statusHistory -customerNote')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Reservation.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      reservations: reservations.map((reservation) => ({
        id: reservation._id,
        reservationCode: reservation.reservationCode,
        status: reservation.status,
        pharmacy: reservation.pharmacy,
        paymentMethod: reservation.paymentMethod,
        paymentStatus: reservation.paymentStatus,
        totalAmount: reservation.totalAmount,
        createdAt: reservation.createdAt,
      })),
    },
    'Customer reservations fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};
