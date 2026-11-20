import { USER_ROLES } from './database.enums.js';

export const USERNAME_PASSWORD_ROLES = Object.freeze([
  USER_ROLES.PHARMACY_OWNER,
  USER_ROLES.PHARMACY_STAFF,
  USER_ROLES.SUPER_ADMIN,
  USER_ROLES.OPERATIONS_ADMIN,
]);

export const TOKEN_TYPES = Object.freeze({
  ACCESS: 'access',
  REFRESH: 'refresh',
});

export const OTP_PURPOSE = Object.freeze({
  CUSTOMER_LOGIN: 'CUSTOMER_LOGIN',
});

export const AUTH_MESSAGES = Object.freeze({
  OTP_SENT: 'OTP sent successfully',
  LOGIN_SUCCESS: 'Login successful',
  LOGOUT_SUCCESS: 'Logged out successfully',
  LOGOUT_ALL_SUCCESS: 'Logged out from all sessions',
  REFRESH_SUCCESS: 'Access token refreshed',
  SESSION_REVOKED: 'Session revoked successfully',
});

export const AUTH_COOKIES = Object.freeze({
  ACCESS: 'accessToken',
  REFRESH: 'refreshToken',
});
