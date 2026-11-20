import { RESERVATION_STATUS, USER_ROLES } from '../constants/database.enums.js';
import { RESERVATION_NOTIFICATION_EVENTS } from '../constants/reservation.constants.js';
import { Reservation } from '../modules/reservations/reservation.model.js';
import { enqueueReservationNotification } from '../utils/enqueueNotificationOutbox.js';

/**
 * Atomically expire pending reservations whose SLA has elapsed.
 * Safe to run repeatedly (idempotent).
 *
 * Schedule via external cron (no Redis/BullMQ required), e.g. every minute:
 *   npm run expire:reservations
 */
export const processExpiredPendingReservations = async ({ batchSize = 50, now = new Date() } = {}) => {
  const expiredCandidates = await Reservation.find({
    status: RESERVATION_STATUS.PENDING,
    expiresAt: { $lte: now },
  })
    .select('_id customer pharmacy reservationCode')
    .limit(batchSize)
    .lean();

  let expiredCount = 0;

  for (const candidate of expiredCandidates) {
    const reservation = await Reservation.findOneAndUpdate(
      {
        _id: candidate._id,
        status: RESERVATION_STATUS.PENDING,
        expiresAt: { $lte: now },
      },
      {
        $set: { status: RESERVATION_STATUS.EXPIRED },
        $push: {
          statusHistory: {
            status: RESERVATION_STATUS.EXPIRED,
            changedBy: candidate.customer,
            actorRole: USER_ROLES.CUSTOMER,
            reason: 'Reservation expired after pharmacy response SLA',
            changedAt: now,
          },
        },
      },
      { new: true }
    );

    if (!reservation) {
      continue;
    }

    expiredCount += 1;

    await enqueueReservationNotification({
      eventType: RESERVATION_NOTIFICATION_EVENTS.RESERVATION_EXPIRED,
      recipientUserId: reservation.customer,
      recipientType: 'USER',
      recipientId: reservation.customer,
      reservationId: reservation._id,
      payload: { reservationCode: reservation.reservationCode },
      idempotencyKey: `reservation-expired:${reservation._id.toString()}`,
    });
  }

  return { expiredCount, scanned: expiredCandidates.length };
};
