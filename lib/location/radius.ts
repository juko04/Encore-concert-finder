/**
 * Radius filtering around the user's chosen home location.
 *
 * Most venues have no coordinates, so a show's location falls back to its city centroid from the
 * static city table (approximate; labelled as such in the UI). Shows whose location cannot be
 * determined at all are NOT claimed to be nearby: they are excluded from radius-filtered views
 * rather than guessed. No Denver/Colorado default (AGENTS.md invariant 6): callers must pass the
 * user's own home coordinate.
 */

import { calculateHaversineDistanceMiles } from '@/lib/recommendation/factors/distance';
import { findCityByName } from './cities';

export interface HomePoint {
  lat: number;
  lng: number;
}

export interface LocatableEvent {
  lat?: number | null;
  lng?: number | null;
  city?: string | null;
  region?: string | null;
}

function isCoordinate(lat: unknown, lng: unknown): lat is number {
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

function lookupCity(city?: string | null, region?: string | null) {
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
  if (!isCoordinate(lat, lng)) return false;
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

export interface ResolvedEventCoordinates {
  lat: number;
  lng: number;
  precision: 'venue' | 'city_centroid';
}

export interface EventDistanceDetails {
  distanceMiles: number;
  precision: 'venue' | 'city_centroid';
}

/**
 * Resolves an event's coordinates, preferring plausible venue coordinates and falling back
 * to the static city centroid when venue coordinates are absent or implausible.
 */
export function resolveEventCoordinates(
  event: LocatableEvent,
): ResolvedEventCoordinates | null {
  if (isPlausibleCoordinate(event.lat, event.lng, event.city, event.region)) {
    return {
      lat: event.lat as number,
      lng: event.lng as number,
      precision: 'venue',
    };
  }
  const city = lookupCity(event.city, event.region);
  if (!city) return null;
  return {
    lat: city.lat,
    lng: city.lng,
    precision: 'city_centroid',
  };
}

/** Miles and coordinate precision from home to the event, or null when unknown/invalid. */
export function eventDistanceDetails(
  event: LocatableEvent,
  home: HomePoint,
): EventDistanceDetails | null {
  if (!home || !isCoordinate(home.lat, home.lng)) return null;
  const resolved = resolveEventCoordinates(event);
  if (!resolved) return null;
  return {
    distanceMiles: calculateHaversineDistanceMiles(
      home.lat,
      home.lng,
      resolved.lat,
      resolved.lng,
    ),
    precision: resolved.precision,
  };
}

/** Miles from home to the event (venue coordinate, else city centroid), or null when unknown. */
export function eventDistanceMiles(
  event: LocatableEvent,
  home: HomePoint,
): number | null {
  return eventDistanceDetails(event, home)?.distanceMiles ?? null;
}

/** Keeps only events with a known location within `radiusMiles` of home. */
export function filterEventsWithinRadius<T extends LocatableEvent>(
  events: readonly T[],
  home: HomePoint,
  radiusMiles: number,
): T[] {
  if (!Number.isFinite(radiusMiles) || radiusMiles < 0) return [];
  return events.filter((e) => {
    const d = eventDistanceMiles(e, home);
    return d !== null && d <= radiusMiles;
  });
}
