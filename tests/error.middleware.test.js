import express from 'express';
import request from 'supertest';
import { errorHandler } from '../src/middlewares/error.middleware.js';
import { asyncHandler } from '../src/utils/asyncHandler.js';
import { ApiError } from '../src/utils/ApiError.js';

const buildApp = () => {
  const app = express();

  app.get(
    '/operational',
    asyncHandler(async () => {
      throw new ApiError(422, 'Validation failed', [
        { field: 'name', message: 'name is required' },
      ]);
    })
  );

  app.get(
    '/crash',
    asyncHandler(async () => {
      throw new Error('connection failed mongodb://admin:super-secret@localhost:27017/medireech');
    })
  );

  app.use(errorHandler);
  return app;
};

describe('Centralized error response', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns operational error details without a stack trace', async () => {
    const response = await request(buildApp()).get('/operational');

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      success: false,
      message: 'Validation failed',
      errors: [{ field: 'name', message: 'name is required' }],
      data: null,
    });
  });

  it('hides internal failures and secrets in production', async () => {
    process.env.NODE_ENV = 'production';

    const response = await request(buildApp()).get('/crash');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: 'Something went wrong',
      errors: [],
      data: null,
    });
    expect(JSON.stringify(response.body)).not.toContain('super-secret');
    expect(response.body.stack).toBeUndefined();
  });

  it('redacts secrets from development error details', async () => {
    process.env.NODE_ENV = 'development';

    const response = await request(buildApp()).get('/crash');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.data).toBeNull();
    expect(response.body.message).not.toContain('super-secret');
    expect(response.body.message).toContain('[redacted]');
    expect(response.body.stack).toEqual(expect.any(String));
    expect(response.body.stack).not.toContain('super-secret');
  });
});
