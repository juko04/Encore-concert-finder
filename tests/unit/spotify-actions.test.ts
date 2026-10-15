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

vi.mock('@/lib/env/server', () => ({
  getServerEnv: vi.fn().mockReturnValue({
    ENABLE_SPOTIFY_INTEGRATION: true,
    SPOTIFY_CLIENT_ID: 'mock-client-id',
    SPOTIFY_CLIENT_SECRET: 'mock-client-secret',
    SPOTIFY_REDIRECT_URI:
      'http://127.0.0.1:3000/api/integrations/spotify/callback',
    SPOTIFY_TOKEN_ENCRYPTION_KEY:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  }),
}));

import { getAuthenticatedUser } from '@/lib/auth/session';
import {
  disconnectSpotifyAction,
  getSpotifyStatusAction,
  getSpotifyTopArtistsAction,
} from '@/app/profile/taste/actions';

describe('Spotify Server Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  describe('getSpotifyTopArtistsAction', () => {
    it('returns synthetic preview data when preview: true', async () => {
      const result = await getSpotifyTopArtistsAction('short_term', true);
      expect(result.isSyntheticPreview).toBe(true);
      expect(result.artists.length).toBeGreaterThan(0);
      expect(result.artists[0].name).toBe('Chappell Roan');
      expect(result.error).toBeUndefined();
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
