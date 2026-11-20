import mongoose from 'mongoose';
import { HTTP_STATUS } from '../../constants/index.js';
import {
  PHARMACY_OPERATIONAL_STATUS,
  PHARMACY_VERIFICATION_STATUS,
  PRESCRIPTION_TYPES,
  RESERVATION_STATUS,
  USER_ROLES,
} from '../../constants/database.enums.js';
import { RESERVATION_NOTIFICATION_EVENTS } from '../../constants/reservation.constants.js';
import { STOCK_MOVEMENT_TYPES } from '../../constants/inventory.constants.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import {
  computeInventorySellableQuantity,
  getLowestActiveBatchMrp,
  getLowestActiveBatchPrice,
} from '../../utils/inventoryStock.js';
import { generateReservationCode } from '../../utils/reservationCode.js';
import {
  calculateWeightedUnitPrice,
  planFefoBatchAllocations,
} from '../../utils/reservationFefo.js';
import { enqueueReservationNotification } from '../../utils/enqueueNotificationOutbox.js';
import {
  atomicallyCollectBatchStock,
  atomicallyDecreaseBatchReserved,
  atomicallyIncreaseBatchReserved,
} from '../../utils/reservationStock.js';
import { applySession, runWithTransactionRetry, sessionOption } from '../../utils/transactionRetry.js';
import { Inventory } from '../inventory/inventory.model.js';
import { StockMovement } from '../inventory/stockMovement.model.js';
import { Medicine } from '../medicines/medicine.model.js';
import { Pharmacy } from '../pharmacies/pharmacy.model.js';
import { Prescription } from '../prescriptions/prescription.model.js';
import { initializePaymentForConfirmedReservation } from '../../utils/paymentLifecycle.js';
import { PAYMENT_METHODS, PAYMENT_STATUS } from '../../constants/payment.constants.js';
import { Reservation } from './reservation.model.js';

const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

const appendStatusHistory = (reservation, { status, changedBy, actorRole, reason }) => {
  reservation.statusHistory.push({
    status,
    changedBy,
    actorRole,
    reason,
    changedAt: new Date(),
  });
};

const assertOperationalPharmacy = (pharmacy) => {
  const isOperational =
    pharmacy.verificationStatus === PHARMACY_VERIFICATION_STATUS.APPROVED &&
    pharmacy.operationalStatus === PHARMACY_OPERATIONAL_STATUS.ACTIVE;

  if (!isOperational) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Pharmacy must be approved and active');
  }

  if (pharmacy.acceptsReservations === false) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Pharmacy is not accepting reservations');
  }
};

const toReservationResponse = (reservation, { includePrescriptionId = false } = {}) => ({
  id: reservation._id,
  reservationCode: reservation.reservationCode,
  status: reservation.status,
  pharmacy: reservation.pharmacy,
  customer: reservation.customer,
  items: (reservation.items || []).map((item) => ({
    id: item._id,
    medicine: item.medicine,
    inventory: item.inventory,
    medicineName: item.medicineName,
    strength: item.strength,
    dosageForm: item.dosageForm,
    quantity: item.quantity,
    unitPriceAtRequest: item.unitPrice,
    mrpAtRequest: item.mrpAtRequest,
    acceptedUnitPrice: item.acceptedUnitPrice,
    batchAllocations: (item.batchAllocations || []).map((allocation) => ({
      batchNumber: allocation.batchNumber,
      quantity: allocation.quantity,
      unitPrice: allocation.unitPrice,
    })),
  })),
  prescription: includePrescriptionId ? reservation.prescription : undefined,
  customerNote: reservation.customerNote,
  pharmacyNote: reservation.pharmacyNote,
  rejectionReason: reservation.rejectionReason,
  expiresAt: reservation.expiresAt,
  confirmedAt: reservation.confirmedAt,
  readyAt: reservation.readyAt,
  collectedAt: reservation.collectedAt,
  cancelledAt: reservation.cancelledAt,
  statusHistory: reservation.statusHistory,
  createdAt: reservation.createdAt,
  updatedAt: reservation.updatedAt,
});

const notifyPharmacyAboutReservation = async ({
  eventType,
  pharmacyId,
  reservationId,
  payload = {},
  idempotencyKey,
  session,
  ownerId,
}) => {
  let owner = ownerId;
  if (!owner) {
    let ownerQuery = Pharmacy.findById(pharmacyId).select('owner');
    if (session) {
      ownerQuery = ownerQuery.session(session);
    }

    owner = (await ownerQuery.lean())?.owner;
  }

  if (!owner) {
    return;
  }

  await enqueueReservationNotification({
    eventType,
    recipientUserId: owner,
    recipientType: 'PHARMACY',
    recipientId: pharmacyId,
    reservationId,
    payload: { ...payload, pharmacyId },
    idempotencyKey,
    session,
  });
};

const notifyCustomerAboutReservation = async ({
  eventType,
  customerId,
  reservationId,
  payload = {},
  idempotencyKey,
  session,
}) => {
  await enqueueReservationNotification({
    eventType,
    recipientUserId: customerId,
    recipientType: 'USER',
    recipientId: customerId,
    reservationId,
    payload,
    idempotencyKey,
    session,
  });
};

const recordStockMovement = async ({
  session,
  pharmacyId,
  inventoryId,
  medicineId,
  batchId,
  batchNumber,
  movementType,
  quantity,
  previousPhysicalQuantity,
  newPhysicalQuantity,
  previousReservedQuantity,
  newReservedQuantity,
  reason,
  referenceId,
  performedBy,
}) => {
  await StockMovement.create(
    [
      {
        pharmacy: pharmacyId,
        inventory: inventoryId,
        medicine: medicineId,
        batchId,
        batchNumber,
        movementType,
        quantity,
        previousPhysicalQuantity,
        newPhysicalQuantity,
        previousReservedQuantity,
        newReservedQuantity,
        reason,
        referenceId,
        performedBy,
      },
    ],
    sessionOption(session)
  );
};

export const createReservation = async (req, res) => {
  const { pharmacyId, items, prescriptionId, customerNote, idempotencyKey, paymentMethod } = req.body;
  const customerId = req.auth.userId;
  const now = new Date();

  if (idempotencyKey) {
    const existing = await Reservation.findOne({ customer: customerId, idempotencyKey }).lean();
    if (existing) {
      const response = new ApiResponse(
        HTTP_STATUS.OK,
        { reservation: toReservationResponse(existing) },
        'Reservation already created for this idempotency key'
      );
      res.status(response.statusCode).json(response);
      return;
    }
  }

  const pharmacy = await Pharmacy.findById(pharmacyId).lean();
  if (!pharmacy) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Pharmacy not found');
  }

  assertOperationalPharmacy(pharmacy);

  const medicineIds = items.map((item) => item.medicineId);
  const medicines = await Medicine.find({ _id: { $in: medicineIds }, isActive: true }).lean();
  if (medicines.length !== medicineIds.length) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'One or more medicines are invalid or inactive');
  }

  const medicineById = new Map(medicines.map((medicine) => [medicine._id.toString(), medicine]));

  for (const medicine of medicines) {
    if (medicine.prescriptionType !== PRESCRIPTION_TYPES.OTC) {
      if (!prescriptionId) {
        throw new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          'Prescription is required for prescription-only medicines'
        );
      }
    }
  }

  if (prescriptionId) {
    const prescription = await Prescription.findOne({
      _id: prescriptionId,
      customer: customerId,
    }).lean();

    if (!prescription) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Prescription not found for this customer');
    }
  }

  const reservationItems = [];

  for (const item of items) {
    const medicine = medicineById.get(item.medicineId);
    const inventory = await Inventory.findOne({
      pharmacy: pharmacyId,
      medicine: item.medicineId,
      isActive: true,
    }).lean();

    if (!inventory) {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        `Medicine ${medicine.name} is not stocked at the selected pharmacy`
      );
    }

    const sellableQuantity = computeInventorySellableQuantity(inventory, now);
    if (sellableQuantity < item.quantity) {
      throw new ApiError(
        HTTP_STATUS.CONFLICT,
        `Insufficient available stock for ${medicine.name}. Availability is not guaranteed until the pharmacy confirms your reservation.`
      );
    }

    reservationItems.push({
      medicine: medicine._id,
      inventory: inventory._id,
      medicineName: medicine.name,
      strength: medicine.strength,
      dosageForm: medicine.dosageForm,
      quantity: item.quantity,
      unitPrice: getLowestActiveBatchPrice(inventory, now),
      mrpAtRequest: getLowestActiveBatchMrp(inventory, now),
      batchAllocations: [],
    });
  }

  const createdAt = new Date();
  const expiresAt = Reservation.buildPendingExpiry(createdAt);

  let reservation;
  try {
    reservation = await Reservation.create({
      reservationCode: generateReservationCode(),
      customer: customerId,
      pharmacy: pharmacyId,
      items: reservationItems,
      prescription: prescriptionId || undefined,
      status: RESERVATION_STATUS.PENDING,
      paymentMethod: paymentMethod || PAYMENT_METHODS.PAY_AT_PHARMACY,
      paymentStatus: PAYMENT_STATUS.NOT_REQUIRED,
      customerNote,
      expiresAt,
      idempotencyKey,
      statusHistory: [
        {
          status: RESERVATION_STATUS.PENDING,
          changedBy: customerId,
          actorRole: USER_ROLES.CUSTOMER,
          reason: 'Reservation request submitted',
          changedAt: createdAt,
        },
      ],
    });
  } catch (error) {
    if (error?.code === 11000 && idempotencyKey) {
      const existing = await Reservation.findOne({ customer: customerId, idempotencyKey });
      const response = new ApiResponse(
        HTTP_STATUS.OK,
        { reservation: toReservationResponse(existing) },
        'Reservation already created for this idempotency key'
      );
      res.status(response.statusCode).json(response);
      return;
    }

    throw error;
  }

  await notifyPharmacyAboutReservation({
    eventType: RESERVATION_NOTIFICATION_EVENTS.RESERVATION_CREATED,
    pharmacyId,
    ownerId: pharmacy.owner,
    reservationId: reservation._id,
    payload: { reservationCode: reservation.reservationCode },
    idempotencyKey: `reservation-created:${reservation._id.toString()}`,
  });

  const response = new ApiResponse(
    HTTP_STATUS.CREATED,
    { reservation: toReservationResponse(reservation) },
    'Reservation request submitted successfully'
  );
  res.status(response.statusCode).json(response);
};

export const listMyReservations = async (req, res) => {
  const { page, limit, sortBy, sortOrder, status } = req.query;
  const filter = { customer: req.auth.userId };
  if (status) {
    filter.status = status;
  }

  const skip = (page - 1) * limit;
  const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

  const [reservations, total] = await Promise.all([
    Reservation.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Reservation.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { reservations: reservations.map((reservation) => toReservationResponse(reservation)) },
    'Customer reservations fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const getReservationById = async (req, res) => {
  const reservation = await Reservation.findOne({
    _id: req.params.reservationId,
    customer: req.auth.userId,
  }).lean();

  if (!reservation) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Reservation not found');
  }

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { reservation: toReservationResponse(reservation, { includePrescriptionId: true }) },
    'Reservation fetched successfully'
  );
  res.status(response.statusCode).json(response);
};

export const cancelReservation = async (req, res) => {
  const reservationId = req.params.reservationId;
  const customerId = req.auth.userId;
  const reason = req.body.reason || 'Cancelled by customer';

  const reservation = await Reservation.findOne({
    _id: reservationId,
    customer: customerId,
  });

  if (!reservation) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Reservation not found');
  }

  if (reservation.status === RESERVATION_STATUS.CANCELLED) {
    const response = new ApiResponse(
      HTTP_STATUS.OK,
      { reservation: toReservationResponse(reservation) },
      'Reservation is already cancelled'
    );
    res.status(response.statusCode).json(response);
    return;
  }

  if (![RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CONFIRMED, RESERVATION_STATUS.READY_FOR_PICKUP].includes(
    reservation.status
  )) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Reservation cannot be cancelled in its current status');
  }

  if (reservation.status === RESERVATION_STATUS.PENDING) {
    reservation.status = RESERVATION_STATUS.CANCELLED;
    reservation.cancelledAt = new Date();
    appendStatusHistory(reservation, {
      status: RESERVATION_STATUS.CANCELLED,
      changedBy: customerId,
      actorRole: USER_ROLES.CUSTOMER,
      reason,
    });
    await reservation.save();

    await notifyPharmacyAboutReservation({
      eventType: RESERVATION_NOTIFICATION_EVENTS.RESERVATION_CANCELLED,
      pharmacyId: reservation.pharmacy,
      reservationId: reservation._id,
      payload: { reservationCode: reservation.reservationCode },
      idempotencyKey: `reservation-cancelled:${reservation._id.toString()}`,
    });

    const response = new ApiResponse(
      HTTP_STATUS.OK,
      { reservation: toReservationResponse(reservation) },
      'Reservation cancelled successfully'
    );
    res.status(response.statusCode).json(response);
    return;
  }

  await runWithTransactionRetry(async (session) => {
    const lockedReservation = await applySession(
      Reservation.findOne({
        _id: reservationId,
        customer: customerId,
        status: { $in: [RESERVATION_STATUS.CONFIRMED, RESERVATION_STATUS.READY_FOR_PICKUP] },
      }),
      session
    );

    if (!lockedReservation) {
      throw new ApiError(HTTP_STATUS.CONFLICT, 'Reservation cannot be cancelled in its current status');
    }

    for (const item of lockedReservation.items) {
      for (const allocation of item.batchAllocations || []) {
        const inventoryDoc = await applySession(Inventory.findById(item.inventory), session);
        const batch = inventoryDoc?.batches.id(allocation.batchId);
        if (!batch) {
          throw new ApiError(HTTP_STATUS.CONFLICT, 'Inventory batch allocation is no longer valid');
        }

        const previousReserved = batch.reservedQuantity;
        const previousPhysical = batch.physicalQuantity;

        const released = await atomicallyDecreaseBatchReserved({
          inventoryId: item.inventory,
          batchId: allocation.batchId,
          quantity: allocation.quantity,
          session,
        });

        if (!released) {
          throw new ApiError(HTTP_STATUS.CONFLICT, 'Failed to release reserved stock for cancellation');
        }

        await recordStockMovement({
          session,
          pharmacyId: lockedReservation.pharmacy,
          inventoryId: item.inventory,
          medicineId: item.medicine,
          batchId: allocation.batchId,
          batchNumber: allocation.batchNumber,
          movementType: STOCK_MOVEMENT_TYPES.STOCK_RELEASED,
          quantity: allocation.quantity,
          previousPhysicalQuantity: previousPhysical,
          newPhysicalQuantity: previousPhysical,
          previousReservedQuantity: previousReserved,
          newReservedQuantity: previousReserved - allocation.quantity,
          reason: 'Reservation cancelled by customer',
          referenceId: lockedReservation._id,
          performedBy: customerId,
        });
      }
    }

    lockedReservation.status = RESERVATION_STATUS.CANCELLED;
    lockedReservation.cancelledAt = new Date();
    appendStatusHistory(lockedReservation, {
      status: RESERVATION_STATUS.CANCELLED,
      changedBy: customerId,
      actorRole: USER_ROLES.CUSTOMER,
      reason,
    });
    await lockedReservation.save(sessionOption(session));

    await notifyPharmacyAboutReservation({
      eventType: RESERVATION_NOTIFICATION_EVENTS.RESERVATION_CANCELLED,
      pharmacyId: lockedReservation.pharmacy,
      reservationId: lockedReservation._id,
      payload: { reservationCode: lockedReservation.reservationCode },
      idempotencyKey: `reservation-cancelled:${lockedReservation._id.toString()}`,
      session,
    });

    return lockedReservation;
  });

  const updated = await Reservation.findById(reservationId);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { reservation: toReservationResponse(updated) },
    'Reservation cancelled and stock released successfully'
  );
  res.status(response.statusCode).json(response);
};

export const listPharmacyReservations = async (req, res) => {
  const { page, limit, sortBy, sortOrder, status, reservationCode, fromDate, toDate } = req.query;
  const filter = { pharmacy: req.pharmacyId };

  if (status) {
    filter.status = status;
  }

  if (reservationCode) {
    filter.reservationCode = reservationCode.trim().toUpperCase();
  }

  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) {
      filter.createdAt.$gte = new Date(fromDate);
    }
    if (toDate) {
      filter.createdAt.$lte = new Date(toDate);
    }
  }

  const skip = (page - 1) * limit;
  const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

  const [reservations, total] = await Promise.all([
    Reservation.find(filter)
      .populate('customer', 'fullName mobileNumber')
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
        ...toReservationResponse(reservation),
        customer: reservation.customer,
      })),
    },
    'Pharmacy reservations fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const getPharmacyReservationById = async (req, res) => {
  const reservation = await Reservation.findOne({
    _id: req.params.reservationId,
    pharmacy: req.pharmacyId,
  })
    .populate('customer', 'fullName mobileNumber')
    .lean();

  if (!reservation) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Reservation not found');
  }

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      reservation: {
        ...toReservationResponse(reservation),
        customer: reservation.customer,
      },
    },
    'Pharmacy reservation fetched successfully'
  );
  res.status(response.statusCode).json(response);
};

export const acceptReservation = async (req, res) => {
  const reservationId = req.params.reservationId;
  const pharmacyId = req.pharmacyId;
  const actorId = req.auth.userId;
  const actorRole = req.auth.role;
  const now = new Date();

  assertOperationalPharmacy(req.pharmacy);

  const existingConfirmed = await Reservation.findOne({
    _id: reservationId,
    pharmacy: pharmacyId,
    status: RESERVATION_STATUS.CONFIRMED,
  }).lean();

  if (existingConfirmed) {
    const response = new ApiResponse(
      HTTP_STATUS.OK,
      { reservation: toReservationResponse(existingConfirmed) },
      'Reservation is already confirmed'
    );
    res.status(response.statusCode).json(response);
    return;
  }

  const reservationExists = await Reservation.findById(reservationId).select('pharmacy status').lean();
  if (!reservationExists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Reservation not found');
  }

  if (reservationExists.pharmacy.toString() !== pharmacyId) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Reservation not found');
  }

  const updatedReservation = await runWithTransactionRetry(async (session) => {
    const reservation = await applySession(
      Reservation.findOne({
        _id: reservationId,
        pharmacy: pharmacyId,
        status: RESERVATION_STATUS.PENDING,
        expiresAt: { $gt: now },
      }),
      session
    );

    if (!reservation) {
      throw new ApiError(
        HTTP_STATUS.CONFLICT,
        'Reservation is not pending, has expired, or was already processed'
      );
    }

    const allocationPlans = [];

    for (const item of reservation.items) {
      const inventory = await applySession(
        Inventory.findOne({
          _id: item.inventory,
          pharmacy: pharmacyId,
          isActive: true,
        }),
        session
      );

      if (!inventory) {
        throw new ApiError(HTTP_STATUS.CONFLICT, 'Inventory record not found for reservation item');
      }

      const plan = planFefoBatchAllocations(inventory.batches, item.quantity, now);
      if (!plan) {
        throw new ApiError(
          HTTP_STATUS.CONFLICT,
          `Insufficient stock to accept reservation for ${item.medicineName}`
        );
      }

      const acceptedUnitPrice = calculateWeightedUnitPrice(plan);
      if (
        Number(acceptedUnitPrice.toFixed(2)) !== Number(Number(item.unitPrice).toFixed(2)) &&
        !req.body.confirmUpdatedPricing
      ) {
        throw new ApiError(
          HTTP_STATUS.CONFLICT,
          'Accepted pricing differs from the request snapshot. Resubmit with confirmUpdatedPricing=true after customer acknowledgement.'
        );
      }

      allocationPlans.push({ item, inventory, plan, acceptedUnitPrice });
    }

    for (const { item, inventory, plan } of allocationPlans) {
      for (const allocation of plan) {
        const batch = inventory.batches.id(allocation.batchId);
        const previousReserved = batch.reservedQuantity;
        const previousPhysical = batch.physicalQuantity;

        const reserved = await atomicallyIncreaseBatchReserved({
          inventoryId: inventory._id,
          batchId: allocation.batchId,
          quantity: allocation.quantity,
          session,
        });

        if (!reserved) {
          throw new ApiError(
            HTTP_STATUS.CONFLICT,
            'Stock allocation failed due to concurrent inventory changes. Please retry.'
          );
        }

        await recordStockMovement({
          session,
          pharmacyId,
          inventoryId: inventory._id,
          medicineId: item.medicine,
          batchId: allocation.batchId,
          batchNumber: allocation.batchNumber,
          movementType: STOCK_MOVEMENT_TYPES.STOCK_RESERVED,
          quantity: allocation.quantity,
          previousPhysicalQuantity: previousPhysical,
          newPhysicalQuantity: previousPhysical,
          previousReservedQuantity: previousReserved,
          newReservedQuantity: previousReserved + allocation.quantity,
          reason: 'Reservation accepted',
          referenceId: reservation._id,
          performedBy: actorId,
        });
      }
    }

    for (const { item, plan, acceptedUnitPrice } of allocationPlans) {
      item.batchAllocations = plan;
      item.acceptedUnitPrice = acceptedUnitPrice;
    }

    reservation.status = RESERVATION_STATUS.CONFIRMED;
    reservation.confirmedAt = now;
    if (req.body.pharmacyNote) {
      reservation.pharmacyNote = req.body.pharmacyNote;
    }

    appendStatusHistory(reservation, {
      status: RESERVATION_STATUS.CONFIRMED,
      changedBy: actorId,
      actorRole,
      reason: 'Reservation accepted by pharmacy',
    });

    await initializePaymentForConfirmedReservation({ reservation, session });

    await notifyCustomerAboutReservation({
      eventType: RESERVATION_NOTIFICATION_EVENTS.RESERVATION_CONFIRMED,
      customerId: reservation.customer,
      reservationId: reservation._id,
      payload: { reservationCode: reservation.reservationCode },
      idempotencyKey: `reservation-confirmed:${reservation._id.toString()}`,
      session,
    });

    await reservation.save(sessionOption(session));
    return reservation;
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { reservation: toReservationResponse(updatedReservation) },
    'Reservation accepted successfully'
  );
  res.status(response.statusCode).json(response);
};

export const rejectReservation = async (req, res) => {
  const reservationId = req.params.reservationId;
  const pharmacyId = req.pharmacyId;
  const actorId = req.auth.userId;
  const { reason } = req.body;

  assertOperationalPharmacy(req.pharmacy);

  const reservation = await Reservation.findOneAndUpdate(
    {
      _id: reservationId,
      pharmacy: pharmacyId,
      status: RESERVATION_STATUS.PENDING,
    },
    {
      $set: {
        status: RESERVATION_STATUS.REJECTED,
        rejectionReason: reason,
        rejectedAt: new Date(),
        rejectedBy: actorId,
      },
      $push: {
        statusHistory: {
          status: RESERVATION_STATUS.REJECTED,
          changedBy: actorId,
          actorRole: req.auth.role,
          reason,
          changedAt: new Date(),
        },
      },
    },
    { new: true }
  );

  if (!reservation) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Only pending reservations can be rejected');
  }

  await notifyCustomerAboutReservation({
    eventType: RESERVATION_NOTIFICATION_EVENTS.RESERVATION_REJECTED,
    customerId: reservation.customer,
    reservationId: reservation._id,
    payload: { reservationCode: reservation.reservationCode },
    idempotencyKey: `reservation-rejected:${reservation._id.toString()}`,
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { reservation: toReservationResponse(reservation) },
    'Reservation rejected successfully'
  );
  res.status(response.statusCode).json(response);
};

export const markReservationReady = async (req, res) => {
  const reservationId = req.params.reservationId;
  const pharmacyId = req.pharmacyId;
  const actorId = req.auth.userId;

  assertOperationalPharmacy(req.pharmacy);

  const reservation = await Reservation.findOneAndUpdate(
    {
      _id: reservationId,
      pharmacy: pharmacyId,
      status: RESERVATION_STATUS.CONFIRMED,
    },
    {
      $set: {
        status: RESERVATION_STATUS.READY_FOR_PICKUP,
        readyAt: new Date(),
      },
      $push: {
        statusHistory: {
          status: RESERVATION_STATUS.READY_FOR_PICKUP,
          changedBy: actorId,
          actorRole: req.auth.role,
          reason: 'Order ready for pickup',
          changedAt: new Date(),
        },
      },
    },
    { new: true }
  );

  if (!reservation) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Only confirmed reservations can be marked ready for pickup');
  }

  await notifyCustomerAboutReservation({
    eventType: RESERVATION_NOTIFICATION_EVENTS.RESERVATION_READY_FOR_PICKUP,
    customerId: reservation.customer,
    reservationId: reservation._id,
    payload: { reservationCode: reservation.reservationCode },
    idempotencyKey: `reservation-ready:${reservation._id.toString()}`,
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { reservation: toReservationResponse(reservation) },
    'Reservation marked ready for pickup'
  );
  res.status(response.statusCode).json(response);
};

export const collectReservation = async (req, res) => {
  const reservationId = req.params.reservationId;
  const pharmacyId = req.pharmacyId;
  const actorId = req.auth.userId;
  const reservationCode = req.body.reservationCode.trim().toUpperCase();

  assertOperationalPharmacy(req.pharmacy);

  const alreadyCollected = await Reservation.findOne({
    _id: reservationId,
    pharmacy: pharmacyId,
    status: RESERVATION_STATUS.COLLECTED,
    reservationCode,
  }).lean();

  if (alreadyCollected) {
    const response = new ApiResponse(
      HTTP_STATUS.OK,
      { reservation: toReservationResponse(alreadyCollected) },
      'Reservation is already collected'
    );
    res.status(response.statusCode).json(response);
    return;
  }

  const collectedReservation = await runWithTransactionRetry(async (session) => {
    const reservation = await applySession(
      Reservation.findOne({
        _id: reservationId,
        pharmacy: pharmacyId,
        status: RESERVATION_STATUS.READY_FOR_PICKUP,
        reservationCode,
      }),
      session
    );

    if (!reservation) {
      throw new ApiError(
        HTTP_STATUS.CONFLICT,
        'Reservation is not ready for pickup, code is invalid, or was already collected'
      );
    }

    for (const item of reservation.items) {
      for (const allocation of item.batchAllocations || []) {
        const inventoryDoc = await applySession(Inventory.findById(item.inventory), session);
        const batch = inventoryDoc?.batches.id(allocation.batchId);
        if (!batch) {
          throw new ApiError(HTTP_STATUS.CONFLICT, 'Allocated batch no longer exists');
        }

        const previousReserved = batch.reservedQuantity;
        const previousPhysical = batch.physicalQuantity;

        const collected = await atomicallyCollectBatchStock({
          inventoryId: item.inventory,
          batchId: allocation.batchId,
          quantity: allocation.quantity,
          session,
        });

        if (!collected) {
          throw new ApiError(HTTP_STATUS.CONFLICT, 'Failed to collect stock for reservation');
        }

        await recordStockMovement({
          session,
          pharmacyId,
          inventoryId: item.inventory,
          medicineId: item.medicine,
          batchId: allocation.batchId,
          batchNumber: allocation.batchNumber,
          movementType: STOCK_MOVEMENT_TYPES.STOCK_COLLECTED,
          quantity: allocation.quantity,
          previousPhysicalQuantity: previousPhysical,
          newPhysicalQuantity: previousPhysical - allocation.quantity,
          previousReservedQuantity: previousReserved,
          newReservedQuantity: previousReserved - allocation.quantity,
          reason: 'Reservation collected at pharmacy',
          referenceId: reservation._id,
          performedBy: actorId,
        });
      }
    }

    reservation.status = RESERVATION_STATUS.COLLECTED;
    reservation.collectedAt = new Date();
    reservation.collectedBy = actorId;
    appendStatusHistory(reservation, {
      status: RESERVATION_STATUS.COLLECTED,
      changedBy: actorId,
      actorRole: req.auth.role,
      reason: 'Reservation collected at pharmacy counter',
    });
    await notifyCustomerAboutReservation({
      eventType: RESERVATION_NOTIFICATION_EVENTS.RESERVATION_COLLECTED,
      customerId: reservation.customer,
      reservationId: reservation._id,
      payload: { reservationCode: reservation.reservationCode },
      idempotencyKey: `reservation-collected:${reservation._id.toString()}`,
      session,
    });

    await reservation.save(sessionOption(session));

    return reservation;
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { reservation: toReservationResponse(collectedReservation) },
    'Reservation collected successfully'
  );
  res.status(response.statusCode).json(response);
};
