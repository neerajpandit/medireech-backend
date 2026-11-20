import rateLimit from 'express-rate-limit';
import { HTTP_STATUS } from '../constants/index.js';
import { env } from '../config/env.js';

export const publicSearchRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : env.publicSearchRateLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
      success: false,
      message: 'Too many search requests, please try again later',
      errors: [],
      data: null,
    });
  },
});
