import type { SupabaseClient } from '@supabase/supabase-js';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';
import { getActiveSpotifyTopArtistsForUser } from '@/lib/sources/spotify/affinity-service';
import {
  annotateEventsWithArtistAffinity,
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

/**
 * Marks the signed-in user's liked artists on `events`. Signals are loaded fresh for this
 * call (never cached across requests or users); guests get the events back unannotated.
 */
export async function annotateEventsForUser<T>(
  events: readonly T[],
  userId: string | null | undefined,
  client: SupabaseClient,
  catalogRepo: ICatalogRepository,
): Promise<T[]> {
  if (!userId || events.length === 0) return [...events];
  return annotateEventsWithArtistAffinity(
    events,
    await loadArtistAffinityResolver(userId, client, catalogRepo),
  );
}
