import { HTTP_STATUS } from '../constants/index.js';
import {
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUS,
} from '../constants/payment.constants.js';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';
import { computeReservationTotalPaise } from './paymentAmount.js';
import { generatePaymentCode } from './paymentCode.js';
import { Payment } from '../modules/payments/payment.model.js';
import { Reservation } from '../modules/reservations/reservation.model.js';
import { sessionOption } from './transactionRetry.js';

export const syncReservationPaymentMirror = async ({ reservationId, paymentStatus, paidAmountPaise, session }) => {
  await Reservation.updateOne(
    { _id: reservationId },
    {
      $set: {
        paymentStatus,
        paidAmount: paidAmountPaise ?? 0,
      },
    },
    sessionOption(session)
  );
};

export const initializePaymentForConfirmedReservation = async ({ reservation, session }) => {
  const totalPaise = computeReservationTotalPaise(reservation);

  if (totalPaise < 1) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Reservation total amount must be greater than zero');
  }

  const now = new Date();
  const paymentDeadline =
    reservation.paymentMethod === PAYMENT_METHODS.ONLINE
      ? new Date(now.getTime() + env.onlinePaymentExpiryMinutes * 60 * 1000)
      : undefined;

  reservation.totalAmount = totalPaise;
  reservation.paidAmount = 0;
  reservation.paymentStatus = PAYMENT_STATUS.PENDING;
  reservation.paymentDeadline = paymentDeadline;

  const provider =
    reservation.paymentMethod === PAYMENT_METHODS.ONLINE
      ? PAYMENT_PROVIDERS.RAZORPAY
      : PAYMENT_PROVIDERS.CASH;

  await Payment.create(
    [
      {
        paymentCode: generatePaymentCode(),
        reservation: reservation._id,
        customer: reservation.customer,
        pharmacy: reservation.pharmacy,
        paymentMethod: reservation.paymentMethod,
        provider,
        amount: totalPaise,
        currency: env.razorpayCurrency,
        status: PAYMENT_STATUS.PENDING,
        expiresAt: paymentDeadline,
      },
    ],
    sessionOption(session)
  );
};
