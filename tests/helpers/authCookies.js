import { AUTH_COOKIES } from '../../src/constants/auth.constants.js';

export const getCookieValue = (response, name) => {
  const header = response.headers['set-cookie'];

  if (!header) {
    return null;
  }

  const cookies = Array.isArray(header) ? header : [header];

  for (const cookie of cookies) {
    const prefix = `${name}=`;

    if (cookie.startsWith(prefix)) {
      return decodeURIComponent(cookie.slice(prefix.length).split(';')[0]);
    }
  }

  return null;
};

export const accessTokenFromAuthResponse = (response) => {
  const token = getCookieValue(response, AUTH_COOKIES.ACCESS);

  if (!token) {
    throw new Error('accessToken cookie was not set');
  }

  return token;
};
