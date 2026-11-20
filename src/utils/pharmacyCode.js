import crypto from 'node:crypto';

export const generatePharmacyCode = () => {
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `PH-${Date.now().toString(36).toUpperCase()}-${suffix}`;
};
