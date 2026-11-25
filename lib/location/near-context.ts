import type { User } from '@supabase/supabase-js';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import type { UserProfile } from '@/lib/domain/profile';
import { getHomeLocation } from './server';
import type { HomeLocation } from './home-location';
import type { NearScope } from './catalog-search';

/** Radius used when the profile has none saved. */
export const DEFAULT_RADIUS_MILES = 25;

export interface NearContext {
  user: User | null;
  profile: UserProfile | null;
  home: HomeLocation | null;
  radiusMiles: number;
  /** Present only for a signed-in user with a resolvable home location. */
  scope: NearScope | null;
}

/**
 * Derives the radius scope on the server from the SESSION user's profile and home-location
 * cookie (same rules for /search and /api/catalog/search). Guests, and users without a home
 * location, get scope = null: the radius is never applied and never guessed.
 */
export async function resolveNearContext(
  knownUser?: User | null,
): Promise<NearContext> {
  const user =
    knownUser !== undefined ? knownUser : await getAuthenticatedUser();
  let profile: UserProfile | null = null;
  let home: HomeLocation | null = null;
  if (user) {
    try {
      profile = await new SupabaseProfileRepository().getProfile(user.id);
    } catch (err) {
      console.error('[near-context] profile load failed:', err);
    }
    home = await getHomeLocation(user.id);
  }
  const radiusMiles = profile?.defaultRadiusMiles ?? DEFAULT_RADIUS_MILES;
  return {
    user,
    profile,
    home,
    radiusMiles,
    scope: home
      ? { home: { lat: home.lat, lng: home.lng }, radiusMiles }
      : null,
  };
}
