import crypto from 'node:crypto';

export const generatePaymentCode = () => {
  const suffix = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `PAY-${suffix}`;
};
