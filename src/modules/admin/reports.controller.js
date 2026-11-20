import { HTTP_STATUS } from '../../constants/index.js';
import { USER_ROLES } from '../../constants/database.enums.js';
import { PAYMENT_STATUS, REFUND_STATUS } from '../../constants/payment.constants.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { analyticsDateFormat } from '../../utils/adminDateRanges.js';
import { paiseToRupees } from '../../utils/paymentAmount.js';
import { Payment } from '../payments/payment.model.js';
import { Refund } from '../payments/refund.model.js';
import { Pharmacy } from '../pharmacies/pharmacy.model.js';
import { Reservation } from '../reservations/reservation.model.js';
import { User } from '../users/user.model.js';

const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

const groupedCountReport = async ({ model, match, dateField, startDate, endDate, groupBy }) => {
  const format = analyticsDateFormat(groupBy);

  return model.aggregate([
    {
      $match: {
        ...match,
        [dateField]: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format, date: `$${dateField}`, timezone: 'UTC' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
};

export const getReservationReport = async (req, res) => {
  const { startDate, endDate, groupBy, page, limit } = req.query;

  const [summary, statusBreakdown, rows, totalRows] = await Promise.all([
    groupedCountReport({
      model: Reservation,
      match: {},
      dateField: 'createdAt',
      startDate,
      endDate,
      groupBy,
    }),
    Reservation.aggregate([
      { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Reservation.find({ createdAt: { $gte: startDate, $lte: endDate } })
      .select('reservationCode status pharmacy customer createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Reservation.countDocuments({ createdAt: { $gte: startDate, $lte: endDate } }),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      timezone: 'UTC',
      trends: summary.map((row) => ({ period: row._id, count: row.count })),
      statusBreakdown: statusBreakdown.map((row) => ({ status: row._id, count: row.count })),
      rows,
    },
    'Reservation report generated successfully',
    paginationMeta(page, limit, totalRows)
  );
  res.status(response.statusCode).json(response);
};

export const getPaymentReport = async (req, res) => {
  const { startDate, endDate, groupBy, page, limit } = req.query;
  const format = analyticsDateFormat(groupBy);

  const [capturedTrend, summary, rows, totalRows] = await Promise.all([
    Payment.aggregate([
      {
        $match: {
          status: PAYMENT_STATUS.CAPTURED,
          capturedAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format, date: '$capturedAt', timezone: 'UTC' } },
          count: { $sum: 1 },
          capturedAmountPaise: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Payment.aggregate([
      { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Payment.find({ createdAt: { $gte: startDate, $lte: endDate } })
      .select('paymentCode status paymentMethod amount createdAt capturedAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Payment.countDocuments({ createdAt: { $gte: startDate, $lte: endDate } }),
  ]);

  const capturedTotalPaise = capturedTrend.reduce((sum, row) => sum + (row.capturedAmountPaise || 0), 0);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      timezone: 'UTC',
      capturedTrends: capturedTrend.map((row) => ({
        period: row._id,
        count: row.count,
        capturedAmountPaise: row.capturedAmountPaise,
        capturedAmountRupees: paiseToRupees(row.capturedAmountPaise),
      })),
      statusBreakdown: summary.map((row) => ({ status: row._id, count: row.count })),
      totals: {
        capturedAmountPaise: capturedTotalPaise,
        capturedAmountRupees: paiseToRupees(capturedTotalPaise),
      },
      rows: rows.map((payment) => ({
        ...payment,
        amountInRupees: paiseToRupees(payment.amount),
      })),
    },
    'Payment report generated successfully',
    paginationMeta(page, limit, totalRows)
  );
  res.status(response.statusCode).json(response);
};

export const getPharmacyReport = async (req, res) => {
  const { startDate, endDate, groupBy, page, limit } = req.query;

  const [trends, verificationBreakdown, rows, totalRows] = await Promise.all([
    groupedCountReport({
      model: Pharmacy,
      match: {},
      dateField: 'createdAt',
      startDate,
      endDate,
      groupBy,
    }),
    Pharmacy.aggregate([
      { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: '$verificationStatus', count: { $sum: 1 } } },
    ]),
    Pharmacy.find({ createdAt: { $gte: startDate, $lte: endDate } })
      .select('pharmacyName pharmacyCode verificationStatus operationalStatus createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Pharmacy.countDocuments({ createdAt: { $gte: startDate, $lte: endDate } }),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      timezone: 'UTC',
      registrationTrends: trends.map((row) => ({ period: row._id, count: row.count })),
      verificationBreakdown: verificationBreakdown.map((row) => ({
        verificationStatus: row._id,
        count: row.count,
      })),
      rows,
    },
    'Pharmacy report generated successfully',
    paginationMeta(page, limit, totalRows)
  );
  res.status(response.statusCode).json(response);
};

export const getCustomerReport = async (req, res) => {
  const { startDate, endDate, groupBy, page, limit } = req.query;

  const [trends, statusBreakdown, rows, totalRows] = await Promise.all([
    groupedCountReport({
      model: User,
      match: { role: USER_ROLES.CUSTOMER },
      dateField: 'createdAt',
      startDate,
      endDate,
      groupBy,
    }),
    User.aggregate([
      {
        $match: {
          role: USER_ROLES.CUSTOMER,
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      { $group: { _id: '$accountStatus', count: { $sum: 1 } } },
    ]),
    User.find({
      role: USER_ROLES.CUSTOMER,
      createdAt: { $gte: startDate, $lte: endDate },
    })
      .select('fullName mobileNumber accountStatus createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments({
      role: USER_ROLES.CUSTOMER,
      createdAt: { $gte: startDate, $lte: endDate },
    }),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      timezone: 'UTC',
      registrationTrends: trends.map((row) => ({ period: row._id, count: row.count })),
      statusBreakdown: statusBreakdown.map((row) => ({ accountStatus: row._id, count: row.count })),
      rows,
    },
    'Customer report generated successfully',
    paginationMeta(page, limit, totalRows)
  );
  res.status(response.statusCode).json(response);
};
