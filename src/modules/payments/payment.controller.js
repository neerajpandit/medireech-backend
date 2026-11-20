import crypto from 'node:crypto';
import { HTTP_STATUS } from '../../constants/index.js';
import {
  PHARMACY_OPERATIONAL_STATUS,
  PHARMACY_VERIFICATION_STATUS,
  RESERVATION_STATUS,
  USER_ROLES,
} from '../../constants/database.enums.js';
import {
  ACTIVE_ONLINE_PAYMENT_STATUSES,
  PAYMENT_AUDIT_ACTIONS,
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUS,
  REFUND_STATUS,
  WEBHOOK_PROCESSING_STATUS,
} from '../../constants/payment.constants.js';
import { NOTIFICATION_EVENT_TYPES } from '../../constants/notification.types.js';
import { STOCK_MOVEMENT_TYPES } from '../../constants/inventory.constants.js';
import { env } from '../../config/env.js';
import {
  createRazorpayOrder,
  createRazorpayRefund,
  fetchRazorpayPayment,
  isRazorpayConfigured,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
} from '../../config/razorpay.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { recordAuditLog } from '../../utils/auditLog.js';
import { enqueueNotificationOutbox } from '../../utils/enqueueNotificationOutbox.js';
import { computeReservationTotalPaise, paiseToRupees } from '../../utils/paymentAmount.js';
import { generatePaymentCode } from '../../utils/paymentCode.js';
import { atomicallyDecreaseBatchReserved } from '../../utils/reservationStock.js';
import { applySession, runWithTransactionRetry, sessionOption } from '../../utils/transactionRetry.js';
import { Inventory } from '../inventory/inventory.model.js';
import { StockMovement } from '../inventory/stockMovement.model.js';
import { Pharmacy } from '../pharmacies/pharmacy.model.js';
import { Reservation } from '../reservations/reservation.model.js';
import { Payment } from './payment.model.js';
import { PaymentWebhookEvent } from './paymentWebhookEvent.model.js';
import { Refund } from './refund.model.js';
import { syncReservationPaymentMirror } from '../../utils/paymentLifecycle.js';

const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

const TERMINAL_PAYMENT_STATUSES = new Set([
  PAYMENT_STATUS.CAPTURED,
  PAYMENT_STATUS.REFUNDED,
  PAYMENT_STATUS.PARTIALLY_REFUNDED,
]);

const toPublicPayment = (payment) => ({
  id: payment._id,
  paymentCode: payment.paymentCode,
  reservation: payment.reservation,
  paymentMethod: payment.paymentMethod,
  provider: payment.provider,
  amount: payment.amount,
  amountInRupees: paiseToRupees(payment.amount),
  currency: payment.currency,
  status: payment.status,
  razorpayOrderId: payment.razorpayOrderId,
  receipt: payment.receipt,
  paidAt: payment.paidAt,
  capturedAt: payment.capturedAt,
  expiresAt: payment.expiresAt,
  failureReason: payment.failureReason,
  refundedAmountPaise: payment.refundedAmountPaise,
  createdAt: payment.createdAt,
  updatedAt: payment.updatedAt,
});

const assertOperationalPharmacy = (pharmacy) => {
  if (
    pharmacy.verificationStatus !== PHARMACY_VERIFICATION_STATUS.APPROVED ||
    pharmacy.operationalStatus !== PHARMACY_OPERATIONAL_STATUS.ACTIVE
  ) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Pharmacy must be approved and active');
  }
};

const queuePaymentNotification = async ({ eventType, customerId, payment, reservation, session }) => {
  await enqueueNotificationOutbox({
    eventType,
    recipient: customerId,
    payload: {
      paymentId: payment._id,
      paymentCode: payment.paymentCode,
      reservationId: reservation?._id || payment.reservation,
      reservationCode: reservation?.reservationCode,
      status: payment.status,
    },
    relatedResourceType: 'Payment',
    relatedResourceId: payment._id,
    idempotencyKey: `${eventType.toLowerCase()}:${payment._id.toString()}:${payment.status}`,
    session,
  });
};

const findActiveOnlinePayment = (reservationId) =>
  Payment.findOne({
    reservation: reservationId,
    paymentMethod: PAYMENT_METHODS.ONLINE,
    status: { $in: ACTIVE_ONLINE_PAYMENT_STATUSES },
  }).sort({ createdAt: -1 });

export const createPaymentOrder = async (req, res) => {
  const { reservationId, idempotencyKey } = req.body;
  const customerId = req.auth.userId;

  const reservation = await Reservation.findOne({
    _id: reservationId,
    customer: customerId,
  });

  if (!reservation) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Reservation not found');
  }

  if (reservation.status !== RESERVATION_STATUS.CONFIRMED) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Online payment is allowed only for confirmed reservations');
  }

  if (reservation.paymentMethod !== PAYMENT_METHODS.ONLINE) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Reservation is not configured for online payment');
  }

  const pharmacy = await Pharmacy.findById(reservation.pharmacy).lean();
  assertOperationalPharmacy(pharmacy);

  const capturedPayment = await Payment.findOne({
    reservation: reservationId,
    status: PAYMENT_STATUS.CAPTURED,
  }).lean();

  if (capturedPayment) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Payment has already been captured for this reservation');
  }

  if (idempotencyKey) {
    const idempotentPayment = await Payment.findOne({ customer: customerId, idempotencyKey }).lean();
    if (idempotentPayment) {
      const response = new ApiResponse(
        HTTP_STATUS.OK,
        {
          payment: toPublicPayment(idempotentPayment),
          razorpay: {
            keyId: env.razorpayKeyId || null,
            orderId: idempotentPayment.razorpayOrderId,
            amount: idempotentPayment.amount,
            currency: idempotentPayment.currency,
          },
        },
        'Existing payment order returned for idempotency key'
      );
      res.status(response.statusCode).json(response);
      return;
    }
  }

  let payment = await findActiveOnlinePayment(reservationId);

  if (payment?.razorpayOrderId && payment.status === PAYMENT_STATUS.CREATED) {
    if (!payment.expiresAt || payment.expiresAt > new Date()) {
      const response = new ApiResponse(
        HTTP_STATUS.OK,
        {
          payment: toPublicPayment(payment),
          razorpay: {
            keyId: env.razorpayKeyId || null,
            orderId: payment.razorpayOrderId,
            amount: payment.amount,
            currency: payment.currency,
          },
        },
        'Existing active payment order returned'
      );
      res.status(response.statusCode).json(response);
      return;
    }
  }

  if (!payment || payment.status === PAYMENT_STATUS.EXPIRED || payment.status === PAYMENT_STATUS.FAILED) {
    payment = await Payment.findOne({
      reservation: reservationId,
      paymentMethod: PAYMENT_METHODS.ONLINE,
      status: PAYMENT_STATUS.PENDING,
    }).sort({ createdAt: -1 });

    if (!payment) {
      throw new ApiError(HTTP_STATUS.CONFLICT, 'No payable online payment record found for this reservation');
    }
  }

  const amountPaise = reservation.totalAmount ?? computeReservationTotalPaise(reservation);

  if (amountPaise !== payment.amount) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Payment amount mismatch with confirmed reservation snapshot');
  }

  if (!isRazorpayConfigured() && !env.isTest) {
    throw new ApiError(503, 'Online payment provider is not configured');
  }

  const receipt = payment.receipt || payment.paymentCode.slice(0, 40);
  let razorpayOrder;

  try {
    razorpayOrder = await createRazorpayOrder({
      amountPaise,
      receipt,
      notes: {
        reservationId: reservation._id.toString(),
        paymentCode: payment.paymentCode,
        customerId: customerId.toString(),
      },
    });
  } catch (error) {
    throw new ApiError(HTTP_STATUS.BAD_GATEWAY, 'Failed to create payment order with provider');
  }

  const expiresAt = new Date(Date.now() + env.onlinePaymentExpiryMinutes * 60 * 1000);

  try {
    payment = await Payment.findOneAndUpdate(
      {
        _id: payment._id,
        customer: customerId,
        status: { $in: [...ACTIVE_ONLINE_PAYMENT_STATUSES, PAYMENT_STATUS.FAILED, PAYMENT_STATUS.EXPIRED] },
      },
      {
        $set: {
          status: PAYMENT_STATUS.CREATED,
          razorpayOrderId: razorpayOrder.id,
          receipt,
          idempotencyKey,
          expiresAt,
          failureReason: undefined,
        },
      },
      { new: true }
    );
  } catch (error) {
    await Payment.updateOne(
      { _id: payment._id },
      {
        $set: {
          'metadata.reconciliationRequired': true,
          'metadata.razorpayOrderId': razorpayOrder.id,
        },
      }
    );
    throw new ApiError(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      'Payment order created at provider but local persistence needs reconciliation'
    );
  }

  if (!payment) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Payment attempt is no longer eligible for order creation');
  }

  await Reservation.updateOne(
    { _id: reservation._id },
    { $set: { paymentStatus: PAYMENT_STATUS.CREATED, paymentDeadline: expiresAt } }
  );

  await recordAuditLog({
    actorId: customerId,
    action: PAYMENT_AUDIT_ACTIONS.PAYMENT_ORDER_CREATED,
    resourceType: 'Payment',
    resourceId: payment._id,
    pharmacyId: reservation.pharmacy,
    newValues: { status: PAYMENT_STATUS.CREATED, razorpayOrderId: razorpayOrder.id },
    req,
  });

  await queuePaymentNotification({
    eventType: NOTIFICATION_EVENT_TYPES.PAYMENT_ORDER_CREATED,
    customerId,
    payment,
    reservation,
  });

  const response = new ApiResponse(
    HTTP_STATUS.CREATED,
    {
      payment: toPublicPayment(payment),
      razorpay: {
        keyId: env.razorpayKeyId || null,
        orderId: razorpayOrder.id,
        amount: amountPaise,
        currency: env.razorpayCurrency,
      },
    },
    'Payment order created successfully'
  );
  res.status(response.statusCode).json(response);
};

const applyCapturedPayment = async ({
  payment,
  razorpayPaymentId,
  actorId,
  req,
  source,
  session,
}) => {
  const now = new Date();
  const updatedPayment = await Payment.findOneAndUpdate(
    {
      _id: payment._id,
      status: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.CREATED, PAYMENT_STATUS.AUTHORIZED] },
    },
    {
      $set: {
        status: PAYMENT_STATUS.CAPTURED,
        razorpayPaymentId,
        paidAt: now,
        capturedAt: now,
        failureReason: undefined,
      },
    },
    { new: true, ...sessionOption(session) }
  );

  if (!updatedPayment) {
    const existing = await applySession(Payment.findById(payment._id), session);
    if (existing?.status === PAYMENT_STATUS.CAPTURED) {
      return existing;
    }

    throw new ApiError(HTTP_STATUS.CONFLICT, 'Payment cannot be captured in its current state');
  }

  await syncReservationPaymentMirror({
    reservationId: updatedPayment.reservation,
    paymentStatus: PAYMENT_STATUS.CAPTURED,
    paidAmountPaise: updatedPayment.amount,
    session,
  });

  await recordAuditLog({
    actorId: actorId || updatedPayment.customer,
    action: PAYMENT_AUDIT_ACTIONS.PAYMENT_CAPTURED,
    resourceType: 'Payment',
    resourceId: updatedPayment._id,
    pharmacyId: updatedPayment.pharmacy,
    metadata: { source },
    req,
  });

  await queuePaymentNotification({
    eventType: NOTIFICATION_EVENT_TYPES.PAYMENT_SUCCESSFUL,
    customerId: updatedPayment.customer,
    payment: updatedPayment,
    session,
  });

  return updatedPayment;
};

export const verifyPayment = async (req, res) => {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } =
    req.body;
  const customerId = req.auth.userId;

  const payment = await Payment.findOne({
    customer: customerId,
    razorpayOrderId: orderId,
  });

  if (!payment) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Payment not found for this order');
  }

  if (payment.status === PAYMENT_STATUS.CAPTURED) {
    const response = new ApiResponse(
      HTTP_STATUS.OK,
      { payment: toPublicPayment(payment) },
      'Payment is already captured'
    );
    res.status(response.statusCode).json(response);
    return;
  }

  const signatureValid = verifyRazorpayPaymentSignature({
    orderId,
    paymentId,
    signature,
  });

  if (!signatureValid) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Invalid payment signature');
  }

  let providerPayment;
  if (isRazorpayConfigured() || env.isTest) {
    providerPayment = await fetchRazorpayPayment(paymentId, { orderId });
    if (providerPayment.order_id && providerPayment.order_id !== orderId) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Payment order mismatch');
    }

    if (!['captured', 'authorized'].includes(providerPayment.status)) {
      throw new ApiError(HTTP_STATUS.CONFLICT, 'Provider payment is not in a capturable state');
    }
  }

  const updated = await runWithTransactionRetry(async (session) => {
    if (providerPayment?.status === 'authorized') {
      return Payment.findOneAndUpdate(
        { _id: payment._id, status: { $in: ACTIVE_ONLINE_PAYMENT_STATUSES } },
        {
          $set: {
            status: PAYMENT_STATUS.AUTHORIZED,
            razorpayPaymentId: paymentId,
          },
        },
        { new: true, ...sessionOption(session) }
      );
    }

    return applyCapturedPayment({
      payment,
      razorpayPaymentId: paymentId,
      actorId: customerId,
      req,
      source: 'verify-api',
      session,
    });
  });

  await recordAuditLog({
    actorId: customerId,
    action: PAYMENT_AUDIT_ACTIONS.PAYMENT_VERIFIED,
    resourceType: 'Payment',
    resourceId: payment._id,
    req,
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { payment: toPublicPayment(updated) },
    updated.status === PAYMENT_STATUS.AUTHORIZED
      ? 'Payment authorized successfully'
      : 'Payment verified and captured successfully'
  );
  res.status(response.statusCode).json(response);
};

const extractWebhookEventId = (payload, rawBody) => {
  if (payload?.id) {
    return String(payload.id);
  }

  return crypto.createHash('sha256').update(rawBody).digest('hex');
};

const processWebhookPayload = async (payload, req) => {
  const eventType = payload?.event;
  const eventId = extractWebhookEventId(payload, JSON.stringify(payload));

  const webhookRecord = await PaymentWebhookEvent.findOneAndUpdate(
    { provider: PAYMENT_PROVIDERS.RAZORPAY, eventId },
    {
      $setOnInsert: {
        provider: PAYMENT_PROVIDERS.RAZORPAY,
        eventId,
        eventType: eventType || 'unknown',
        payloadHash: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
        processingStatus: WEBHOOK_PROCESSING_STATUS.RECEIVED,
        receivedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  if (webhookRecord.processingStatus === WEBHOOK_PROCESSING_STATUS.PROCESSED) {
    return { duplicate: true };
  }

  webhookRecord.processingStatus = WEBHOOK_PROCESSING_STATUS.PROCESSING;
  await webhookRecord.save();

  try {
    const paymentEntity =
      payload?.payload?.payment?.entity || payload?.payload?.payment || payload?.payload?.order?.entity;

    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      const orderId = paymentEntity?.order_id || payload?.payload?.order?.entity?.id;
      const razorpayPaymentId = paymentEntity?.id;

      const payment = await Payment.findOne({ razorpayOrderId: orderId });
      if (payment) {
        await runWithTransactionRetry(async (session) =>
          applyCapturedPayment({
            payment,
            razorpayPaymentId,
            source: `webhook:${eventType}`,
            session,
          })
        );
      }
    }

    if (eventType === 'payment.authorized') {
      const orderId = paymentEntity?.order_id;
      const razorpayPaymentId = paymentEntity?.id;
      await Payment.findOneAndUpdate(
        { razorpayOrderId: orderId, status: { $in: ACTIVE_ONLINE_PAYMENT_STATUSES } },
        {
          $set: {
            status: PAYMENT_STATUS.AUTHORIZED,
            razorpayPaymentId,
          },
        }
      );
    }

    if (eventType === 'payment.failed') {
      const orderId = paymentEntity?.order_id;
      const payment = await Payment.findOneAndUpdate(
        { razorpayOrderId: orderId, status: { $nin: TERMINAL_PAYMENT_STATUSES } },
        {
          $set: {
            status: PAYMENT_STATUS.FAILED,
            failureReason: paymentEntity?.error_description || 'Payment failed',
          },
        },
        { new: true }
      );

      if (payment) {
        await syncReservationPaymentMirror({
          reservationId: payment.reservation,
          paymentStatus: PAYMENT_STATUS.FAILED,
          paidAmountPaise: 0,
        });
        await queuePaymentNotification({
          eventType: NOTIFICATION_EVENT_TYPES.PAYMENT_FAILED,
          customerId: payment.customer,
          payment,
        });
      }
    }

    if (eventType === 'refund.processed' || eventType === 'refund.created') {
      const refundEntity = payload?.payload?.refund?.entity;
      if (refundEntity?.payment_id) {
        const payment = await Payment.findOne({ razorpayPaymentId: refundEntity.payment_id });
        if (payment) {
          await Refund.findOneAndUpdate(
            { providerRefundId: refundEntity.id },
            {
              $set: {
                status:
                  refundEntity.status === 'processed' ? REFUND_STATUS.PROCESSED : REFUND_STATUS.PROCESSING,
                processedAt: refundEntity.status === 'processed' ? new Date() : undefined,
              },
            }
          );
        }
      }
    }

    webhookRecord.processingStatus = WEBHOOK_PROCESSING_STATUS.PROCESSED;
    webhookRecord.processedAt = new Date();
    await webhookRecord.save();

    return { duplicate: false };
  } catch (error) {
    webhookRecord.processingStatus = WEBHOOK_PROCESSING_STATUS.FAILED;
    webhookRecord.failureReason = error.message?.slice(0, 500);
    await webhookRecord.save();
    throw error;
  }
};

export const handlePaymentWebhook = async (req, res) => {
  const signature = req.get('x-razorpay-signature');
  const rawBody = req.body;

  const rawBuffer = Buffer.isBuffer(rawBody)
    ? rawBody
    : typeof rawBody === 'string'
      ? Buffer.from(rawBody, 'utf8')
      : null;

  if (!rawBuffer) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({ success: false, message: 'Invalid webhook payload' });
    return;
  }

  const valid = verifyRazorpayWebhookSignature(rawBuffer, signature);
  if (!valid) {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ success: false, message: 'Invalid webhook signature' });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBuffer.toString('utf8'));
  } catch {
    res.status(HTTP_STATUS.BAD_REQUEST).json({ success: false, message: 'Invalid JSON payload' });
    return;
  }

  try {
    await processWebhookPayload(payload, req);
    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Webhook processing failed' });
  }
};

export const collectCashPayment = async (req, res) => {
  const paymentId = req.params.paymentId;
  const pharmacyId = req.pharmacyId;
  const actorId = req.auth.userId;

  const payment = await Payment.findOne({ _id: paymentId, pharmacy: pharmacyId });

  if (!payment) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Payment not found for this pharmacy');
  }

  if (payment.paymentMethod !== PAYMENT_METHODS.PAY_AT_PHARMACY) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Only pay-at-pharmacy payments can be collected as cash');
  }

  if (payment.status === PAYMENT_STATUS.CAPTURED) {
    const response = new ApiResponse(
      HTTP_STATUS.OK,
      { payment: toPublicPayment(payment) },
      'Payment is already recorded as collected'
    );
    res.status(response.statusCode).json(response);
    return;
  }

  const reservation = await Reservation.findOne({
    _id: payment.reservation,
    pharmacy: pharmacyId,
    status: { $in: [RESERVATION_STATUS.CONFIRMED, RESERVATION_STATUS.READY_FOR_PICKUP] },
  });

  if (!reservation) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Reservation is not eligible for cash collection');
  }

  const now = new Date();
  const updated = await Payment.findOneAndUpdate(
    {
      _id: paymentId,
      pharmacy: pharmacyId,
      paymentMethod: PAYMENT_METHODS.PAY_AT_PHARMACY,
      status: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.CREATED] },
    },
    {
      $set: {
        status: PAYMENT_STATUS.CAPTURED,
        paidAt: now,
        capturedAt: now,
        metadata: {
          ...(payment.metadata || {}),
          cashReference: req.body.paymentReference,
          collectedBy: actorId,
        },
      },
    },
    { new: true }
  );

  if (!updated) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Cash payment cannot be collected in its current state');
  }

  await syncReservationPaymentMirror({
    reservationId: reservation._id,
    paymentStatus: PAYMENT_STATUS.CAPTURED,
    paidAmountPaise: updated.amount,
  });

  await recordAuditLog({
    actorId,
    action: PAYMENT_AUDIT_ACTIONS.PAYMENT_CASH_COLLECTED,
    resourceType: 'Payment',
    resourceId: updated._id,
    pharmacyId,
    metadata: { paymentReference: req.body.paymentReference },
    req,
  });

  await queuePaymentNotification({
    eventType: NOTIFICATION_EVENT_TYPES.PAYMENT_SUCCESSFUL,
    customerId: updated.customer,
    payment: updated,
    reservation,
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { payment: toPublicPayment(updated) },
    'Cash payment recorded successfully'
  );
  res.status(response.statusCode).json(response);
};

export const retryPayment = async (req, res) => {
  const paymentId = req.params.paymentId;
  const customerId = req.auth.userId;

  const failedPayment = await Payment.findOne({ _id: paymentId, customer: customerId });

  if (!failedPayment) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Payment not found');
  }

  if (![PAYMENT_STATUS.FAILED, PAYMENT_STATUS.EXPIRED].includes(failedPayment.status)) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Only failed or expired payments can be retried');
  }

  const reservation = await Reservation.findOne({
    _id: failedPayment.reservation,
    customer: customerId,
    status: RESERVATION_STATUS.CONFIRMED,
    paymentMethod: PAYMENT_METHODS.ONLINE,
  });

  if (!reservation) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Reservation is not eligible for payment retry');
  }

  const active = await findActiveOnlinePayment(reservation._id);
  if (active) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'An active payment attempt already exists');
  }

  const amountPaise = reservation.totalAmount ?? computeReservationTotalPaise(reservation);
  const expiresAt = new Date(Date.now() + env.onlinePaymentExpiryMinutes * 60 * 1000);

  const payment = await Payment.create({
    paymentCode: generatePaymentCode(),
    reservation: reservation._id,
    customer: customerId,
    pharmacy: reservation.pharmacy,
    paymentMethod: PAYMENT_METHODS.ONLINE,
    provider: PAYMENT_PROVIDERS.RAZORPAY,
    amount: amountPaise,
    currency: env.razorpayCurrency,
    status: PAYMENT_STATUS.PENDING,
    expiresAt,
    metadata: { retriedFrom: failedPayment._id },
  });

  req.body = {
    reservationId: reservation._id.toString(),
    idempotencyKey: req.body.idempotencyKey,
  };

  await createPaymentOrder(req, res);
};

export const createRefund = async (req, res) => {
  const paymentId = req.params.paymentId;
  const { amount, reason, idempotencyKey } = req.body;
  const amountPaise = Math.round(Number(amount) * 100);

  const payment = await Payment.findById(paymentId);
  if (!payment) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Payment not found');
  }

  if (payment.status !== PAYMENT_STATUS.CAPTURED && payment.status !== PAYMENT_STATUS.PARTIALLY_REFUNDED) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Only captured payments can be refunded');
  }

  const remainingRefundable = payment.amount - (payment.refundedAmountPaise || 0);
  if (amountPaise < 1 || amountPaise > remainingRefundable) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Refund amount exceeds remaining refundable balance');
  }

  if (idempotencyKey) {
    const existing = await Refund.findOne({ payment: paymentId, idempotencyKey }).lean();
    if (existing) {
      const response = new ApiResponse(HTTP_STATUS.OK, { refund: existing }, 'Existing refund returned');
      res.status(response.statusCode).json(response);
      return;
    }
  }

  if (payment.provider !== PAYMENT_PROVIDERS.RAZORPAY || !payment.razorpayPaymentId) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Online provider refund is not available for this payment');
  }

  const refund = await Refund.create({
    payment: payment._id,
    reservation: payment.reservation,
    customer: payment.customer,
    pharmacy: payment.pharmacy,
    amount: amountPaise,
    currency: payment.currency,
    reason,
    status: REFUND_STATUS.PENDING,
    initiatedBy: req.auth.userId,
    idempotencyKey,
  });

  let providerRefund;
  try {
    providerRefund = await createRazorpayRefund({
      razorpayPaymentId: payment.razorpayPaymentId,
      amountPaise,
      notes: { refundId: refund._id.toString(), reason },
    });
  } catch (error) {
    refund.status = REFUND_STATUS.FAILED;
    refund.failureReason = 'Provider refund request failed';
    await refund.save();
    throw new ApiError(HTTP_STATUS.BAD_GATEWAY, 'Failed to initiate refund with payment provider');
  }

  refund.providerRefundId = providerRefund.id;
  refund.status =
    providerRefund.status === 'processed' ? REFUND_STATUS.PROCESSED : REFUND_STATUS.PROCESSING;
  if (refund.status === REFUND_STATUS.PROCESSED) {
    refund.processedAt = new Date();
  }

  await refund.save();

  const newRefundedTotal = (payment.refundedAmountPaise || 0) + amountPaise;
  const newPaymentStatus =
    newRefundedTotal >= payment.amount ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED;

  await Payment.updateOne(
    { _id: payment._id },
    {
      $set: {
        refundedAmountPaise: newRefundedTotal,
        status: newPaymentStatus,
      },
    }
  );

  await syncReservationPaymentMirror({
    reservationId: payment.reservation,
    paymentStatus: newPaymentStatus,
    paidAmountPaise: payment.amount - newRefundedTotal,
  });

  await recordAuditLog({
    actorId: req.auth.userId,
    action: PAYMENT_AUDIT_ACTIONS.PAYMENT_REFUND_INITIATED,
    resourceType: 'Refund',
    resourceId: refund._id,
    pharmacyId: payment.pharmacy,
    metadata: { amountPaise, providerRefundId: providerRefund.id },
    req,
  });

  await queuePaymentNotification({
    eventType:
      refund.status === REFUND_STATUS.PROCESSED
        ? NOTIFICATION_EVENT_TYPES.REFUND_SUCCESSFUL
        : NOTIFICATION_EVENT_TYPES.REFUND_INITIATED,
    customerId: payment.customer,
    payment,
  });

  const response = new ApiResponse(
    HTTP_STATUS.CREATED,
    { refund },
    'Refund initiated successfully'
  );
  res.status(response.statusCode).json(response);
};

export const listMyPayments = async (req, res) => {
  const { page, limit, status, paymentMethod, fromDate, toDate, sortOrder } = req.query;
  const filter = { customer: req.auth.userId };

  if (status) {
    filter.status = status;
  }

  if (paymentMethod) {
    filter.paymentMethod = paymentMethod;
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
  const sort = { createdAt: sortOrder === 'asc' ? 1 : -1 };

  const [payments, total] = await Promise.all([
    Payment.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Payment.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { payments: payments.map(toPublicPayment) },
    'Payments fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const getMyPaymentById = async (req, res) => {
  const payment = await Payment.findOne({
    _id: req.params.paymentId,
    customer: req.auth.userId,
  }).lean();

  if (!payment) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Payment not found');
  }

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { payment: toPublicPayment(payment) },
    'Payment fetched successfully'
  );
  res.status(response.statusCode).json(response);
};

export const listAdminPayments = async (req, res) => {
  const { page, limit, status, paymentMethod, pharmacyId, customerId, fromDate, toDate, sortOrder } =
    req.query;
  const filter = {};

  if (status) {
    filter.status = status;
  }

  if (paymentMethod) {
    filter.paymentMethod = paymentMethod;
  }

  if (pharmacyId) {
    filter.pharmacy = pharmacyId;
  }

  if (customerId) {
    filter.customer = customerId;
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
  const sort = { createdAt: sortOrder === 'asc' ? 1 : -1 };

  const [payments, total] = await Promise.all([
    Payment.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Payment.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { payments: payments.map(toPublicPayment) },
    'Platform payments fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const getAdminPaymentById = async (req, res) => {
  const payment = await Payment.findById(req.params.paymentId).lean();

  if (!payment) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Payment not found');
  }

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { payment: toPublicPayment(payment) },
    'Payment fetched successfully'
  );
  res.status(response.statusCode).json(response);
};

const toPublicRefund = (refund) => ({
  id: refund._id,
  payment: refund.payment,
  reservation: refund.reservation,
  customer: refund.customer,
  pharmacy: refund.pharmacy,
  amount: refund.amount,
  amountInRupees: paiseToRupees(refund.amount),
  currency: refund.currency,
  reason: refund.reason,
  status: refund.status,
  providerRefundId: refund.providerRefundId,
  initiatedBy: refund.initiatedBy,
  processedAt: refund.processedAt,
  createdAt: refund.createdAt,
});

export const listAdminRefunds = async (req, res) => {
  const { page, limit, status, pharmacyId, customerId, fromDate, toDate, sortOrder } = req.query;
  const filter = {};

  if (status) {
    filter.status = status;
  }

  if (pharmacyId) {
    filter.pharmacy = pharmacyId;
  }

  if (customerId) {
    filter.customer = customerId;
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
  const sort = { createdAt: sortOrder === 'asc' ? 1 : -1 };

  const [refunds, total] = await Promise.all([
    Refund.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Refund.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { refunds: refunds.map(toPublicRefund) },
    'Refunds fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const getAdminRefundById = async (req, res) => {
  const refund = await Refund.findById(req.params.refundId).lean();

  if (!refund) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Refund not found');
  }

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { refund: toPublicRefund(refund) },
    'Refund fetched successfully'
  );
  res.status(response.statusCode).json(response);
};

export const processExpiredOnlinePayments = async ({ batchSize = 50, now = new Date() } = {}) => {
  const candidates = await Payment.find({
    paymentMethod: PAYMENT_METHODS.ONLINE,
    status: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.CREATED, PAYMENT_STATUS.AUTHORIZED] },
    expiresAt: { $lte: now },
  })
    .limit(batchSize)
    .lean();

  let expiredCount = 0;

  for (const candidate of candidates) {
    const payment = await Payment.findOneAndUpdate(
      {
        _id: candidate._id,
        status: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.CREATED, PAYMENT_STATUS.AUTHORIZED] },
        expiresAt: { $lte: now },
      },
      {
        $set: {
          status: PAYMENT_STATUS.EXPIRED,
          failureReason: 'Online payment window expired',
        },
      },
      { new: true }
    );

    if (!payment) {
      continue;
    }

    expiredCount += 1;

    await syncReservationPaymentMirror({
      reservationId: payment.reservation,
      paymentStatus: PAYMENT_STATUS.EXPIRED,
      paidAmountPaise: 0,
    });

    await queuePaymentNotification({
      eventType: NOTIFICATION_EVENT_TYPES.PAYMENT_EXPIRED,
      customerId: payment.customer,
      payment,
    });
  }

  return { expiredCount };
};

export const processUnpaidOnlineReservations = async ({ batchSize = 25, now = new Date() } = {}) => {
  if (!env.unpaidReservationCancelEnabled) {
    return { cancelledCount: 0 };
  }

  const reservations = await Reservation.find({
    status: RESERVATION_STATUS.CONFIRMED,
    paymentMethod: PAYMENT_METHODS.ONLINE,
    paymentStatus: { $nin: [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.NOT_REQUIRED] },
    paymentDeadline: { $lte: now },
  })
    .limit(batchSize)
    .lean();

  let cancelledCount = 0;

  for (const candidate of reservations) {
    const captured = await Payment.findOne({
      reservation: candidate._id,
      status: PAYMENT_STATUS.CAPTURED,
    }).lean();

    if (captured) {
      continue;
    }

    try {
      const reservation = await runWithTransactionRetry(async (session) => {
        const reservation = await applySession(
          Reservation.findOne({
            _id: candidate._id,
            status: RESERVATION_STATUS.CONFIRMED,
          }),
          session
        );

        if (!reservation) {
          return null;
        }

        for (const item of reservation.items) {
          for (const allocation of item.batchAllocations || []) {
            const inventoryDoc = await applySession(Inventory.findById(item.inventory), session);
            const batch = inventoryDoc?.batches.id(allocation.batchId);
            if (!batch) {
              continue;
            }

            const previousReserved = batch.reservedQuantity;
            const previousPhysical = batch.physicalQuantity;

            await atomicallyDecreaseBatchReserved({
              inventoryId: item.inventory,
              batchId: allocation.batchId,
              quantity: allocation.quantity,
              session,
            });

            await StockMovement.create(
              [
                {
                  pharmacy: reservation.pharmacy,
                  inventory: item.inventory,
                  medicine: item.medicine,
                  batchId: allocation.batchId,
                  batchNumber: allocation.batchNumber,
                  movementType: STOCK_MOVEMENT_TYPES.STOCK_RELEASED,
                  quantity: allocation.quantity,
                  previousPhysicalQuantity: previousPhysical,
                  newPhysicalQuantity: previousPhysical,
                  previousReservedQuantity: previousReserved,
                  newReservedQuantity: previousReserved - allocation.quantity,
                  reason: 'Unpaid online reservation auto-cancelled',
                  referenceId: reservation._id,
                  performedBy: reservation.customer,
                },
              ],
              sessionOption(session)
            );
          }
        }

        reservation.status = RESERVATION_STATUS.CANCELLED;
        reservation.cancelledAt = now;
        reservation.paymentStatus = PAYMENT_STATUS.EXPIRED;
        reservation.statusHistory.push({
          status: RESERVATION_STATUS.CANCELLED,
          changedBy: reservation.customer,
          actorRole: USER_ROLES.CUSTOMER,
          reason: 'Cancelled automatically due to unpaid online payment deadline',
          changedAt: now,
        });

        await reservation.save(sessionOption(session));
        return reservation;
      });

      if (!reservation) {
        continue;
      }

      cancelledCount += 1;

      await recordAuditLog({
        actorId: reservation.customer,
        action: PAYMENT_AUDIT_ACTIONS.UNPAID_RESERVATION_CANCELLED,
        resourceType: 'Reservation',
        resourceId: reservation._id,
        pharmacyId: reservation.pharmacy,
        metadata: { policy: 'unpaid-online-default' },
      });
    } catch {
      // Keep processing remaining unpaid reservations.
    }
  }

  return { cancelledCount };
};
