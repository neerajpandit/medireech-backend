import { HTTP_STATUS } from '../../constants/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { Reservation } from '../reservations/reservation.model.js';

const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

const toAdminReservation = (reservation) => ({
  id: reservation._id,
  reservationCode: reservation.reservationCode,
  status: reservation.status,
  customer: reservation.customer,
  pharmacy: reservation.pharmacy,
  paymentMethod: reservation.paymentMethod,
  paymentStatus: reservation.paymentStatus,
  totalAmount: reservation.totalAmount,
  expiresAt: reservation.expiresAt,
  confirmedAt: reservation.confirmedAt,
  readyAt: reservation.readyAt,
  collectedAt: reservation.collectedAt,
  cancelledAt: reservation.cancelledAt,
  createdAt: reservation.createdAt,
  updatedAt: reservation.updatedAt,
});

const buildReservationFilter = (query) => {
  const filter = {};

  if (query.status) {
    filter.status = query.status;
  }

  if (query.customerId) {
    filter.customer = query.customerId;
  }

  if (query.pharmacyId) {
    filter.pharmacy = query.pharmacyId;
  }

  if (query.reservationCode) {
    filter.reservationCode = query.reservationCode.trim().toUpperCase();
  }

  if (query.fromDate || query.toDate) {
    filter.createdAt = {};
    if (query.fromDate) {
      filter.createdAt.$gte = new Date(query.fromDate);
    }
    if (query.toDate) {
      filter.createdAt.$lte = new Date(query.toDate);
    }
  }

  return filter;
};

export const listAdminReservations = async (req, res) => {
  const { page, limit, sortBy, sortOrder } = req.query;
  const filter = buildReservationFilter(req.query);
  const skip = (page - 1) * limit;
  const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

  const [reservations, total] = await Promise.all([
    Reservation.find(filter)
      .select('-items -statusHistory -customerNote -pharmacyNote -prescription')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Reservation.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { reservations: reservations.map(toAdminReservation) },
    'Reservations fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const getAdminReservationById = async (req, res) => {
  const reservation = await Reservation.findById(req.params.reservationId)
    .select('-prescription')
    .lean();

  if (!reservation) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Reservation not found');
  }

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      reservation: {
        ...toAdminReservation(reservation),
        items: (reservation.items || []).map((item) => ({
          id: item._id,
          medicineName: item.medicineName,
          strength: item.strength,
          dosageForm: item.dosageForm,
          quantity: item.quantity,
          acceptedUnitPrice: item.acceptedUnitPrice,
          unitPriceAtRequest: item.unitPrice,
        })),
        rejectionReason: reservation.rejectionReason,
      },
    },
    'Reservation fetched successfully'
  );
  res.status(response.statusCode).json(response);
};
