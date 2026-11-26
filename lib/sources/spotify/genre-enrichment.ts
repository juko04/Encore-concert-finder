/**
 * Fills in genres for the user's Spotify top artists.
 *
 * Spotify no longer returns artist genres to this app, so the genre taste profile (which drives
 * "you probably like electronic" inference) would be empty. Genres are taken, in order, from:
 *   1. the canonical catalog artist the Spotify artist was matched to (verified id match);
 *   2. a conservative Ticketmaster attraction lookup by exact name (top-ranked artists only,
 *      bounded and cached).
 * Genres are never guessed: an artist with no source genres stays genre-less. Mutates the
 * provided (already in-memory, cached) artist objects only; nothing is written to Spotify data.
 */

import type { SpotifyTopArtist } from '@/lib/domain/spotify';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';

declare module '@/lib/domain/spotify' {
  interface SpotifyTopArtist {
    /** Where `genres` came from when Spotify supplied none. */
    genresSource?: 'catalog' | 'ticketmaster';
  }
}

export type GenreLookupFn = (artistName: string) => Promise<string[] | null>;

export interface EnrichGenresOptions {
  catalogRepo?: Pick<ICatalogRepository, 'getArtistsByIds'>;
  lookup?: GenreLookupFn;
  /** Max name lookups per call (top-ranked artists without genres first). */
  maxLookups?: number;
  /** Parallel lookups (the Ticketmaster client also rate-limits). */
  concurrency?: number;
}

export async function enrichSpotifyArtistGenres(
  artists: SpotifyTopArtist[],
  options: EnrichGenresOptions = {},
): Promise<{ fromCatalog: number; fromLookup: number }> {
  const stats = { fromCatalog: 0, fromLookup: 0 };
  const needs = (a: SpotifyTopArtist) => !a.genres || a.genres.length === 0;

  // 1. Catalog genres for verified canonical matches.
  const canonicalIds = artists
    .filter((a) => needs(a) && a.canonicalArtistId)
    .map((a) => a.canonicalArtistId as string);
  if (canonicalIds.length > 0 && options.catalogRepo) {
    try {
      const rows = await options.catalogRepo.getArtistsByIds(canonicalIds);
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const a of artists) {
        if (!needs(a) || !a.canonicalArtistId) continue;
        const genres = byId.get(a.canonicalArtistId)?.genres;
        if (Array.isArray(genres) && genres.length > 0) {
          a.genres = [...genres];
          a.genresSource = 'catalog';
          stats.fromCatalog++;
        }
      }
    } catch {
      // Fail closed: leave genres unknown.
    }
  }

  // 2. Exact-name Ticketmaster lookup for the best-ranked artists still without genres.
  if (options.lookup) {
    const lookup = options.lookup;
    const queue = artists
      .filter(needs)
      .sort((x, y) => x.rank - y.rank)
      .slice(0, options.maxLookups ?? 25);
    const workers = Math.max(1, options.concurrency ?? 4);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(workers, queue.length) }, async () => {
        while (next < queue.length) {
          const artist = queue[next++];
          try {
            const genres = await lookup(artist.name);
            if (genres && genres.length > 0) {
              artist.genres = [...genres];
              artist.genresSource = 'ticketmaster';
              stats.fromLookup++;
            }
          } catch {
            // unknown
          }
        }
      }),
    );
  }

  return stats;
}
