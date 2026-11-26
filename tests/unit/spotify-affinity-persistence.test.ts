import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn().mockReturnValue({}),
}));

const stored: { rows: import('@/lib/domain/spotify').SpotifyTopArtist[] } = {
  rows: [],
};
const mockGetConnectionTokens = vi.fn();
const mockDeleteConnection = vi.fn();

vi.mock('@/lib/repositories/spotify-connection-repository', () => ({
  SupabaseSpotifyConnectionRepository: vi.fn().mockImplementation(() => ({
    getConnectionTokens: mockGetConnectionTokens,
    deleteConnection: mockDeleteConnection,
    updateStatus: vi.fn().mockResolvedValue(undefined),
    recordSync: vi.fn().mockResolvedValue(undefined),
    updateTokens: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/lib/repositories/spotify-affinity-repository', async (orig) => {
  const actual =
    await orig<
      typeof import('@/lib/repositories/spotify-affinity-repository')
    >();
  return {
    ...actual,
    SupabaseSpotifyAffinityRepository: vi.fn().mockImplementation(() => ({
      getAffinities: async () => stored.rows,
      replaceAffinities: async (
        _u: string,
        a: import('@/lib/domain/spotify').SpotifyTopArtist[],
      ) => {
        stored.rows = a;
        return a.length;
      },
      clearAffinities: async () => {
        stored.rows = [];
      },
    })),
  };
});

const mockGetTopArtists = vi.fn();
vi.mock('@/lib/sources/spotify/client', () => ({
  SpotifyApiClient: vi.fn().mockImplementation(() => ({
    getTopArtists: mockGetTopArtists,
    refreshAccessToken: vi.fn(),
  })),
}));

vi.mock('@/lib/env/server', () => ({
  getServerEnv: vi.fn().mockReturnValue({
    ENABLE_SPOTIFY_INTEGRATION: true,
    SPOTIFY_CLIENT_ID: 'id',
    SPOTIFY_CLIENT_SECRET: 'secret',
    SPOTIFY_REDIRECT_URI: 'http://127.0.0.1/cb',
    SPOTIFY_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
  }),
}));

vi.mock('@/lib/sources/spotify/genre-enrichment', () => ({
  enrichSpotifyArtistGenres: vi.fn().mockResolvedValue(undefined),
}));

import {
  clearSpotifyAffinityCache,
  getActiveSpotifyTopArtistsForUser,
  getStoredSpotifyAffinities,
  syncSpotifyTopArtistsAcrossTimeRanges,
} from '@/lib/sources/spotify/affinity-service';
import {
  MemorySpotifyAffinityRepository,
  mapAffinityRowToArtist,
} from '@/lib/repositories/spotify-affinity-repository';
import { SpotifyForbiddenError } from '@/lib/domain/spotify';

const USER = 'user-persist-1';
const artist = (id: string, name: string, rank: number) => ({
  id,
  name,
  rank,
  imageUrl: null,
  spotifyUrl: `https://open.spotify.com/artist/${id}`,
  genres: [],
  popularity: 50,
  timeRange: 'short_term' as const,
});

describe('Spotify affinity persistence', () => {
  beforeEach(() => {
    stored.rows = [];
    clearSpotifyAffinityCache();
    mockGetConnectionTokens.mockReset();
    mockGetTopArtists.mockReset();
  });

  it('persists a successful sync to durable storage', async () => {
    mockGetConnectionTokens.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      reauthorizationDeadline: new Date(Date.now() + 86400_000),
      scopes: [],
    });
    mockGetTopArtists.mockResolvedValue([artist('sp1', 'Artist One', 1)]);

    const synced = await syncSpotifyTopArtistsAcrossTimeRanges(USER);
    expect(synced).toHaveLength(1);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].id).toBe('sp1');
    expect(stored.rows[0].affinity).toBeGreaterThan(0);
  });

  it('serves stored affinities after disconnect (no tokens, cache cleared)', async () => {
    stored.rows = [{ ...artist('sp1', 'Artist One', 1), affinity: 0.9 }];
    mockGetConnectionTokens.mockResolvedValue(null); // connection deleted
    clearSpotifyAffinityCache(USER); // what disconnect does

    const result = await getActiveSpotifyTopArtistsForUser(USER);
    expect(result.map((a) => a.id)).toEqual(['sp1']);
    expect(mockGetTopArtists).not.toHaveBeenCalled();
  });

  it('falls back to stored affinities when Spotify returns 403 (allowlist removal)', async () => {
    stored.rows = [{ ...artist('sp2', 'Artist Two', 1), affinity: 0.8 }];
    mockGetConnectionTokens.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      reauthorizationDeadline: new Date(Date.now() + 86400_000),
      scopes: [],
    });
    mockGetTopArtists.mockRejectedValue(new SpotifyForbiddenError());

    const result = await syncSpotifyTopArtistsAcrossTimeRanges(USER);
    expect(result.map((a) => a.id)).toEqual(['sp2']);
    // stored snapshot untouched by the failed sync
    expect(stored.rows).toHaveLength(1);
  });

  it('getStoredSpotifyAffinities is fail-closed and accepts an injected repository', async () => {
    expect(await getStoredSpotifyAffinities('')).toEqual([]);
    const repo = new MemorySpotifyAffinityRepository();
    await repo.replaceAffinities(USER, [artist('x', 'X', 1)]);
    expect((await getStoredSpotifyAffinities(USER, repo)).length).toBe(1);
    // empty snapshot never wipes
    await repo.replaceAffinities(USER, []);
    expect((await repo.getAffinities(USER)).length).toBe(1);
  });

  it('maps stored rows back to SpotifyTopArtist with provenance fields', () => {
    const a = mapAffinityRowToArtist({
      user_id: USER,
      spotify_artist_id: 'sp9',
      artist_name: 'Nine',
      canonical_artist_id: 'canon-1',
      rank: 3,
      ranks_by_range: { short_term: 3 },
      affinity: '0.75',
      affinity_reason: 'rising',
      trend: 'rising',
      popularity: 60,
      genres: ['rock'],
      image_url: null,
      spotify_url: 'https://open.spotify.com/artist/sp9',
      synced_at: '2026-11-01T00:00:00Z',
    });
    expect(a.id).toBe('sp9');
    expect(a.affinity).toBe(0.75);
    expect(a.canonicalArtistId).toBe('canon-1');
    expect(a.syncedAt).toBe('2026-11-01T00:00:00Z');
  });
});
