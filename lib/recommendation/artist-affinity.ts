/**
 * Per-artist "do I like this act?" annotation for lineup lines ("with A, B, C").
 *
 * Reuses the scoring engine's artist factor for each artist on its own, so a lineup line can never
 * disagree with the match score: explicit preferences (favorite / like / interested) always take
 * precedence over inferred Spotify listening, and matching is by canonical artist id or Spotify id
 * only (never by name). Disliked and unmarked artists get no affinity.
 */

import type { UserArtistPreference } from '@/lib/domain/user-preference';
import type { SpotifyTopArtist } from '@/lib/domain/spotify';
import { calculateArtistInterestFactor } from './factors/artist-interest';

export type ArtistAffinityLevel =
  'favorite' | 'like' | 'interested' | 'spotify';

export interface ArtistAffinity {
  /** 0..100, the same value the match score uses for this artist. */
  score: number;
  level: ArtistAffinityLevel;
  /** Spotify rank (1 = most listened) when the signal is Spotify listening. */
  spotifyRank?: number;
}

export interface AffinityArtistInput {
  id?: string | null;
  name: string;
  spotifyArtistId?: string | null;
}

export type ArtistAffinityResolver = (
  artist: AffinityArtistInput,
) => ArtistAffinity | null;

export function createArtistAffinityResolver(
  preferences: UserArtistPreference[],
  spotifyTopArtists: SpotifyTopArtist[] = [],
): ArtistAffinityResolver {
  if (preferences.length === 0 && spotifyTopArtists.length === 0) {
    return () => null;
  }
  const cache = new Map<string, ArtistAffinity | null>();
  return (artist) => {
    const key = `${artist.id ?? ''}|${artist.spotifyArtistId ?? ''}`;
    if (key !== '|' && cache.has(key)) return cache.get(key) ?? null;
    const result = calculateArtistInterestFactor(
      [{ ...artist, billingPosition: 'support' }],
      preferences,
      spotifyTopArtists,
    );
    const m = result.matchedArtist;
    let affinity: ArtistAffinity | null = null;
    if (m && !m.isDisliked && m.preferenceLevel !== 'dislike') {
      affinity = {
        score: m.score,
        level: m.isSpotifyAffinity
          ? 'spotify'
          : (m.preferenceLevel as ArtistAffinityLevel),
        ...(m.spotifyRank !== undefined ? { spotifyRank: m.spotifyRank } : {}),
      };
    }
    // Name-only artists (no ids) cannot match anything; do not cache the empty key.
    if (key !== '|') cache.set(key, affinity);
    return affinity;
  };
}

/** Highest affinity first; unrated artists keep their original relative order after rated ones. */
export function sortArtistsByAffinity<
  T extends { affinity?: ArtistAffinity | null },
>(artists: readonly T[]): T[] {
  return artists
    .map((a, i) => ({ a, i }))
    .sort(
      (x, y) =>
        (y.a.affinity?.score ?? -1) - (x.a.affinity?.score ?? -1) || x.i - y.i,
    )
    .map((x) => x.a);
}

type WithArtists = {
  artists?: Array<AffinityArtistInput & { affinity?: ArtistAffinity | null }>;
};

function annotateArtists<T extends WithArtists>(
  event: T,
  resolver: ArtistAffinityResolver,
): T {
  if (!event.artists || event.artists.length === 0) return event;
  return {
    ...event,
    artists: event.artists.map((a) => {
      const affinity = resolver(a);
      if (affinity) return { ...a, affinity };
      if ('affinity' in a) {
        const rest = { ...a };
        delete rest.affinity;
        return rest;
      }
      return a;
    }),
  };
}

/** Annotates a CanonicalEventSummary, or a ScoredEvent (its `.event`), without mutating. */
export function annotateEventWithArtistAffinity<T>(
  event: T,
  resolver: ArtistAffinityResolver,
): T {
  if (!event || typeof event !== 'object') return event;
  const e = event as unknown as WithArtists & { event?: WithArtists };
  if (e.event && typeof e.event === 'object' && 'artists' in e.event) {
    return {
      ...e,
      event: annotateArtists(e.event, resolver),
    } as unknown as T;
  }
  return annotateArtists(e, resolver) as unknown as T;
}

export function annotateEventsWithArtistAffinity<T>(
  events: readonly T[],
  resolver: ArtistAffinityResolver,
): T[] {
  return events.map((e) => annotateEventWithArtistAffinity(e, resolver));
}
