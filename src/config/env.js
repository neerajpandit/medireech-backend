import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = path.dirname(fileURLToPath(import.meta.url));

if (process.env.NODE_ENV !== 'test') {
  dotenv.config({
    path: path.resolve(configDir, '../../.env'),
    quiet: true,
  });
}

const PRODUCTION_REQUIRED_KEYS = [
  'PORT',
  'MONGODB_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_ACCESS_EXPIRES_IN',
  'JWT_REFRESH_EXPIRES_IN',
  'CLIENT_URL',
  'CORS_ORIGINS',
];

const JWT_SECRET_KEYS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
const MIN_JWT_SECRET_LENGTH = 32;
const ALLOWED_NODE_ENVS = ['development', 'test', 'production'];

const read = (key) => {
  const value = process.env[key];
  return typeof value === 'string' ? value.trim() : '';
};

const parseOrigins = (value) =>
  value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

export const env = {
  get nodeEnv() {
    return read('NODE_ENV') || 'development';
  },
  get isProduction() {
    return this.nodeEnv === 'production';
  },
  get isDevelopment() {
    return this.nodeEnv === 'development';
  },
  get isTest() {
    return this.nodeEnv === 'test';
  },
  get port() {
    return Number(read('PORT') || 5000);
  },
  get mongodbUri() {
    return read('MONGODB_URI');
  },
  get jwtAccessSecret() {
    return read('JWT_ACCESS_SECRET');
  },
  get jwtRefreshSecret() {
    return read('JWT_REFRESH_SECRET');
  },
  get jwtAccessExpiresIn() {
    return read('JWT_ACCESS_EXPIRES_IN') || '15m';
  },
  get jwtRefreshExpiresIn() {
    return read('JWT_REFRESH_EXPIRES_IN') || '7d';
  },
  get clientUrl() {
    return read('CLIENT_URL');
  },
  get otpLength() {
    return Number(read('OTP_LENGTH') || 6);
  },
  get otpExpiresInMinutes() {
    return Number(read('OTP_EXPIRES_IN_MINUTES') || 5);
  },
  get otpFixedCode() {
    return read('OTP_FIXED_CODE') || (this.isTest ? '123456' : '');
  },
  get exposeOtpInResponses() {
    return this.isTest || read('EXPOSE_OTP_IN_RESPONSES') === 'true';
  },
  get bcryptSaltRounds() {
    return Number(read('BCRYPT_SALT_ROUNDS') || 10);
  },
  get superAdminUsername() {
    return read('SUPER_ADMIN_USERNAME');
  },
  get superAdminPassword() {
    return read('SUPER_ADMIN_PASSWORD');
  },
  get inventoryLowStockThreshold() {
    return Number(read('INVENTORY_LOW_STOCK_THRESHOLD') || 10);
  },
  get inventoryNearExpiryDays() {
    return Number(read('INVENTORY_NEAR_EXPIRY_DAYS') || 30);
  },
  get geocodingProvider() {
    return read('GEOCODING_PROVIDER');
  },
  get publicSearchRateLimit() {
    return Number(read('PUBLIC_SEARCH_RATE_LIMIT') || 120);
  },
  get reservationMaxItems() {
    return Number(read('RESERVATION_MAX_ITEMS') || 10);
  },
  get redisUrl() {
    return read('REDIS_URL');
  },
  get fcmProjectId() {
    return read('FCM_PROJECT_ID');
  },
  get fcmClientEmail() {
    return read('FCM_CLIENT_EMAIL');
  },
  get fcmPrivateKey() {
    return read('FCM_PRIVATE_KEY');
  },
  get razorpayKeyId() {
    return read('RAZORPAY_KEY_ID');
  },
  get razorpayKeySecret() {
    return read('RAZORPAY_KEY_SECRET');
  },
  get razorpayWebhookSecret() {
    return read('RAZORPAY_WEBHOOK_SECRET');
  },
  get razorpayCurrency() {
    return read('RAZORPAY_CURRENCY') || 'INR';
  },
  get onlinePaymentExpiryMinutes() {
    return Number(read('ONLINE_PAYMENT_EXPIRY_MINUTES') || 60);
  },
  get unpaidReservationCancelEnabled() {
    return read('UNPAID_RESERVATION_CANCEL_ENABLED') !== 'false';
  },
  get privateObjectStorageEnabled() {
    return read('PRIVATE_OBJECT_STORAGE_ENABLED') === 'true';
  },
  get corsOrigins() {
    const origins = parseOrigins(read('CORS_ORIGINS'));
    const clientUrl = read('CLIENT_URL');

    if (clientUrl && !origins.includes(clientUrl)) {
      origins.push(clientUrl);
    }

    if (this.isTest && origins.length === 0) {
      return ['http://localhost:3000'];
    }

    return origins;
  },
};

export const assertEnv = () => {
  const nodeEnv = env.nodeEnv;

  if (!ALLOWED_NODE_ENVS.includes(nodeEnv)) {
    throw new Error(
      `Invalid NODE_ENV "${nodeEnv}". Expected one of: ${ALLOWED_NODE_ENVS.join(', ')}.`
    );
  }

  if (nodeEnv === 'test') {
    return;
  }

  const missing = [];

  if (!read('MONGODB_URI')) {
    missing.push('MONGODB_URI');
  }

  if (nodeEnv === 'production') {
    for (const key of PRODUCTION_REQUIRED_KEYS) {
      if (!missing.includes(key) && !read(key)) {
        missing.push(key);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing mandatory environment variables for ${nodeEnv}: ${missing.join(', ')}`
    );
  }

  const port = Number(read('PORT') || (nodeEnv === 'production' ? '' : 5000));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid PORT. Expected an integer between 1 and 65535.');
  }

  const mongodbUri = read('MONGODB_URI');
  if (!mongodbUri.startsWith('mongodb://') && !mongodbUri.startsWith('mongodb+srv://')) {
    throw new Error('MONGODB_URI must start with mongodb:// or mongodb+srv://');
  }

  if (nodeEnv !== 'production') {
    return;
  }

  const shortSecrets = JWT_SECRET_KEYS.filter((key) => read(key).length < MIN_JWT_SECRET_LENGTH);
  if (shortSecrets.length > 0) {
    throw new Error(
      `JWT secrets must be at least ${MIN_JWT_SECRET_LENGTH} characters in production: ${shortSecrets.join(', ')}`
    );
  }

  let clientUrl;
  try {
    clientUrl = new URL(read('CLIENT_URL'));
  } catch {
    clientUrl = null;
  }

  if (!clientUrl || !['http:', 'https:'].includes(clientUrl.protocol)) {
    throw new Error('CLIENT_URL must be a valid http or https URL in production.');
  }
};
