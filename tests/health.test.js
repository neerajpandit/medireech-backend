import request from 'supertest';
import app from '../src/app.js';

describe('Health check', () => {
  it('returns the MediReech health payload', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({
      success: true,
      message: 'MediReech API is running',
      data: {
        status: 'healthy',
      },
      meta: null,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/mongodb|password|secret|jwt/i);
  });
});
