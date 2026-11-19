import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSpotifyAffinityCache,
  getSpotifyAffinityCacheSize,
  _setAffinityCacheForTesting,
  _setLastKnownGoodForTesting,
  calculateArtistTrend,
  calculateUnifiedAffinityScore,
  syncSpotifyTopArtistsAcrossTimeRanges,
  getActiveSpotifyTopArtistsForUser,
} from '@/lib/sources/spotify/affinity-service';
import type { SpotifyTopArtist } from '@/lib/domain/spotify';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';

describe('SpotifyAffinityService - In-Memory Cache Management', () => {
  beforeEach(() => {
    clearSpotifyAffinityCache();
  });

  it('starts with an empty cache after clearSpotifyAffinityCache()', () => {
    expect(getSpotifyAffinityCacheSize()).toBe(0);
  });

  it('invalidates all time-range entries for a specified user while preserving other users', () => {
    const userA = 'user-alpha-123';
    const userB = 'user-beta-456';

    _setAffinityCacheForTesting(userA, 'short_term', []);
    _setAffinityCacheForTesting(userA, 'medium_term', []);
    _setAffinityCacheForTesting(userA, 'long_term', []);
    _setAffinityCacheForTesting(userA, 'consolidated', []);
    _setAffinityCacheForTesting(userB, 'short_term', []);
    _setAffinityCacheForTesting(userB, 'long_term', []);

    expect(getSpotifyAffinityCacheSize()).toBe(6);

    // Clear userA only
    clearSpotifyAffinityCache(userA);

    // userA entries (short, medium, long, consolidated) must all be removed, userB must remain
    expect(getSpotifyAffinityCacheSize()).toBe(2);

    // Clearing userA again is idempotent
    clearSpotifyAffinityCache(userA);
    expect(getSpotifyAffinityCacheSize()).toBe(2);

    // Clearing without arguments flushes everything
    clearSpotifyAffinityCache();
    expect(getSpotifyAffinityCacheSize()).toBe(0);
  });
});

describe('SpotifyAffinityService - Trend & Composite Score Calculations', () => {
  it('identifies rising trend for newly charted artist or surging short-term rank', () => {
    // Newly charted in short-term (#1) but not in long-term
    expect(
      calculateArtistTrend({
        short_term: 1,
        medium_term: 4,
        long_term: undefined,
      }),
    ).toBe('rising');

    // Surging short-term rank vs medium (#3 vs #9)
    expect(
      calculateArtistTrend({ short_term: 3, medium_term: 9, long_term: 12 }),
    ).toBe('rising');
  });

  it('identifies consistent trend for stable placement across windows', () => {
    // Steady placement across all horizons
    expect(
      calculateArtistTrend({ short_term: 2, medium_term: 2, long_term: 2 }),
    ).toBe('consistent');

    // Minor fluctuation within threshold
    expect(
      calculateArtistTrend({ short_term: 4, medium_term: 5, long_term: 3 }),
    ).toBe('consistent');
  });

  it('identifies fading trend when absent from recent listening or sharply declining', () => {
    // Absent from short-term but present in long-term
    expect(
      calculateArtistTrend({
        short_term: undefined,
        medium_term: 8,
        long_term: 3,
      }),
    ).toBe('fading');

    // Dropped significantly in short-term (#25) vs long-term staple (#2)
    expect(
      calculateArtistTrend({ short_term: 25, medium_term: 10, long_term: 2 }),
    ).toBe('fading');
  });

  it('calculates unified score applying 60/30/10 recency weights', () => {
    // Rank 1 across all 3 windows: (100 * 0.6) + (100 * 0.3) + (100 * 0.1) = 100
    const perfectScore = calculateUnifiedAffinityScore({
      short_term: 1,
      medium_term: 1,
      long_term: 1,
    });
    expect(perfectScore).toBe(100);

    // Short-term only (#1): 100 * 0.6 = 60
    const shortOnlyScore = calculateUnifiedAffinityScore({
      short_term: 1,
      medium_term: undefined,
      long_term: undefined,
    });
    expect(shortOnlyScore).toBe(60);

    // Unranked everywhere: 0
    expect(calculateUnifiedAffinityScore({})).toBe(0);
  });
});

describe('SpotifyAffinityService - Fail-Closed & Cache Resilience', () => {
  beforeEach(() => {
    clearSpotifyAffinityCache();
  });

  it('returns empty array when userId is invalid or empty without throwing', async () => {
    expect(await syncSpotifyTopArtistsAcrossTimeRanges('')).toEqual([]);
    // @ts-expect-error test null input
    expect(await syncSpotifyTopArtistsAcrossTimeRanges(null)).toEqual([]);
    expect(await getActiveSpotifyTopArtistsForUser('')).toEqual([]);
  });

  it('returns last-known-good cached data when external sync fails (fail-closed invariant)', async () => {
    const userId = 'user-test-fail-closed';
    const fixtureArtists: SpotifyTopArtist[] = [
      {
        id: 'spotify-artist-last-known',
        name: 'Last Known Artist',
        rank: 1,
        imageUrl: null,
        spotifyUrl: 'https://open.spotify.com/artist/spotify-artist-last-known',
        genres: ['indie'],
        popularity: 80,
        trend: 'consistent',
        timeRange: 'short_term',
      },
    ];

    // Seed last-known-good
    _setLastKnownGoodForTesting(userId, fixtureArtists);

    // Attempt sync in unconfigured test environment (no DB / Spotify env)
    // Invariant: Must return last-known-good without crashing
    const result = await syncSpotifyTopArtistsAcrossTimeRanges(userId);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('spotify-artist-last-known');
    expect(result[0].name).toBe('Last Known Artist');
  });

  it('returns in-memory cached entries immediately for getActiveSpotifyTopArtistsForUser', async () => {
    const userId = 'user-test-cached';
    const cachedList: SpotifyTopArtist[] = [
      {
        id: 'spotify-cached-1',
        name: 'Cached Artist',
        rank: 1,
        imageUrl: null,
        spotifyUrl: 'https://open.spotify.com/artist/spotify-cached-1',
        genres: ['rock'],
        popularity: 75,
        trend: 'rising',
        timeRange: 'short_term',
      },
    ];

    _setAffinityCacheForTesting(userId, 'short_term', cachedList);

    const result = await getActiveSpotifyTopArtistsForUser(
      userId,
      'short_term',
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('spotify-cached-1');
  });
});
