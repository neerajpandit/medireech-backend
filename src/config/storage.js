import { env } from './env.js';

/** Private object storage (S3/GCS) is metadata-only in API; uploads happen client-side with signed URLs in future phases. */
export const isPrivateStorageConfigured = () =>
  Boolean(env.privateObjectStorageEnabled) || env.isTest;
