import express from 'express';
import request from 'supertest';
import Joi from 'joi';
import { validate } from '../src/middlewares/validate.middleware.js';
import { errorHandler } from '../src/middlewares/error.middleware.js';

const schema = {
  body: Joi.object({
    name: Joi.string().trim().min(1).required(),
    qty: Joi.number().integer().min(1).required(),
  }),
  params: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }),
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
  }),
};

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post('/items/:id', validate(schema), (req, res) => {
    res.status(200).json({
      body: req.body,
      params: req.params,
      query: req.query,
    });
  });
  app.use(errorHandler);
  return app;
};

describe('Joi validation middleware', () => {
  it('collects every validation error when abortEarly is false', async () => {
    const response = await request(buildApp()).post('/items/not-an-id').query({ page: 0 }).send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.data).toBeNull();
    expect(response.body.errors.length).toBeGreaterThan(1);
    expect(response.body.errors.map((item) => item.field)).toEqual(
      expect.arrayContaining(['id', 'page', 'name', 'qty'])
    );
  });

  it('assigns sanitized body, params, and query values back onto the request', async () => {
    const id = '507f1f77bcf86cd799439011';
    const response = await request(buildApp())
      .post(`/items/${id}`)
      .query({ page: '2', extra: 'drop-me' })
      .send({ name: '  Paracetamol  ', qty: '3', unexpected: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      body: { name: 'Paracetamol', qty: 3 },
      params: { id },
      query: { page: 2 },
    });
  });
});
