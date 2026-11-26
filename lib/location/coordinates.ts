/**
 * Single source of truth for venue / event coordinate validity. Used by ingestion
 * (parseVenueCoordinates, fillVenueCoordinates, repository fill) and display (radius filtering),
 * so a coordinate is accepted or rejected identically everywhere:
 *   1. finite, |lat| <= 90, |lng| <= 180, and not the null island (0, 0)   -> isValidCoordinatePair
 *   2. US state code with an eastern-hemisphere longitude (dropped minus sign)
 *   3. US state code with a Mexico/Caribbean-latitude coordinate (foreign venue under a US label)
 *   4. a known city whose centroid is > MAX_CITY_COORDINATE_DRIFT_MILES away   -> isPlausibleCoordinate
 */

import { calculateHaversineDistanceMiles } from '@/lib/recommendation/factors/distance';
import { findCityByName } from './cities';

/** Range / null-island check only (rules 1). Narrows both arguments to number. */
export function isValidCoordinatePair(
  lat: unknown,
  lng: unknown,
): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

// findCityByName normalises every city name per call; a full-catalog scan calls it per event, so
// memoise by (city, region). The city table is static, so the cache never goes stale.
const CITY_LOOKUP_CACHE = new Map<string, ReturnType<typeof findCityByName>>();
const CITY_LOOKUP_CACHE_MAX = 5000;

export function lookupCity(city?: string | null, region?: string | null) {
  if (!city) return null;
  const key = `${city}\u0000${region ?? ''}`;
  const hit = CITY_LOOKUP_CACHE.get(key);
  if (hit !== undefined) return hit;
  const found = findCityByName(city, region);
  if (CITY_LOOKUP_CACHE.size >= CITY_LOOKUP_CACHE_MAX)
    CITY_LOOKUP_CACHE.clear();
  CITY_LOOKUP_CACHE.set(key, found);
  return found;
}

const US_STATE_CODE =
  /^(A[LKZR]|C[AOT]|DE|FL|GA|HI|I[DLNA]|K[SY]|LA|M[EDAINSOT]|N[EVHJMYCD]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[TA]|W[AVIY]|DC)$/i;

/** A venue coordinate this far from its own (known) city centroid is a source data error. */
export const MAX_CITY_COORDINATE_DRIFT_MILES = 150;

/**
 * False when the coordinate is invalid, or when the city is in the city table and the coordinate
 * lies implausibly far from it (e.g. a source that dropped a longitude's minus sign). Unknown
 * cities are trusted: the coordinate is the only evidence there is.
 */
export function isPlausibleCoordinate(
  lat: unknown,
  lng: unknown,
  city?: string | null,
  region?: string | null,
): boolean {
  if (!isValidCoordinatePair(lat, lng)) return false;
  // A US state code with an eastern-hemisphere longitude is a dropped minus sign, whether or not
  // the city is in the table (Alaska/Hawaii/territories stay in the western hemisphere too).
  if (region && US_STATE_CODE.test(region.trim())) {
    if ((lng as number) > 0) return false;
    // Mexico / Caribbean coordinates under a US state label (the source mislabelled the venue):
    // no US state lies south of 24.4 N except Hawaii (west of 154 W).
    if ((lat as number) < 24.4 && (lng as number) > -154) return false;
  }
  const known = lookupCity(city, region);
  if (!known) return true;
  return (
    calculateHaversineDistanceMiles(
      lat as number,
      lng as number,
      known.lat,
      known.lng,
    ) <= MAX_CITY_COORDINATE_DRIFT_MILES
  );
}
