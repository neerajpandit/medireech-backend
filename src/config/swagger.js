import path from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerJsdoc from 'swagger-jsdoc';

const configDir = path.dirname(fileURLToPath(import.meta.url));

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'MediReech API',
      version: '1.0.0',
      description: 'Pan-India medicine availability and pharmacy networking platform.',
    },
    servers: [
      {
        url: '/api/v1',
        description: 'API version 1',
      },
    ],
    tags: [
      {
        name: 'Health',
        description: 'Application health',
      },
    ],
    components: {
      schemas: {
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string' },
            data: { nullable: true },
            meta: { nullable: true },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Something went wrong' },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
            data: { nullable: true, example: null },
          },
        },
      },
    },
  },
  apis: [
    path.join(configDir, '../routes/*.js'),
    path.join(configDir, '../modules/**/*.routes.js'),
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
