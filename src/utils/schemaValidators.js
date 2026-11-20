const INDIAN_MOBILE_PATTERN = /^[6-9]\d{9}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;
const GST_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export const normalizeIndianMobile = (value) => {
  if (value == null || value === '') {
    return value;
  }

  const digits = String(value).replace(/\D/g, '');

  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }

  if (digits.length === 10) {
    return digits;
  }

  return String(value).trim();
};

export const isValidIndianMobile = (value) => INDIAN_MOBILE_PATTERN.test(normalizeIndianMobile(value));

export const validateIndianMobile = (value) => {
  if (value == null || value === '') {
    return true;
  }

  return isValidIndianMobile(value);
};

export const normalizeEmail = (value) => {
  if (value == null || value === '') {
    return undefined;
  }

  return String(value).trim().toLowerCase();
};

export const validateEmail = (value) => {
  if (value == null || value === '') {
    return true;
  }

  return EMAIL_PATTERN.test(String(value));
};

export const validatePincode = (value) => {
  if (value == null || value === '') {
    return true;
  }

  return PINCODE_PATTERN.test(String(value).trim());
};

export const validateGstNumber = (value) => {
  if (value == null || value === '') {
    return true;
  }

  return GST_PATTERN.test(String(value).trim().toUpperCase());
};

export const validateGeoJsonPoint = (location) => {
  if (location == null) {
    return true;
  }

  if (location.type !== 'Point') {
    return false;
  }

  const coordinates = location.coordinates;

  if (!Array.isArray(coordinates) || coordinates.length !== 2) {
    return false;
  }

  const [longitude, latitude] = coordinates;

  return (
    typeof longitude === 'number' &&
    typeof latitude === 'number' &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
};

export const isBatchExpired = (expiryDate, now = new Date()) => {
  if (!(expiryDate instanceof Date)) {
    return true;
  }

  return expiryDate.getTime() < now.getTime();
};
