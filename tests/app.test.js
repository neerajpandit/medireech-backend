import request from 'supertest';
import app from '../src/app.js';
import { swaggerSpec } from '../src/config/swagger.js';

describe('Basic application configuration', () => {
  it('mounts the API under /api/v1 and applies security headers', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toBeUndefined();
    expect(response.headers['content-security-policy']).not.toMatch(/upgrade-insecure-requests/);
    expect(response.headers.ratelimit).toBeDefined();
  });

  it('accepts URL-encoded bodies before routing', async () => {
    const response = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('name=MediReech');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  it('rejects invalid JSON through the centralized error handler', async () => {
    const response = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken"');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: 'Invalid JSON payload',
      errors: [],
      data: null,
    });
    expect(response.body.stack).toBeUndefined();
  });

  it('allows a configured CORS origin', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects an origin that is not configured', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      success: false,
      message: 'Origin not allowed by CORS',
      errors: [],
      data: null,
    });
  });

  it('serves Swagger UI and an OpenAPI document for API v1', async () => {
    const response = await request(app).get('/api-docs/');

    expect(response.status).toBe(200);
    expect(response.text).toContain('MediReech API');
    expect(swaggerSpec.openapi).toBe('3.0.3');
    expect(swaggerSpec.info).toMatchObject({
      title: 'MediReech API',
      version: '1.0.0',
    });
    expect(swaggerSpec.servers).toEqual([
      {
        url: '/api/v1',
        description: 'API version 1',
      },
    ]);
    expect(swaggerSpec.paths['/health']).toBeDefined();
  });

  it('does not rate limit the documentation route', async () => {
    const response = await request(app).get('/api-docs/');

    expect(response.status).toBe(200);
    expect(response.headers.ratelimit).toBeUndefined();
  });
});
