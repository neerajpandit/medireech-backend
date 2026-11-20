import { NotificationOutbox } from '../modules/notifications/notificationOutbox.model.js';

export const enqueueNotificationOutbox = async ({
  eventType,
  recipient,
  payload = {},
  relatedResourceType,
  relatedResourceId,
  idempotencyKey,
  session,
}) => {
  const document = {
    eventType,
    recipient,
    payload,
    relatedResourceType,
    relatedResourceId,
    idempotencyKey,
    status: 'PENDING',
    attempts: 0,
  };

  try {
    if (session) {
      await NotificationOutbox.create([document], { session });
      return;
    }

    await NotificationOutbox.create(document);
  } catch (error) {
    if (error?.code === 11000) {
      return;
    }

    throw error;
  }
};

/** Backward-compatible reservation helper used by Phase 7 controllers. */
export const enqueueReservationNotification = async ({
  eventType,
  recipientType,
  recipientId,
  reservationId,
  payload = {},
  idempotencyKey,
  session,
  recipientUserId,
}) => {
  const recipient = recipientUserId || recipientId;

  await enqueueNotificationOutbox({
    eventType,
    recipient,
    payload: {
      ...payload,
      recipientType,
      pharmacyId: recipientType === 'PHARMACY' ? recipientId : payload.pharmacyId,
    },
    relatedResourceType: 'Reservation',
    relatedResourceId: reservationId,
    idempotencyKey,
    session,
  });
};
