import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

// Mock server-only dependencies
vi.mock('@/lib/auth/session', () => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn().mockReturnValue({}),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const mockGetConnection = vi.fn();
const mockDeleteConnection = vi.fn();
const mockGetConnectionTokens = vi.fn();
const mockUpdateTokens = vi.fn();
const mockRecordSync = vi.fn();
const mockUpdateStatus = vi.fn();

vi.mock('@/lib/repositories/spotify-connection-repository', () => ({
  SupabaseSpotifyConnectionRepository: vi.fn().mockImplementation(() => ({
    getConnection: mockGetConnection,
    deleteConnection: mockDeleteConnection,
    getConnectionTokens: mockGetConnectionTokens,
    updateTokens: mockUpdateTokens,
    recordSync: mockRecordSync,
    updateStatus: mockUpdateStatus,
  })),
}));

const mockGetTopArtists = vi.fn();
const mockRefreshAccessToken = vi.fn();

vi.mock('@/lib/sources/spotify/client', () => ({
  SpotifyApiClient: vi.fn().mockImplementation(() => ({
    getTopArtists: mockGetTopArtists,
    refreshAccessToken: mockRefreshAccessToken,
  })),
}));

const mockServerEnv = {
  ENABLE_SPOTIFY_INTEGRATION: true,
  SPOTIFY_CLIENT_ID: 'mock-client-id',
  SPOTIFY_CLIENT_SECRET: 'mock-client-secret',
  SPOTIFY_REDIRECT_URI:
    'http://127.0.0.1:3000/api/integrations/spotify/callback',
  SPOTIFY_TOKEN_ENCRYPTION_KEY:
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

vi.mock('@/lib/env/server', () => ({
  getServerEnv: vi.fn().mockImplementation(() => mockServerEnv),
}));

import {
  SpotifyAuthenticationError,
  SpotifyRateLimitError,
} from '@/lib/domain/spotify';
import { getAuthenticatedUser } from '@/lib/auth/session';
import {
  disconnectSpotifyAction,
  getSpotifyStatusAction,
  getSpotifyTopArtistsAction,
} from '@/app/profile/taste/actions';

describe('Spotify Server Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConnection.mockReset();
    mockGetConnection.mockResolvedValue(null);
    mockDeleteConnection.mockReset();
    mockDeleteConnection.mockImplementation(async () => {
      mockGetConnection.mockResolvedValue(null);
      return true;
    });
    mockGetConnectionTokens.mockReset();
    mockUpdateTokens.mockReset();
    mockRecordSync.mockReset();
    mockUpdateStatus.mockReset();
    mockGetTopArtists.mockReset();
    mockRefreshAccessToken.mockReset();
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: 'test-user-id',
      email: 'user@encore.test',
    } as unknown as User);
  });

  describe('getSpotifyStatusAction', () => {
    it('returns connected: false when user is not authenticated', async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const status = await getSpotifyStatusAction();
      expect(status.connected).toBe(false);
      expect(mockGetConnection).not.toHaveBeenCalled();
    });

    it('returns connection metadata when user has connected Spotify', async () => {
      mockGetConnection.mockResolvedValueOnce({
        userId: 'test-user-id',
        spotifyAccountId: 'spot-acc-777',
        status: 'connected',
        lastSyncedAt: '2026-10-15T10:00:00Z',
        scopes: ['user-top-read'],
      });

      const status = await getSpotifyStatusAction();
      expect(status.connected).toBe(true);
      expect(status.spotifyAccountId).toBe('spot-acc-777');
      expect(status.status).toBe('connected');
      expect(status.isConfigured).toBe(true);
    });

    it('returns connected: false when no record exists for user', async () => {
      mockGetConnection.mockResolvedValueOnce(null);

      const status = await getSpotifyStatusAction();
      expect(status.connected).toBe(false);
      expect(status.isConfigured).toBe(true);
    });

    it('discovers connection and reports connected: true even when encryption key is absent', async () => {
      const prevKey = mockServerEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY;
      (mockServerEnv as any).SPOTIFY_TOKEN_ENCRYPTION_KEY = '';
      mockGetConnection.mockResolvedValueOnce({
        userId: 'test-user-id',
        spotifyAccountId: 'spot-acc-777',
        status: 'connected',
        lastSyncedAt: '2026-10-15T10:00:00Z',
        scopes: ['user-top-read'],
      });

      try {
        const status = await getSpotifyStatusAction();
        expect(status.connected).toBe(true);
        expect(status.spotifyAccountId).toBe('spot-acc-777');
        expect(status.isConfigured).toBe(false);
      } finally {
        mockServerEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY = prevKey;
      }
    });
  });

  describe('disconnectSpotifyAction', () => {
    it('rejects unauthenticated request', async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const result = await disconnectSpotifyAction();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unauthorized');
      expect(mockDeleteConnection).not.toHaveBeenCalled();
    });

    it('calls repository to remove connection and returns success', async () => {
      mockDeleteConnection.mockResolvedValueOnce(true);

      const result = await disconnectSpotifyAction();
      expect(result.success).toBe(true);
      expect(mockDeleteConnection).toHaveBeenCalledWith('test-user-id');
    });

    it('succeeds in deleting connection even when encryption key is absent', async () => {
      // Temporarily clear encryption key
      const prevKey = mockServerEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY;
      (mockServerEnv as any).SPOTIFY_TOKEN_ENCRYPTION_KEY = '';
      mockDeleteConnection.mockResolvedValueOnce(true);

      try {
        const result = await disconnectSpotifyAction();
        expect(result.success).toBe(true);
        expect(mockDeleteConnection).toHaveBeenCalledWith('test-user-id');
      } finally {
        mockServerEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY = prevKey;
      }
    });
    it('supports connecting, removing encryption-key configuration, discovering connection, and successfully disconnecting', async () => {
      // 1. Connection exists
      mockGetConnection.mockResolvedValue({
        userId: 'test-user-id',
        spotifyAccountId: 'spot-acc-lifecycle',
        status: 'connected',
        lastSyncedAt: '2026-10-15T12:00:00Z',
        scopes: ['user-top-read'],
      });
      mockDeleteConnection.mockImplementationOnce(async () => {
        mockGetConnection.mockResolvedValue(null);
        return true;
      });

      // 2. Remove encryption key from configuration
      const prevKey = mockServerEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY;
      (mockServerEnv as any).SPOTIFY_TOKEN_ENCRYPTION_KEY = '';

      try {
        // UI discovers connection even with missing key
        const status = await getSpotifyStatusAction();
        expect(status.connected).toBe(true);
        expect(status.spotifyAccountId).toBe('spot-acc-lifecycle');

        // Disconnect completes successfully without requiring key
        const disconnectResult = await disconnectSpotifyAction();
        expect(disconnectResult.success).toBe(true);
        expect(mockDeleteConnection).toHaveBeenCalledWith('test-user-id');
      } finally {
        mockServerEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY = prevKey;
      }
    });
  });

  describe('getSpotifyTopArtistsAction', () => {
    it('returns synthetic preview data when preview: true in development/test', async () => {
      const result = await getSpotifyTopArtistsAction('short_term', true);
      expect(result.isSyntheticPreview).toBe(true);
      expect(result.artists.length).toBeGreaterThan(0);
      expect(result.artists[0].name).toBe('Chappell Roan');
      expect(result.error).toBeUndefined();
    });

    it('blocks synthetic preview in production unless explicitly enabled', async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevFlag = process.env.ENABLE_SPOTIFY_DEV_PREVIEW;
      try {
        (process.env as Record<string, string | undefined>).NODE_ENV =
          'production';
        delete process.env.ENABLE_SPOTIFY_DEV_PREVIEW;

        const result = await getSpotifyTopArtistsAction('short_term', true);
        expect(result.isSyntheticPreview).toBe(false);
        expect(result.artists).toEqual([]);
        expect(result.error).toContain('only available in development');
      } finally {
        (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
        if (prevFlag !== undefined) {
          process.env.ENABLE_SPOTIFY_DEV_PREVIEW = prevFlag;
        } else {
          delete process.env.ENABLE_SPOTIFY_DEV_PREVIEW;
        }
      }
    });

    it('returns explicit error when user has no active Spotify connection without synthetic fallback', async () => {
      mockGetConnectionTokens.mockResolvedValueOnce(null);

      const result = await getSpotifyTopArtistsAction('short_term', false);
      expect(result.isSyntheticPreview).toBe(false);
      expect(result.artists).toEqual([]);
      expect(result.error).toContain('No active Spotify connection found');
    });

    it('enforces reauthorization deadline: marks status expired and avoids calling Spotify', async () => {
      mockGetConnectionTokens.mockResolvedValueOnce({
        accessToken: 'valid-access-token',
        refreshToken: 'valid-refresh-token',
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000), // access token not expired
        reauthorizationDeadline: new Date(Date.now() - 1000), // deadline expired in past
        scopes: ['user-top-read'],
      });

      const result = await getSpotifyTopArtistsAction('short_term', false);
      expect(result.isSyntheticPreview).toBe(false);
      expect(result.artists).toEqual([]);
      expect(result.error).toContain('Spotify authorization has expired');
      expect(mockUpdateStatus).toHaveBeenCalledWith('test-user-id', 'expired');
      expect(mockGetTopArtists).not.toHaveBeenCalled();
    });

    it('fetches live artists with valid, not-yet-expired credentials', async () => {
      mockGetConnectionTokens.mockResolvedValueOnce({
        accessToken: 'valid-access-token',
        refreshToken: 'valid-refresh-token',
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
        scopes: ['user-top-read'],
      });

      const liveArtists = [
        {
          id: 'live-artist-1',
          name: 'The National',
          rank: 1,
          imageUrl: null,
          spotifyUrl: 'https://open.spotify.com/artist/live-1',
          genres: ['indie rock'],
          popularity: 80,
          timeRange: 'short_term',
        },
      ];
      mockGetTopArtists.mockResolvedValueOnce(liveArtists);

      const result = await getSpotifyTopArtistsAction('short_term', false);
      expect(result.isSyntheticPreview).toBe(false);
      expect(result.artists).toEqual(liveArtists);
      expect(mockRecordSync).toHaveBeenCalledWith('test-user-id');
    });

    it('marks connection expired when token refresh fails with permanent SpotifyAuthenticationError', async () => {
      mockGetConnectionTokens.mockResolvedValueOnce({
        accessToken: 'expired-access-token',
        refreshToken: 'revoked-refresh-token',
        tokenExpiresAt: new Date(Date.now() - 60 * 1000),
        reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
        scopes: ['user-top-read'],
      });

      mockRefreshAccessToken.mockRejectedValueOnce(
        new SpotifyAuthenticationError('Refresh token revoked'),
      );

      const result = await getSpotifyTopArtistsAction('short_term', false);
      expect(result.artists).toEqual([]);
      expect(result.error).toContain(
        'Spotify authorization expired or revoked',
      );
      expect(mockUpdateStatus).toHaveBeenCalledWith('test-user-id', 'expired');
    });

    it('preserves connection status and returns rate limit error when token refresh encounters SpotifyRateLimitError (transient)', async () => {
      mockGetConnectionTokens.mockResolvedValueOnce({
        accessToken: 'expiring-access-token',
        refreshToken: 'valid-refresh-token',
        tokenExpiresAt: new Date(Date.now() + 10 * 1000),
        reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
        scopes: ['user-top-read'],
      });

      mockRefreshAccessToken.mockRejectedValueOnce(
        new SpotifyRateLimitError(30),
      );

      const result = await getSpotifyTopArtistsAction('short_term', false);
      expect(result.artists).toEqual([]);
      expect(result.error).toContain('Spotify rate limit exceeded');
      // Invariant: Transient rate limits MUST NOT mark connection expired
      expect(mockUpdateStatus).not.toHaveBeenCalled();
    });

    it('preserves connection status and returns temporary failure message on 5xx or network refresh error (transient)', async () => {
      mockGetConnectionTokens.mockResolvedValueOnce({
        accessToken: 'expiring-access-token',
        refreshToken: 'valid-refresh-token',
        tokenExpiresAt: new Date(Date.now() + 10 * 1000),
        reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
        scopes: ['user-top-read'],
      });

      mockRefreshAccessToken.mockRejectedValueOnce(
        new Error('Spotify 502 Bad Gateway or network timeout'),
      );

      const result = await getSpotifyTopArtistsAction('short_term', false);
      expect(result.artists).toEqual([]);
      expect(result.error).toContain('Spotify service temporarily unavailable');
      // Invariant: Transient server/network failures MUST NOT mark connection expired
      expect(mockUpdateStatus).not.toHaveBeenCalled();
    });

    it('returns explicit error on live Spotify request failure without silent synthetic fallback', async () => {
      mockGetConnectionTokens.mockResolvedValueOnce({
        accessToken: 'valid-access-token',
        refreshToken: 'valid-refresh-token',
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
        scopes: ['user-top-read'],
      });

      mockGetTopArtists.mockRejectedValueOnce(
        new Error('Rate limit or upstream API failure'),
      );

      const result = await getSpotifyTopArtistsAction('short_term', false);
      // Invariant: Live failure must produce explicit error, NEVER synthetic data
      expect(result.isSyntheticPreview).toBe(false);
      expect(result.artists).toEqual([]);
      expect(result.error).toBe('Failed to fetch Spotify top artists.');
    });

    it('rejects invalid timeRange', async () => {
      const result = await getSpotifyTopArtistsAction('invalid_window' as any);
      expect(result.error).toBe('Invalid time range specified.');
      expect(result.artists).toEqual([]);
    });

    it('rejects unauthenticated request', async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);
      const result = await getSpotifyTopArtistsAction('short_term');
      expect(result.error).toBe('You must be signed in to view music taste.');
    });
  });
});
