/**
 * Server-side Spotify Listening Affinity Service
 *
 * Retrieves, consolidates, and caches the authenticated user's Spotify top artists
 * across short-term, medium-term, and long-term listening windows.
 *
 * Invariants:
 * 1. Read-only listening signals: never mutates user_artist_preferences.
 * 2. Fail-closed: network, auth, or token failures gracefully return last-known-good
 *    or [] without crashing Discover or recommendation scoring.
 * 3. Short TTL in-memory caching: prevents repeated external API calls per user session.
 * 4. Conservative Entity Resolution: Matches strictly via external IDs or single exact normalized name.
 */

import { getServerEnv } from '@/lib/env/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { SpotifyApiClient } from './client';
import type { SpotifyTimeRange, SpotifyTopArtist } from '@/lib/domain/spotify';
import {
  SpotifyAuthenticationError,
  VALID_SPOTIFY_TIME_RANGES,
} from '@/lib/domain/spotify';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';
import {
  SpotifyArtistMatcher,
  type SpotifyArtistCandidate,
} from '@/lib/entity-resolution/spotify-artist-matcher';

declare module '@/lib/domain/spotify' {
  interface SpotifyTopArtist {
    canonicalArtistId?: string | null;
    ranksByRange?: Partial<Record<SpotifyTimeRange, number>>;
    syncedAt?: string;
  }
}

interface CachedAffinities {
  timestamp: number;
  artists: SpotifyTopArtist[];
}

const affinityCache = new Map<string, CachedAffinities>();
const lastKnownGoodCache = new Map<string, SpotifyTopArtist[]>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Invalidates cached affinities. If a userId is passed, all cache keys
 * for that user across all time ranges, consolidated lists, and last-known-good
 * entries are purged. If no userId is passed, clears the entire cache.
 */
export function clearSpotifyAffinityCache(userId?: string): void {
  if (userId) {
    for (const key of affinityCache.keys()) {
      if (
        key === userId ||
        key.startsWith(`${userId}:`) ||
        key.startsWith(`${userId}_`)
      ) {
        affinityCache.delete(key);
      }
    }
    lastKnownGoodCache.delete(userId);
  } else {
    affinityCache.clear();
    lastKnownGoodCache.clear();
  }
}

export function getSpotifyAffinityCacheSize(): number {
  return affinityCache.size;
}

/**
 * Test-only utility to populate in-memory affinity cache entries.
 */
export function _setAffinityCacheForTesting(
  userId: string,
  timeRange: SpotifyTimeRange | 'consolidated',
  artists: SpotifyTopArtist[] = [],
): void {
  affinityCache.set(`${userId}:${timeRange}`, {
    timestamp: Date.now(),
    artists,
  });
}

/**
 * Test-only utility to seed last-known-good cache directly.
 */
export function _setLastKnownGoodForTesting(
  userId: string,
  artists: SpotifyTopArtist[] = [],
): void {
  lastKnownGoodCache.set(userId, artists);
}

/**
 * Calculates listening momentum trend across short-, medium-, and long-term horizons.
 * - 'rising': high short-term momentum relative to historical baseline or newly charted.
 * - 'fading': historical staple declining in recent 4-week listening.
 * - 'consistent': steady top listening rotation across horizons.
 */
export function calculateArtistTrend(ranks: {
  short_term?: number;
  medium_term?: number;
  long_term?: number;
}): 'rising' | 'consistent' | 'fading' {
  const s = ranks.short_term;
  const m = ranks.medium_term;
  const l = ranks.long_term;

  // Present in short term but absent from long term -> newly charted / rising
  if (s !== undefined && l === undefined) {
    if (m === undefined || s <= m) {
      return 'rising';
    }
  }

  // Noticeably better rank in short term vs medium or long term
  if (s !== undefined) {
    if ((m !== undefined && s <= m - 2) || (l !== undefined && s <= l - 3)) {
      return 'rising';
    }
  }

  // Absent from short term but present in medium or long term -> fading
  if (s === undefined && (m !== undefined || l !== undefined)) {
    return 'fading';
  }

  // Noticeably worse rank in short term vs medium or long term
  if (s !== undefined) {
    if ((m !== undefined && s >= m + 3) || (l !== undefined && s >= l + 4)) {
      return 'fading';
    }
  }

  return 'consistent';
}

/**
 * Calculates a unified composite affinity score across listening windows.
 * Hypothesis weights: 60% short-term, 30% medium-term, 10% long-term.
 * Rank 1 = 100 points down to Rank 50 = 2 points. Unranked in window = 0 points.
 */
export function calculateUnifiedAffinityScore(ranks: {
  short_term?: number;
  medium_term?: number;
  long_term?: number;
}): number {
  const scoreForRank = (r?: number): number => {
    if (r === undefined || r === null || r < 1) return 0;
    return Math.max(0, 102 - r * 2);
  };

  const sScore = scoreForRank(ranks.short_term);
  const mScore = scoreForRank(ranks.medium_term);
  const lScore = scoreForRank(ranks.long_term);

  return sScore * 0.6 + mScore * 0.3 + lScore * 0.1;
}

export interface SyncSpotifyOptions {
  catalogRepo?: ICatalogRepository;
  allowEnrichment?: boolean;
}

/**
 * Synchronizes Spotify top artists across all three time horizons (short_term, medium_term, long_term),
 * deduplicates across ranges, calculates trends, and optionally resolves/enriches canonical artist IDs.
 *
 * Invariants:
 * 1. Safe fail-closed: on network, auth, or rate-limit errors, returns last-known-good or empty array without throwing.
 * 2. Conservative entity resolution: never resolves by loose name matching alone.
 * 3. Atomic cache invalidation and refreshment with short TTL.
 */
export async function syncSpotifyTopArtistsAcrossTimeRanges(
  userId: string,
  options?: SyncSpotifyOptions,
): Promise<SpotifyTopArtist[]> {
  if (!userId || typeof userId !== 'string') return [];

  let serverEnv;
  try {
    serverEnv = getServerEnv();
  } catch {
    return lastKnownGoodCache.get(userId) ?? [];
  }

  if (
    !serverEnv ||
    !serverEnv.ENABLE_SPOTIFY_INTEGRATION ||
    !serverEnv.SPOTIFY_CLIENT_ID ||
    !serverEnv.SPOTIFY_CLIENT_SECRET ||
    !serverEnv.SPOTIFY_REDIRECT_URI ||
    !serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY
  ) {
    return lastKnownGoodCache.get(userId) ?? [];
  }

  try {
    const adminClient = createAdminClient();
    const repo = new SupabaseSpotifyConnectionRepository(
      adminClient,
      serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY,
    );

    const tokens = await repo.getConnectionTokens(userId);
    if (!tokens) {
      return lastKnownGoodCache.get(userId) ?? [];
    }

    if (tokens.reauthorizationDeadline.getTime() <= Date.now()) {
      await repo.updateStatus(userId, 'expired').catch(() => {});
      return lastKnownGoodCache.get(userId) ?? [];
    }

    const spotifyClient = new SpotifyApiClient({
      clientId: serverEnv.SPOTIFY_CLIENT_ID,
      clientSecret: serverEnv.SPOTIFY_CLIENT_SECRET,
      redirectUri: serverEnv.SPOTIFY_REDIRECT_URI,
    });

    let currentAccessToken = tokens.accessToken;

    // Refresh if expiring within 60s
    if (tokens.tokenExpiresAt.getTime() <= Date.now() + 60 * 1000) {
      try {
        const refreshed = await spotifyClient.refreshAccessToken(
          tokens.refreshToken,
        );
        currentAccessToken = refreshed.accessToken;
        await repo.updateTokens(userId, {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          tokenExpiresAt: refreshed.tokenExpiresAt,
        });
      } catch (refreshErr) {
        if (refreshErr instanceof SpotifyAuthenticationError) {
          await repo.updateStatus(userId, 'expired').catch(() => {});
        }
        return lastKnownGoodCache.get(userId) ?? [];
      }
    }

    // Fetch across all 3 time ranges in parallel with fault tolerance
    const results = await Promise.allSettled(
      VALID_SPOTIFY_TIME_RANGES.map((range) =>
        spotifyClient.getTopArtists(currentAccessToken, range),
      ),
    );

    const rangeArtists: Partial<Record<SpotifyTimeRange, SpotifyTopArtist[]>> =
      {};
    let successfulFetches = 0;

    VALID_SPOTIFY_TIME_RANGES.forEach((range, idx) => {
      const res = results[idx];
      if (res.status === 'fulfilled') {
        rangeArtists[range] = res.value;
        successfulFetches++;
        // Cache individual range response
        affinityCache.set(`${userId}:${range}`, {
          timestamp: Date.now(),
          artists: res.value,
        });
      }
    });

    if (successfulFetches === 0) {
      return lastKnownGoodCache.get(userId) ?? [];
    }

    // Record successful sync timestamp in repository
    await repo.recordSync(userId).catch(() => {});
    const syncedAt = new Date().toISOString();

    // Deduplicate across all time ranges
    interface ArtistAccumulator {
      artist: SpotifyTopArtist;
      ranks: Partial<Record<SpotifyTimeRange, number>>;
    }
    const artistMap = new Map<string, ArtistAccumulator>();

    for (const range of VALID_SPOTIFY_TIME_RANGES) {
      const list = rangeArtists[range] || [];
      for (const item of list) {
        if (!artistMap.has(item.id)) {
          artistMap.set(item.id, {
            artist: { ...item, syncedAt },
            ranks: { [range]: item.rank },
          });
        } else {
          const acc = artistMap.get(item.id)!;
          acc.ranks[range] = item.rank;
          // Keep highest popularity and valid image
          if (item.popularity > acc.artist.popularity) {
            acc.artist.popularity = item.popularity;
          }
          if (!acc.artist.imageUrl && item.imageUrl) {
            acc.artist.imageUrl = item.imageUrl;
          }
        }
      }
    }

    // Score and trend each unique artist
    const consolidatedArtists: SpotifyTopArtist[] = Array.from(
      artistMap.values(),
    ).map(({ artist, ranks }) => {
      const trend = calculateArtistTrend(ranks);
      const unifiedScore = calculateUnifiedAffinityScore(ranks);
      return {
        ...artist,
        trend,
        ranksByRange: ranks,
        timeRange: ranks.short_term ? 'short_term' : 'medium_term',
        _unifiedScore: unifiedScore,
      } as SpotifyTopArtist & { _unifiedScore: number };
    });

    // Sort by unifiedScore descending, popularity descending, name
    (
      consolidatedArtists as Array<SpotifyTopArtist & { _unifiedScore: number }>
    ).sort((a, b) => {
      if (b._unifiedScore !== a._unifiedScore) {
        return b._unifiedScore - a._unifiedScore;
      }
      if (b.popularity !== a.popularity) {
        return b.popularity - a.popularity;
      }
      return a.name.localeCompare(b.name);
    });

    // Re-assign ranks 1..N based on unified score
    consolidatedArtists.forEach((a, idx) => {
      a.rank = idx + 1;
      delete (a as unknown as { _unifiedScore?: number })._unifiedScore;
    });

    // Entity Resolution & External ID Enrichment
    if (options?.catalogRepo) {
      await resolveAndEnrichSpotifyArtists(
        consolidatedArtists,
        options.catalogRepo,
        options.allowEnrichment !== false,
      );
    }

    // Cache consolidated top artists
    affinityCache.set(`${userId}:consolidated`, {
      timestamp: Date.now(),
      artists: consolidatedArtists,
    });
    affinityCache.set(`${userId}:short_term`, {
      timestamp: Date.now(),
      artists: consolidatedArtists,
    });
    affinityCache.set(userId, {
      timestamp: Date.now(),
      artists: consolidatedArtists,
    });
    lastKnownGoodCache.set(userId, consolidatedArtists);

    return consolidatedArtists;
  } catch (err) {
    console.warn(
      `[SpotifyAffinityService] Sync across time ranges failed for user ${userId}:`,
      err,
    );
    return lastKnownGoodCache.get(userId) ?? [];
  }
}

/**
 * Resolves Spotify artists to canonical Encore artist IDs and enriches catalog external IDs.
 * Uses SpotifyArtistMatcher from @/lib/entity-resolution/spotify-artist-matcher.
 */
async function resolveAndEnrichSpotifyArtists(
  artists: SpotifyTopArtist[],
  catalogRepo: ICatalogRepository,
  allowEnrichment: boolean,
): Promise<void> {
  if (!artists || artists.length === 0) return;

  try {
    const matcher = new SpotifyArtistMatcher(catalogRepo, { allowEnrichment });
    const candidates: SpotifyArtistCandidate[] = artists.map((a) => ({
      id: a.id,
      name: a.name,
      spotifyUrl: a.spotifyUrl,
    }));
    const report = await matcher.matchBatch(candidates);
    const idMap = new Map<string, string>();
    for (const m of report.matched) {
      idMap.set(m.spotifyId, m.artistId);
    }
    for (const a of artists) {
      if (idMap.has(a.id)) {
        a.canonicalArtistId = idMap.get(a.id);
      }
    }
  } catch (err) {
    console.warn(
      '[SpotifyAffinityService] SpotifyArtistMatcher resolution encountered error:',
      err,
    );
  }
}

/**
 * Retrieves cached or active Spotify top artists for recommendation scoring.
 * Checks memory cache first; falls back to full multi-range sync or last-known-good on failure.
 */
export async function getActiveSpotifyTopArtistsForUser(
  userId: string,
  timeRange: SpotifyTimeRange = 'short_term',
  options?: SyncSpotifyOptions,
): Promise<SpotifyTopArtist[]> {
  if (!userId || typeof userId !== 'string') return [];

  // 1. Check in-memory cache for specific range or consolidated
  const cacheKey = `${userId}:${timeRange}`;
  const cached =
    affinityCache.get(cacheKey) || affinityCache.get(`${userId}:consolidated`);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.artists;
  }

  // 2. Perform synchronized fetch across ranges to build rich composite profile
  try {
    const synced = await syncSpotifyTopArtistsAcrossTimeRanges(userId, options);
    if (synced.length > 0) {
      return synced;
    }
  } catch {
    // Fail closed
  }

  return lastKnownGoodCache.get(userId) ?? [];
}
