import { env } from './env.js';

/**
 * Manual location (pincode / city / state) integration point.
 * Geocoding is NOT enabled unless GEOCODING_PROVIDER and credentials are configured.
 * Controllers must not invent default coordinates when GPS is missing.
 */
export const isGeocodingConfigured = () => Boolean(env.geocodingProvider);

export const resolveManualLocationCoordinates = async (_manualLocation) => {
  if (!isGeocodingConfigured()) {
    return null;
  }

  // Future: call configured provider (Google Maps, Mapbox, etc.) and return { latitude, longitude }.
  return null;
};
