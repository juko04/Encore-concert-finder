/**
 * Home location: the user's chosen city or approximate coordinate.
 *
 * Stored in the `encore_home_city` cookie (everyone) and, for signed-in users,
 * also in profiles.home_lat_approx / home_lng_approx.
 *
 * Privacy: no IP lookup and no third-party service is used. A browser location
 * is only requested when the user presses "Use my location", and it is rounded
 * to 2 decimal places (about 0.7 miles) before it is stored anywhere.
 *
 * This module is pure (no next/headers) so it is safe on both client and server.
 */

import { z } from 'zod';
import {
  NEAREST_CITY_MAX_MILES,
  findCityBySlug,
  findNearestCity,
} from './cities';

export const HOME_LOCATION_COOKIE = 'encore_home_city';
export const HOME_LOCATION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const COORD_DECIMALS = 2;

export interface HomeLocation {
  kind: 'city' | 'geo';
  /** Text shown in the header, e.g. "Denver". */
  label: string;
  /** Known city used for the "Near {city}" row; absent when nothing is close. */
  city?: string;
  state?: string;
  lat: number;
  lng: number;
}

export function roundCoordinate(value: number): number {
  const f = 10 ** COORD_DECIMALS;
  return Math.round(value * f) / f;
}

export const homeLocationInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('city'), slug: z.string().min(1).max(80) }),
  z.object({
    kind: z.literal('geo'),
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  }),
]);

export type HomeLocationInput = z.infer<typeof homeLocationInputSchema>;

/** Cookie value for an input. Uses "|" (comma is not cookie-safe). */
export function serializeHomeLocation(input: HomeLocationInput): string | null {
  if (input.kind === 'city') {
    return findCityBySlug(input.slug) ? `city:${input.slug}` : null;
  }
  return `geo:${roundCoordinate(input.lat)}|${roundCoordinate(input.lng)}`;
}

/** Resolves a stored cookie value. Returns null for anything invalid. */
export function resolveHomeLocation(
  raw: string | null | undefined,
): HomeLocation | null {
  if (!raw) return null;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }

  if (value.startsWith('city:')) {
    const c = findCityBySlug(value.slice(5));
    if (!c) return null;
    return {
      kind: 'city',
      label: c.name,
      city: c.name,
      state: c.state,
      lat: c.lat,
      lng: c.lng,
    };
  }

  if (value.startsWith('geo:')) {
    const [latStr, lngStr, ...rest] = value.slice(4).split('|');
    if (rest.length > 0 || !latStr || !lngStr) return null;
    const lat = Number(latStr);
    const lng = Number(lngStr);
    const parsed = homeLocationInputSchema.safeParse({
      kind: 'geo',
      lat,
      lng,
    });
    if (!parsed.success) return null;
    const near = findNearestCity(lat, lng, NEAREST_CITY_MAX_MILES);
    return {
      kind: 'geo',
      label: near ? near.city.name : 'Your area',
      city: near?.city.name,
      state: near?.city.state,
      lat: roundCoordinate(lat),
      lng: roundCoordinate(lng),
    };
  }

  return null;
}

/** Reads the cookie from a browser's document.cookie string. */
export function readHomeLocationFromCookieString(
  cookieString: string,
): HomeLocation | null {
  for (const part of cookieString.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === HOME_LOCATION_COOKIE) {
      return resolveHomeLocation(rest.join('='));
    }
  }
  return null;
}
