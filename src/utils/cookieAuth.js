import { env } from '../config/env.js';
import { AUTH_COOKIES } from '../constants/auth.constants.js';

const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/i;
const UNIT_TO_MS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export const durationToMs = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  const match = DURATION_PATTERN.exec(String(value || '').trim());

  if (!match) {
    return undefined;
  }

  return Number(match[1]) * UNIT_TO_MS[match[2].toLowerCase()];
};

const baseCookieOptions = () => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'lax',
});

export const accessCookieOptions = () => ({
  ...baseCookieOptions(),
  path: '/',
  maxAge: durationToMs(env.jwtAccessExpiresIn),
});

export const refreshCookieOptions = () => ({
  ...baseCookieOptions(),
  path: '/api/v1/auth',
  maxAge: durationToMs(env.jwtRefreshExpiresIn),
});

const clearableOptions = (options) => {
  const next = { ...options };
  delete next.maxAge;
  return next;
};

export const setAuthCookies = (res, { accessToken, refreshToken }) => {
  res.cookie(AUTH_COOKIES.ACCESS, accessToken, accessCookieOptions());
  res.cookie(AUTH_COOKIES.REFRESH, refreshToken, refreshCookieOptions());
};

export const setAccessCookie = (res, accessToken) => {
  res.cookie(AUTH_COOKIES.ACCESS, accessToken, accessCookieOptions());
};

export const clearAuthCookies = (res) => {
  res.clearCookie(AUTH_COOKIES.ACCESS, clearableOptions(accessCookieOptions()));
  res.clearCookie(AUTH_COOKIES.REFRESH, clearableOptions(refreshCookieOptions()));
};

export const readAccessToken = (req) => {
  const cookieToken = req.cookies?.[AUTH_COOKIES.ACCESS];

  if (cookieToken) {
    return cookieToken;
  }

  const authorization = req.get('authorization');

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return '';
  }

  return authorization.slice('Bearer '.length).trim();
};

export const readRefreshToken = (req) =>
  req.cookies?.[AUTH_COOKIES.REFRESH] || req.body?.refreshToken || '';
