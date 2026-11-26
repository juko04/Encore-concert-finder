import type { User } from '@supabase/supabase-js';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import type { UserProfile } from '@/lib/domain/profile';
import { getHomeLocation } from './server';
import type { HomeLocation } from './home-location';
import type { NearScope } from './catalog-search';

import {
  DEFAULT_RADIUS_MILES,
  GUEST_REGION_RADIUS_MILES,
} from './near-context-constants';

export {
  DEFAULT_RADIUS_MILES,
  GUEST_REGION_RADIUS_MILES,
} from './near-context-constants';

export interface NearContext {
  user: User | null;
  profile: UserProfile | null;
  home: HomeLocation | null;
  radiusMiles: number;
  /** Present whenever the viewer has a home location (signed-in profile or the city picker). */
  scope: NearScope | null;
}

/**
 * Derives the radius scope on the server from the SESSION user's profile and home-location
 * cookie (same rules for /search and /api/catalog/search). A signed-in user gets their saved
 * radius (default DEFAULT_RADIUS_MILES); a guest who picked a city gets the wider regional
 * radius used on the home page. Without a home location scope = null: the radius is never
 * applied and the location is never guessed.
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
  } else {
    home = await getHomeLocation();
  }
  const radiusMiles = user
    ? (profile?.defaultRadiusMiles ?? DEFAULT_RADIUS_MILES)
    : GUEST_REGION_RADIUS_MILES;
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
