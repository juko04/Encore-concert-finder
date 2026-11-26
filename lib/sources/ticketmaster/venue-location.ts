/**
 * Venue coordinates from a Ticketmaster venue object (pure).
 *
 * Ticketmaster supplies `location: { latitude, longitude }` as strings for nearly every venue.
 * They are validated here with the shared coordinate rules (lib/location/coordinates.ts: finite,
 * in range, not the null island 0/0) and never guessed.
 */

import { isValidCoordinatePair } from '@/lib/location/coordinates';

export interface VenueCoordinates {
  lat: number;
  lng: number;
}

export function parseVenueCoordinates(
  location:
    | { latitude?: string | number | null; longitude?: string | number | null }
    | null
    | undefined,
): VenueCoordinates | null {
  if (!location || typeof location !== 'object') return null;
  const rawLat = location.latitude;
  const rawLng = location.longitude;
  if (
    (typeof rawLat !== 'number' && typeof rawLat !== 'string') ||
    (typeof rawLng !== 'number' && typeof rawLng !== 'string')
  ) {
    return null;
  }
  if (
    (typeof rawLat === 'string' && rawLat.trim() === '') ||
    (typeof rawLng === 'string' && rawLng.trim() === '')
  ) {
    return null;
  }
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!isValidCoordinatePair(lat, lng)) return null;
  // Keep ~1 m precision; avoids float noise (and -0) in stored values.
  return {
    lat: Math.round(lat * 1e6) / 1e6 || 0,
    lng: Math.round(lng * 1e6) / 1e6 || 0,
  };
}

/** Reads `rawPayload.venueLocation` written by the parser; null when absent/invalid. */
export function getCandidateVenueCoordinates(candidate: {
  rawPayload?: Record<string, unknown> | null;
}): VenueCoordinates | null {
  const v = candidate.rawPayload?.venueLocation;
  if (!v || typeof v !== 'object') return null;
  const loc = v as { lat?: unknown; lng?: unknown };
  return parseVenueCoordinates({
    latitude: loc.lat as number | string | undefined,
    longitude: loc.lng as number | string | undefined,
  });
}
