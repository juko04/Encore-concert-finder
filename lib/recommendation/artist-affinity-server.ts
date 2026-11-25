import type { SupabaseClient } from '@supabase/supabase-js';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';
import { getActiveSpotifyTopArtistsForUser } from '@/lib/sources/spotify/affinity-service';
import {
  createArtistAffinityResolver,
  type ArtistAffinityResolver,
} from './artist-affinity';

const NONE: ArtistAffinityResolver = () => null;

/**
 * Loads the signed-in user's preferences and Spotify top artists once and returns a resolver.
 * Fail-soft: any load failure yields a resolver that marks nothing (cards just show no "liked").
 */
export async function loadArtistAffinityResolver(
  userId: string | null | undefined,
  client: SupabaseClient,
  catalogRepo: ICatalogRepository,
): Promise<ArtistAffinityResolver> {
  if (!userId) return NONE;
  try {
    const [preferences, spotifyTop] = await Promise.all([
      new SupabaseUserPreferenceRepository(client).getPreferences(userId),
      getActiveSpotifyTopArtistsForUser(userId, 'short_term', {
        catalogRepo,
      }).catch(() => []),
    ]);
    return createArtistAffinityResolver(preferences, spotifyTop);
  } catch (err) {
    console.error('[artist-affinity] could not load user signals:', err);
    return NONE;
  }
}
