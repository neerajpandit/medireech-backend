import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { TOKEN_TYPES } from '../constants/auth.constants.js';
import { ApiError } from './ApiError.js';
import { HTTP_STATUS } from '../constants/index.js';

export const signAccessToken = ({ userId, role, sessionId }) =>
  jwt.sign(
    {
      sub: userId,
      role,
      sessionId,
      type: TOKEN_TYPES.ACCESS,
    },
    env.jwtAccessSecret,
    { expiresIn: env.jwtAccessExpiresIn }
  );

export const signRefreshToken = ({ userId, role, sessionId }) =>
  jwt.sign(
    {
      sub: userId,
      role,
      sessionId,
      type: TOKEN_TYPES.REFRESH,
    },
    env.jwtRefreshSecret,
    { expiresIn: env.jwtRefreshExpiresIn }
  );

export const verifyAccessToken = (token) => {
  try {
    const payload = jwt.verify(token, env.jwtAccessSecret);

    if (payload.type !== TOKEN_TYPES.ACCESS) {
      throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Invalid access token');
    }

    return payload;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Invalid or expired access token');
  }
};

export const verifyRefreshToken = (token) => {
  try {
    const payload = jwt.verify(token, env.jwtRefreshSecret);

    if (payload.type !== TOKEN_TYPES.REFRESH) {
      throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Invalid refresh token');
    }

    return payload;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Invalid or expired refresh token');
  }
};

export const decodeTokenExpiry = (token) => {
  const decoded = jwt.decode(token);

  if (!decoded?.exp) {
    return null;
  }

  return new Date(decoded.exp * 1000);
};
