import { env } from './env.js';

let sharedConnection = null;

export const isRedisConfigured = () => Boolean(env.redisUrl);

export const getRedisConnection = async () => {
  if (!isRedisConfigured()) {
    return null;
  }

  if (sharedConnection) {
    return sharedConnection;
  }

  const IORedis = (await import('ioredis')).default;
  sharedConnection = new IORedis(env.redisUrl, {
    maxRetriesPerRequest: null,
  });

  return sharedConnection;
};
