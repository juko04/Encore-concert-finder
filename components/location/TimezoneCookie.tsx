'use client';

import { useEffect } from 'react';
import {
  TIMEZONE_COOKIE,
  TIMEZONE_COOKIE_MAX_AGE_SECONDS,
  isValidIanaTimeZone,
  readTimeZoneFromCookieString,
} from '@/lib/location/timezone';

/**
 * Invisible. Stores the browser's IANA timezone in the `encore_tz` cookie so the server can
 * decide what "today" means for this viewer. Writes only when the cookie is missing or differs,
 * renders nothing (no hydration output) and never reloads the page; the next navigation or
 * request picks the cookie up. It carries no personal data beyond a timezone name.
 */
export function TimezoneCookie(): null {
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!isValidIanaTimeZone(tz)) return;
      if (readTimeZoneFromCookieString(document.cookie) === tz) return;
      const secure = window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${TIMEZONE_COOKIE}=${encodeURIComponent(tz)}; Path=/; Max-Age=${TIMEZONE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
    } catch {
      // Cookies or Intl unavailable: the server falls back to the home city timezone / UTC.
    }
  }, []);
  return null;
}
