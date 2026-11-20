import { Router } from 'express';
import { HTTP_STATUS, MESSAGES } from '../constants/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiResponse } from '../utils/ApiResponse.js';

export const healthRouter = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags:
 *       - Health
 *     summary: Application health check
 *     description: Returns basic application status without infrastructure credentials.
 *     responses:
 *       200:
 *         description: API is running
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: MediReech API is running
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: healthy
 *                 meta:
 *                   nullable: true
 *                   example: null
 *       500:
 *         description: Unexpected server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const response = new ApiResponse(HTTP_STATUS.OK, { status: 'healthy' }, MESSAGES.HEALTH_OK);
    res.status(response.statusCode).json(response);
  })
);
