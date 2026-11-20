import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { assertEnv } from '../src/config/env.js';
import '../src/modules/index.js';
import { processPendingNotificationOutbox } from '../src/modules/notifications/notification.controller.js';
import { redactSecrets } from '../src/utils/redact.js';

const run = async () => {
  assertEnv();
  await connectDB();

  const result = await processPendingNotificationOutbox({ batchSize: 50 });
  console.log(`Processed ${result.processed} notification outbox record(s).`);

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((error) => {
  console.error(redactSecrets(error instanceof Error ? error.message : 'Notification outbox processing failed'));
  process.exit(1);
});
