import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { swaggerSpec } from './config/swagger.js';
import { HTTP_STATUS } from './constants/index.js';
import { ApiError } from './utils/ApiError.js';
import routes from './routes/index.js';
import { handlePaymentWebhook } from './modules/payments/payment.controller.js';
import { asyncHandler } from './utils/asyncHandler.js';
import { notFound } from './middlewares/notFound.middleware.js';
import { errorHandler } from './middlewares/error.middleware.js';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

const contentSecurityPolicyDirectives = {
  ...helmet.contentSecurityPolicy.getDefaultDirectives(),
  'script-src': ["'self'", "'unsafe-inline'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'https://validator.swagger.io'],
};

if (!env.isProduction) {
  contentSecurityPolicyDirectives['upgrade-insecure-requests'] = null;
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: contentSecurityPolicyDirectives,
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: env.isProduction,
  })
);

const localDevOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const isAllowed = env.corsOrigins.includes(origin);
      const isLocalDevelopmentOrigin = env.isDevelopment && localDevOrigin.test(origin);

      if (isAllowed || isLocalDevelopmentOrigin) {
        callback(null, true);
        return;
      }

      callback(new ApiError(HTTP_STATUS.FORBIDDEN, 'Origin not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204,
  })
);

app.post(
  '/api/v1/payments/webhook',
  express.raw({ type: 'application/json' }),
  asyncHandler(handlePaymentWebhook)
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

if (!env.isTest) {
  app.use(morgan(env.isProduction ? 'combined' : 'dev'));
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : env.isDevelopment ? 10000 : 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
      success: false,
      message: 'Too many requests, please try again later',
      errors: [],
      data: null,
    });
  },
});

app.use('/api', apiLimiter);
app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'MediReech API Docs',
    swaggerOptions: {
      persistAuthorization: true,
    },
  })
);
app.use('/api/v1', routes);
app.use(notFound);
app.use(errorHandler);

export default app;
