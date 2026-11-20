import request from 'supertest';
import app from '../src/app.js';

describe('404 response', () => {
  it('returns a consistent not-found payload for unknown API routes', async () => {
    const response = await request(app).get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({
      success: false,
      message: 'Route not found: GET /api/v1/does-not-exist',
      errors: [],
      data: null,
    });
    expect(response.body.stack).toBeUndefined();
  });

  it('returns the same not-found shape outside the API prefix', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.data).toBeNull();
    expect(response.body.errors).toEqual([]);
    expect(response.body.message).toBe('Route not found: GET /');
  });
});
