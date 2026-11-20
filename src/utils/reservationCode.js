import crypto from 'node:crypto';

export const generateReservationCode = () => {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `MR-${suffix}`;
};
