/**
 * Genre lookup for a named performer via the Ticketmaster Discovery "attractions" endpoint.
 *
 * Why: Spotify no longer returns artist genres to this app, and many artists a user listens to
 * have no upcoming show in our catalog. Ticketmaster's own classification (genre / sub-genre) is
 * the genre source we already hold the key for.
 *
 * Conservative by design (AGENTS.md invariant 5): a result is only used when the attraction's
 * normalized name EQUALS the requested artist name. Anything ambiguous returns null (unknown),
 * never a guess. Results (including "unknown") are cached in memory.
 */

import { normalizeName } from '@/lib/domain/value-objects';
import { TicketmasterApiClient } from './client';
import { extractTicketmasterGenres } from './listing-filters';
import type { TicketmasterClassification } from './types';

export type GenreLookup = (artistName: string) => Promise<string[] | null>;

interface CacheEntry {
  at: number;
  genres: string[] | null;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export function clearTicketmasterGenreLookupCache(): void {
  cache.clear();
}

interface AttractionsResponse {
  _embedded?: {
    attractions?: Array<{
      name?: string;
      classifications?: TicketmasterClassification[];
    }>;
  };
}

export function createTicketmasterGenreLookup(options: {
  apiKey: string;
  client?: TicketmasterApiClient;
  now?: () => number;
}): GenreLookup {
  const client =
    options.client ?? new TicketmasterApiClient({ apiKey: options.apiKey });
  const now = options.now ?? Date.now;

  return async (artistName: string) => {
    const key = normalizeName(artistName);
    if (!key) return null;
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.genres;

    let genres: string[] | null = null;
    try {
      const url = new URL(
        'https://app.ticketmaster.com/discovery/v2/attractions.json',
      );
      url.searchParams.set('apikey', options.apiKey.trim());
      url.searchParams.set('keyword', artistName.trim());
      url.searchParams.set('classificationName', 'music');
      url.searchParams.set('size', '5');
      const res = await client.request(url);
      if (res.ok) {
        const json = (await res.json()) as AttractionsResponse;
        const match = (json._embedded?.attractions ?? []).find(
          (a) => a.name && normalizeName(a.name) === key,
        );
        const found = match
          ? extractTicketmasterGenres(match.classifications)
          : [];
        genres = found.length > 0 ? found : null;
      }
    } catch {
      // Network/quota failures are "unknown", not an error for the caller. Not cached, so a
      // later request can retry.
      return null;
    }
    cache.set(key, { at: now(), genres });
    return genres;
  };
}
