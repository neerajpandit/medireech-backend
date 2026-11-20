import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { assertEnv } from '../src/config/env.js';
import '../src/modules/index.js';
import {
  processExpiredOnlinePayments,
  processUnpaidOnlineReservations,
} from '../src/modules/payments/payment.controller.js';
import { redactSecrets } from '../src/utils/redact.js';

const run = async () => {
  assertEnv();
  await connectDB();

  const expired = await processExpiredOnlinePayments({ batchSize: 100 });
  const cancelled = await processUnpaidOnlineReservations({ batchSize: 50 });

  console.log(
    `Expired ${expired.expiredCount} online payment attempt(s); cancelled ${cancelled.cancelledCount} unpaid reservation(s).`
  );

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((error) => {
  console.error(redactSecrets(error instanceof Error ? error.message : 'Payment job processing failed'));
  process.exit(1);
});
