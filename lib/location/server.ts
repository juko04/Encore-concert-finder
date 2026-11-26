import { cookies } from 'next/headers';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import {
  HOME_LOCATION_COOKIE,
  homeLocationInputSchema,
  resolveHomeLocation,
  serializeHomeLocation,
  type HomeLocation,
} from './home-location';
import {
  FALLBACK_TIMEZONE,
  TIMEZONE_COOKIE,
  parseTimeZoneCookie,
  resolveViewerTimeZone,
} from './timezone';

/**
 * Converts a stored profile coordinate into a HomeLocation (nearest known city
 * label, or "Your area"). Returns null for missing or invalid coordinates.
 * Pure and exported for tests.
 */
export function homeLocationFromProfileCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
): HomeLocation | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const parsed = homeLocationInputSchema.safeParse({ kind: 'geo', lat, lng });
  if (!parsed.success) return null;
  return resolveHomeLocation(serializeHomeLocation(parsed.data));
}

/**
 * Server-side read of the user's home location. Cookie first; for a signed-in
 * user with no (valid) cookie it falls back to the saved profile coordinate so
 * a new device behaves like the old one.
 *
 * The user is ALWAYS taken from the session. `userId` is only an optimisation
 * for callers that already authenticated; it must come from the session, never
 * from client input, and is ignored if it does not match the session user.
 * Never throws; no IP lookup and no default city (AGENTS.md invariant 6).
 */
export async function getHomeLocation(
  userId?: string,
): Promise<HomeLocation | null> {
  try {
    const store = await cookies();
    const fromCookie = resolveHomeLocation(
      store.get(HOME_LOCATION_COOKIE)?.value,
    );
    if (fromCookie) return fromCookie;
  } catch {
    // fall through to the profile
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) return null;
    if (userId && userId !== user.id) return null;
    const profile = await new SupabaseProfileRepository().getProfile(user.id);
    return homeLocationFromProfileCoords(
      profile?.homeLatApprox,
      profile?.homeLngApprox,
    );
  } catch {
    return null;
  }
}

/**
 * The viewer's timezone on the server: `encore_tz` cookie, else the timezone of the home city
 * (home-location cookie, then `homeFallback` such as the signed-in profile's home), else UTC.
 * Never throws and makes no network call; safe outside a request scope (returns 'UTC').
 */
export async function getViewerTimeZone(
  homeFallback?: HomeLocation | null,
): Promise<string> {
  try {
    const store = await cookies();
    return resolveViewerTimeZone({
      cookieValue: store.get(TIMEZONE_COOKIE)?.value,
      home:
        resolveHomeLocation(store.get(HOME_LOCATION_COOKIE)?.value) ??
        homeFallback ??
        null,
    });
  } catch {
    return resolveViewerTimeZone({ home: homeFallback ?? null });
  }
}

export { FALLBACK_TIMEZONE, parseTimeZoneCookie };
