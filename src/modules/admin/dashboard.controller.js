import { HTTP_STATUS } from '../../constants/index.js';
import {
  PHARMACY_OPERATIONAL_STATUS,
  PHARMACY_VERIFICATION_STATUS,
  RESERVATION_STATUS,
  USER_ACCOUNT_STATUS,
  USER_ROLES,
} from '../../constants/database.enums.js';
import { PAYMENT_STATUS, REFUND_STATUS } from '../../constants/payment.constants.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { analyticsDateFormat, startOfUtcDay, startOfUtcMonth } from '../../utils/adminDateRanges.js';
import { paiseToRupees } from '../../utils/paymentAmount.js';
import { AuditLog } from '../audit-logs/auditLog.model.js';
import { Payment } from '../payments/payment.model.js';
import { Refund } from '../payments/refund.model.js';
import { Pharmacy } from '../pharmacies/pharmacy.model.js';
import { Reservation } from '../reservations/reservation.model.js';
import { User } from '../users/user.model.js';

const countByStatus = (rows, field = 'status') =>
  rows.reduce((accumulator, row) => {
    accumulator[row[field]] = row.count;
    return accumulator;
  }, {});

const toRecentReservation = (reservation) => ({
  id: reservation._id,
  reservationCode: reservation.reservationCode,
  status: reservation.status,
  pharmacy: reservation.pharmacy,
  createdAt: reservation.createdAt,
});

const toRecentPharmacy = (pharmacy) => ({
  id: pharmacy._id,
  pharmacyName: pharmacy.pharmacyName,
  pharmacyCode: pharmacy.pharmacyCode,
  verificationStatus: pharmacy.verificationStatus,
  operationalStatus: pharmacy.operationalStatus,
  createdAt: pharmacy.createdAt,
});

const toRecentPayment = (payment) => ({
  id: payment._id,
  paymentCode: payment.paymentCode,
  status: payment.status,
  paymentMethod: payment.paymentMethod,
  amountInRupees: paiseToRupees(payment.amount),
  createdAt: payment.createdAt,
});

const toRecentAudit = (entry) => ({
  id: entry._id,
  action: entry.action,
  resourceType: entry.resourceType,
  resourceId: entry.resourceId,
  actor: entry.actor,
  createdAt: entry.createdAt,
});

export const getDashboardOverview = async (_req, res) => {
  const now = new Date();
  const todayStart = startOfUtcDay(now);
  const monthStart = startOfUtcMonth(now);

  const [
    customerStats,
    pharmacyStats,
    reservationStats,
    paymentStats,
    refundTotal,
    recentReservations,
    recentPharmacyRegistrations,
    recentPayments,
    recentAuditActivities,
  ] = await Promise.all([
    User.aggregate([
      { $match: { role: USER_ROLES.CUSTOMER } },
      {
        $facet: {
          totals: [{ $group: { _id: '$accountStatus', count: { $sum: 1 } } }],
          newToday: [{ $match: { createdAt: { $gte: todayStart } } }, { $count: 'count' }],
          newMonth: [{ $match: { createdAt: { $gte: monthStart } } }, { $count: 'count' }],
        },
      },
    ]),
    Pharmacy.aggregate([
      {
        $facet: {
          verification: [{ $group: { _id: '$verificationStatus', count: { $sum: 1 } } }],
          operational: [{ $group: { _id: '$operationalStatus', count: { $sum: 1 } } }],
          total: [{ $count: 'count' }],
        },
      },
    ]),
    Reservation.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Payment.aggregate([
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          capturedAmount: [
            { $match: { status: PAYMENT_STATUS.CAPTURED } },
            { $group: { _id: null, totalPaise: { $sum: '$amount' } } },
          ],
        },
      },
    ]),
    Refund.aggregate([
      { $match: { status: REFUND_STATUS.PROCESSED } },
      { $group: { _id: null, totalPaise: { $sum: '$amount' } } },
    ]),
    Reservation.find({})
      .sort({ createdAt: -1 })
      .limit(8)
      .select('reservationCode status pharmacy createdAt')
      .lean(),
    Pharmacy.find({})
      .sort({ createdAt: -1 })
      .limit(8)
      .select('pharmacyName pharmacyCode verificationStatus operationalStatus createdAt')
      .lean(),
    Payment.find({})
      .sort({ createdAt: -1 })
      .limit(8)
      .select('paymentCode status paymentMethod amount createdAt')
      .lean(),
    AuditLog.find({})
      .sort({ createdAt: -1 })
      .limit(8)
      .select('action resourceType resourceId actor createdAt')
      .lean(),
  ]);

  const customerTotals = countByStatus(customerStats[0]?.totals || [], '_id');
  const verificationTotals = countByStatus(pharmacyStats[0]?.verification || [], '_id');
  const operationalTotals = countByStatus(pharmacyStats[0]?.operational || [], '_id');
  const reservationTotals = countByStatus(reservationStats, '_id');
  const paymentStatusTotals = countByStatus(paymentStats[0]?.byStatus || [], '_id');

  const capturedPaise = paymentStats[0]?.capturedAmount?.[0]?.totalPaise || 0;
  const refundedPaise = refundTotal[0]?.totalPaise || 0;

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      timezone: 'UTC',
      customers: {
        totalCustomers: Object.values(customerTotals).reduce((sum, count) => sum + count, 0),
        activeCustomers: customerTotals[USER_ACCOUNT_STATUS.ACTIVE] || 0,
        blockedCustomers: customerTotals[USER_ACCOUNT_STATUS.BLOCKED] || 0,
        newCustomersToday: customerStats[0]?.newToday?.[0]?.count || 0,
        newCustomersThisMonth: customerStats[0]?.newMonth?.[0]?.count || 0,
      },
      pharmacies: {
        totalPharmacies: pharmacyStats[0]?.total?.[0]?.count || 0,
        pendingApplications: verificationTotals[PHARMACY_VERIFICATION_STATUS.PENDING] || 0,
        approvedPharmacies: verificationTotals[PHARMACY_VERIFICATION_STATUS.APPROVED] || 0,
        activePharmacies: operationalTotals[PHARMACY_OPERATIONAL_STATUS.ACTIVE] || 0,
        suspendedPharmacies: operationalTotals[PHARMACY_OPERATIONAL_STATUS.SUSPENDED] || 0,
        rejectedApplications: verificationTotals[PHARMACY_VERIFICATION_STATUS.REJECTED] || 0,
      },
      reservations: {
        totalReservations: Object.values(reservationTotals).reduce((sum, count) => sum + count, 0),
        pendingReservations: reservationTotals[RESERVATION_STATUS.PENDING] || 0,
        confirmedReservations: reservationTotals[RESERVATION_STATUS.CONFIRMED] || 0,
        rejectedReservations: reservationTotals[RESERVATION_STATUS.REJECTED] || 0,
        expiredReservations: reservationTotals[RESERVATION_STATUS.EXPIRED] || 0,
        cancelledReservations: reservationTotals[RESERVATION_STATUS.CANCELLED] || 0,
        collectedReservations: reservationTotals[RESERVATION_STATUS.COLLECTED] || 0,
      },
      payments: {
        totalTransactions: Object.values(paymentStatusTotals).reduce((sum, count) => sum + count, 0),
        successfulPayments: paymentStatusTotals[PAYMENT_STATUS.CAPTURED] || 0,
        failedPayments: paymentStatusTotals[PAYMENT_STATUS.FAILED] || 0,
        pendingPayments:
          (paymentStatusTotals[PAYMENT_STATUS.PENDING] || 0) +
          (paymentStatusTotals[PAYMENT_STATUS.CREATED] || 0) +
          (paymentStatusTotals[PAYMENT_STATUS.AUTHORIZED] || 0),
        totalCapturedAmountPaise: capturedPaise,
        totalCapturedAmountRupees: paiseToRupees(capturedPaise),
        totalRefundedAmountPaise: refundedPaise,
        totalRefundedAmountRupees: paiseToRupees(refundedPaise),
      },
      platformActivity: {
        recentReservations: recentReservations.map(toRecentReservation),
        recentPharmacyRegistrations: recentPharmacyRegistrations.map(toRecentPharmacy),
        recentPayments: recentPayments.map(toRecentPayment),
        recentAuditActivities: recentAuditActivities.map(toRecentAudit),
      },
    },
    'Dashboard overview fetched successfully'
  );

  res.status(response.statusCode).json(response);
};

const trendPipeline = ({ model, match, dateField, interval, startDate, endDate }) => {
  const format = analyticsDateFormat(interval);

  return model.aggregate([
    {
      $match: {
        ...match,
        [dateField]: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format, date: `$${dateField}`, timezone: 'UTC' },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
};

const paymentTrendPipeline = ({ startDate, endDate, interval }) => {
  const format = analyticsDateFormat(interval);

  return Payment.aggregate([
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
  ]);
};

const refundTrendPipeline = ({ startDate, endDate, interval }) => {
  const format = analyticsDateFormat(interval);

  return Refund.aggregate([
    {
      $match: {
        status: REFUND_STATUS.PROCESSED,
        processedAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format, date: '$processedAt', timezone: 'UTC' } },
        count: { $sum: 1 },
        refundedAmountPaise: { $sum: '$amount' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
};

export const getDashboardAnalytics = async (req, res) => {
  const { startDate, endDate, interval } = req.query;

  const [
    reservationTrends,
    customerRegistrationTrends,
    pharmacyRegistrationTrends,
    paymentCollectionTrends,
    refundTrends,
  ] = await Promise.all([
    trendPipeline({
      model: Reservation,
      match: {},
      dateField: 'createdAt',
      interval,
      startDate,
      endDate,
    }),
    trendPipeline({
      model: User,
      match: { role: USER_ROLES.CUSTOMER },
      dateField: 'createdAt',
      interval,
      startDate,
      endDate,
    }),
    trendPipeline({
      model: Pharmacy,
      match: {},
      dateField: 'createdAt',
      interval,
      startDate,
      endDate,
    }),
    paymentTrendPipeline({ startDate, endDate, interval }),
    refundTrendPipeline({ startDate, endDate, interval }),
  ]);

  const mapTrend = (rows, amountField) =>
    rows.map((row) => ({
      period: row._id,
      count: row.count,
      ...(amountField ? { [`${amountField}Paise`]: row[amountField] || 0 } : {}),
    }));

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      timezone: 'UTC',
      interval,
      startDate,
      endDate,
      reservationTrends: mapTrend(reservationTrends),
      customerRegistrationTrends: mapTrend(customerRegistrationTrends),
      pharmacyRegistrationTrends: mapTrend(pharmacyRegistrationTrends),
      paymentCollectionTrends: mapTrend(paymentCollectionTrends, 'capturedAmount'),
      refundTrends: mapTrend(refundTrends, 'refundedAmount'),
    },
    'Dashboard analytics fetched successfully'
  );

  res.status(response.statusCode).json(response);
};
