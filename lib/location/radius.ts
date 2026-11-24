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
    Math.abs(lng) <= 180
  );
}

/** Miles from home to the event (venue coordinate, else city centroid), or null when unknown. */
export function eventDistanceMiles(
  event: LocatableEvent,
  home: HomePoint,
): number | null {
  let lat = event.lat;
  let lng = event.lng;
  if (!isCoordinate(lat, lng)) {
    const city = findCityByName(event.city, event.region);
    if (!city) return null;
    lat = city.lat;
    lng = city.lng;
  }
  return calculateHaversineDistanceMiles(
    home.lat,
    home.lng,
    lat as number,
    lng as number,
  );
}

/** Keeps only events with a known location within `radiusMiles` of home. */
export function filterEventsWithinRadius<T extends LocatableEvent>(
  events: readonly T[],
  home: HomePoint,
  radiusMiles: number,
): T[] {
  return events.filter((e) => {
    const d = eventDistanceMiles(e, home);
    return d !== null && d <= radiusMiles;
  });
}
