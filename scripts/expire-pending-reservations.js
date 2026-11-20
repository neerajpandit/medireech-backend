import { assertEnv } from '../src/config/env.js';
import { connectDB } from '../src/config/db.js';
import '../src/modules/index.js';
import { processExpiredPendingReservations } from '../src/jobs/reservationExpiry.js';
import mongoose from 'mongoose';

const run = async () => {
  assertEnv();
  await connectDB();

  const result = await processExpiredPendingReservations();
  console.log(
    `Reservation expiry run complete: expired=${result.expiredCount}, scanned=${result.scanned}`
  );

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((error) => {
  console.error(`Reservation expiry run failed: ${error.message}`);
  process.exit(1);
});
