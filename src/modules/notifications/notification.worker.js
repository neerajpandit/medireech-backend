import { Worker } from 'bullmq';
import { env } from '../../config/env.js';
import { getRedisConnection, isRedisConfigured } from '../../config/redis.js';
import { processPendingNotificationOutbox } from './notification.controller.js';

export const NOTIFICATION_OUTBOX_QUEUE = 'notification-outbox';

export const startNotificationOutboxWorker = async () => {
  if (!isRedisConfigured()) {
    console.warn(
      'REDIS_URL is not configured. Run `npm run process:notifications` via cron instead of the BullMQ worker.'
    );
    return null;
  }

  const connection = await getRedisConnection();

  const worker = new Worker(
    NOTIFICATION_OUTBOX_QUEUE,
    async () => processPendingNotificationOutbox({ batchSize: 25 }),
    {
      connection,
      concurrency: 1,
    }
  );

  worker.on('failed', (job, error) => {
    console.error(`Notification outbox job ${job?.id} failed: ${error.message}`);
  });

  if (!env.isTest) {
    console.log('Notification outbox BullMQ worker started');
  }

  return worker;
};
