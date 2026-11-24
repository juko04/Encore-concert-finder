'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import {
  HOME_LOCATION_COOKIE,
  HOME_LOCATION_COOKIE_MAX_AGE_SECONDS,
  homeLocationInputSchema,
  resolveHomeLocation,
  roundCoordinate,
  serializeHomeLocation,
} from '@/lib/location/home-location';

export type SaveHomeLocationResult =
  | { ok: true; label: string; savedToProfile: boolean }
  | { ok: false; error: string };

/**
 * Saves the user's home location. The input is validated on the server; the
 * signed-in user is always taken from the session, never from the client.
 * No IP lookup and no external service is involved.
 */
export async function saveHomeLocationAction(
  input: unknown,
): Promise<SaveHomeLocationResult> {
  const parsed = homeLocationInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'That location could not be understood.' };
  }

  const value = serializeHomeLocation(parsed.data);
  const location = resolveHomeLocation(value);
  if (!value || !location) {
    return { ok: false, error: 'Unknown city.' };
  }

  const store = await cookies();
  store.set(HOME_LOCATION_COOKIE, value, {
    path: '/',
    maxAge: HOME_LOCATION_COOKIE_MAX_AGE_SECONDS,
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
  });

  let savedToProfile = false;
  const user = await getAuthenticatedUser();
  if (user) {
    try {
      await new SupabaseProfileRepository().upsertProfile(user.id, {
        homeLatApprox: roundCoordinate(location.lat),
        homeLngApprox: roundCoordinate(location.lng),
      });
      savedToProfile = true;
    } catch (err) {
      // The cookie already works for this browser; do not fail the action.
      console.error('[saveHomeLocationAction] profile save failed:', err);
    }
  }

  revalidatePath('/', 'layout');
  return { ok: true, label: location.label, savedToProfile };
}

/** Clears the cookie and, for signed-in users, the stored approximate home. */
export async function clearHomeLocationAction(): Promise<{ ok: boolean }> {
  const store = await cookies();
  store.delete(HOME_LOCATION_COOKIE);

  const user = await getAuthenticatedUser();
  if (user) {
    try {
      await new SupabaseProfileRepository().upsertProfile(user.id, {
        homeLatApprox: null,
        homeLngApprox: null,
      });
    } catch (err) {
      console.error('[clearHomeLocationAction] profile clear failed:', err);
    }
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}
