import { assertEnv } from '../src/config/env.js';

const KEYS = [
  'NODE_ENV',
  'PORT',
  'MONGODB_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_ACCESS_EXPIRES_IN',
  'JWT_REFRESH_EXPIRES_IN',
  'CLIENT_URL',
  'CORS_ORIGINS',
];

describe('Environment configuration', () => {
  const snapshot = {};

  beforeEach(() => {
    for (const key of KEYS) {
      snapshot[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (snapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = snapshot[key];
      }
    }
  });

  const fillProductionEnv = () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '5000';
    process.env.MONGODB_URI = 'mongodb+srv://user:pass@cluster.mongodb.net/medireech';
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.CLIENT_URL = 'https://app.medireech.example';
    process.env.CORS_ORIGINS = 'https://app.medireech.example';
  };

  it('accepts a complete production environment', () => {
    fillProductionEnv();
    expect(() => assertEnv()).not.toThrow();
  });

  it('reports every missing production variable together', () => {
    process.env.NODE_ENV = 'production';
    for (const key of KEYS) {
      if (key !== 'NODE_ENV') {
        delete process.env[key];
      }
    }

    expect(() => assertEnv()).toThrow(
      'Missing mandatory environment variables for production: MONGODB_URI, PORT, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN, CLIENT_URL, CORS_ORIGINS'
    );
  });

  it('rejects short JWT secrets in production without echoing them', () => {
    fillProductionEnv();
    process.env.JWT_ACCESS_SECRET = 'short-secret';

    expect(() => assertEnv()).toThrow(
      'JWT secrets must be at least 32 characters in production: JWT_ACCESS_SECRET'
    );
  });

  it('requires a MongoDB URI in development and does not echo an invalid value', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.MONGODB_URI;

    expect(() => assertEnv()).toThrow(
      'Missing mandatory environment variables for development: MONGODB_URI'
    );

    process.env.MONGODB_URI = 'postgres://user:super-secret-password@localhost/db';
    expect(() => assertEnv()).toThrow('MONGODB_URI must start with mongodb:// or mongodb+srv://');

    try {
      assertEnv();
    } catch (error) {
      expect(error.message).not.toContain('super-secret-password');
    }
  });

  it('rejects an unknown NODE_ENV', () => {
    process.env.NODE_ENV = 'staging';
    expect(() => assertEnv()).toThrow('Invalid NODE_ENV "staging"');
  });
});
