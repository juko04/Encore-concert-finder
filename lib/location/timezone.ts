/**
 * Viewer timezone resolution (pure, safe on client and server).
 *
 * "Today", "this weekend" and "next 7 days" are decided in the VIEWER's timezone, never a
 * hardcoded region (AGENTS.md invariant 6). Resolution order:
 *   1. the validated `encore_tz` cookie (set by TimezoneCookie from the browser's Intl zone),
 *   2. the timezone of the user's home city,
 *   3. 'UTC'.
 * Events keep using their own venue timezone for event-local dates.
 */

import { findCityByName } from './cities';
import type { HomeLocation } from './home-location';

export const TIMEZONE_COOKIE = 'encore_tz';
export const TIMEZONE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export const FALLBACK_TIMEZONE = 'UTC';

// IANA names are Area/Location[/Sub] plus UTC/GMT style singletons. This keeps garbage (and
// Intl-accepted offsets such as "+01:00") out of the cookie.
const IANA_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

/** True when `value` is a usable IANA timezone name (validated with Intl, never trusted raw). */
export function isValidIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const tz = value.trim();
  if (tz.length === 0 || tz.length > 64 || !IANA_SHAPE.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Timezone of the home city (from the city table), or null when the home has no known city. */
export function timeZoneForHome(
  home: Pick<HomeLocation, 'city' | 'state'> | null | undefined,
): string | null {
  if (!home?.city) return null;
  return findCityByName(home.city, home.state ?? null)?.timezone ?? null;
}

/** Cookie value -> timezone, or null when missing/invalid. */
export function parseTimeZoneCookie(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  value = value.trim();
  return isValidIanaTimeZone(value) ? value : null;
}

/** Reads the cookie from a browser document.cookie string. */
export function readTimeZoneFromCookieString(
  cookieString: string,
): string | null {
  for (const part of cookieString.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === TIMEZONE_COOKIE) return parseTimeZoneCookie(rest.join('='));
  }
  return null;
}

/** cookie -> home city timezone -> UTC. */
export function resolveViewerTimeZone(input: {
  cookieValue?: string | null;
  home?: Pick<HomeLocation, 'city' | 'state'> | null;
}): string {
  return (
    parseTimeZoneCookie(input.cookieValue) ??
    timeZoneForHome(input.home) ??
    FALLBACK_TIMEZONE
  );
}
