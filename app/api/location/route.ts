import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import {
  HOME_LOCATION_COOKIE,
  HOME_LOCATION_COOKIE_MAX_AGE_SECONDS,
  homeLocationInputSchema,
  serializeHomeLocation,
} from '@/lib/location/home-location';
import { homeLocationFromProfileCoords } from '@/lib/location/server';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * Restores the signed-in user's saved home location (profile coordinates) so a new
 * browser/device behaves like the one where it was chosen.
 *
 * - The user always comes from the verified session; no user id is accepted from the client.
 * - Returns only the coarse, already-rounded home coordinate saved by the user. No IP lookup and
 *   no default city (AGENTS.md invariant 6).
 * - On success it also sets the same `encore_home_city` cookie the picker writes, so the next
 *   server render uses it without another round trip.
 */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json(
      { location: null, error: 'unauthenticated' },
      { status: 401, headers: NO_STORE },
    );
  }

  let location = null;
  try {
    const profile = await new SupabaseProfileRepository().getProfile(user.id);
    location = homeLocationFromProfileCoords(
      profile?.homeLatApprox,
      profile?.homeLngApprox,
    );
  } catch (err) {
    console.error('[api/location] profile read failed:', err);
    return NextResponse.json(
      { location: null, error: 'profile_unavailable' },
      { status: 500, headers: NO_STORE },
    );
  }

  const response = NextResponse.json({ location }, { headers: NO_STORE });
  const parsed = location
    ? homeLocationInputSchema.safeParse({
        kind: 'geo',
        lat: location.lat,
        lng: location.lng,
      })
    : null;
  const cookieValue = parsed?.success
    ? serializeHomeLocation(parsed.data)
    : null;
  if (cookieValue) {
    response.cookies.set(HOME_LOCATION_COOKIE, cookieValue, {
      path: '/',
      maxAge: HOME_LOCATION_COOKIE_MAX_AGE_SECONDS,
      sameSite: 'lax',
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
    });
  }
  return response;
}
