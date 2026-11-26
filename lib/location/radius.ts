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
import {
  isPlausibleCoordinate,
  isValidCoordinatePair,
  lookupCity,
} from './coordinates';

export {
  isPlausibleCoordinate,
  MAX_CITY_COORDINATE_DRIFT_MILES,
} from './coordinates';

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
  if (!home || !isValidCoordinatePair(home.lat, home.lng)) return null;
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
