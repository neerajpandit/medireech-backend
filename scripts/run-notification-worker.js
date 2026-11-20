import mongoose from 'mongoose';
import { Queue } from 'bullmq';
import { connectDB } from '../src/config/db.js';
import { assertEnv } from '../src/config/env.js';
import { getRedisConnection, isRedisConfigured } from '../src/config/redis.js';
import '../src/modules/index.js';
import {
  NOTIFICATION_OUTBOX_QUEUE,
  startNotificationOutboxWorker,
} from '../src/modules/notifications/notification.worker.js';
import { redactSecrets } from '../src/utils/redact.js';

const SCHEDULER_INTERVAL_MS = 15_000;

const run = async () => {
  assertEnv();

  if (!isRedisConfigured()) {
    console.error('REDIS_URL is required to run the BullMQ notification worker.');
    process.exit(1);
  }

  await connectDB();
  await startNotificationOutboxWorker();

  const connection = await getRedisConnection();
  const queue = new Queue(NOTIFICATION_OUTBOX_QUEUE, { connection });

  const scheduleTick = async () => {
    await queue.add('process-outbox', {}, { removeOnComplete: 100, removeOnFail: 200 });
  };

  await scheduleTick();
  setInterval(() => {
    scheduleTick().catch((error) => {
      console.error(redactSecrets(error instanceof Error ? error.message : 'Failed to enqueue outbox job'));
    });
  }, SCHEDULER_INTERVAL_MS);

  console.log('Notification worker process running (BullMQ + periodic enqueue).');
};

run().catch((error) => {
  console.error(redactSecrets(error instanceof Error ? error.message : 'Failed to start notification worker'));
  process.exit(1);
});

process.on('SIGINT', async () => {
  await mongoose.connection.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await mongoose.connection.close();
  process.exit(0);
});
