import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpotifyApiClient } from '@/lib/sources/spotify/client';
import {
  SpotifyAuthenticationError,
  SpotifyForbiddenError,
  SpotifyRateLimitError,
  type SpotifyTopArtist,
} from '@/lib/domain/spotify';
import {
  clearSpotifyAffinityCache,
  getSpotifyAffinityCacheSize,
  _setAffinityCacheForTesting,
  getActiveSpotifyTopArtistsForUser,
} from '@/lib/sources/spotify/affinity-service';
import {
  createOAuthHandshakeToken,
  verifyOAuthHandshakeToken,
  generateCodeVerifier,
} from '@/lib/sources/spotify/oauth';
import { decryptSecret, encryptSecret } from '@/lib/security/crypto';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { MemorySpotifyConnectionRepository } from '@/lib/repositories/memory-repositories';

const VALID_64_HEX_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SECOND_64_HEX_KEY =
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

describe('Spotify Sync Diagnostics & Security Audit', () => {
  describe('1. API Error Handling & Diagnostics', () => {
    const baseClientConfig = {
      clientId: 'diag-client-id',
      clientSecret: 'diag-client-secret',
      redirectUri: 'http://127.0.0.1:3000/api/integrations/spotify/callback',
    };

    it('handles HTTP 401: throws SpotifyAuthenticationError indicating reauthorization is required', async () => {
      const mockFetch = async () =>
        new Response(
          JSON.stringify({
            error: {
              status: 401,
              message: 'The access token expired',
            },
          }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          },
        );

      const client = new SpotifyApiClient({
        ...baseClientConfig,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      // 1. Calling getTopArtists with expired token
      await expect(
        client.getTopArtists('expired-access-token', 'short_term'),
      ).rejects.toThrow(SpotifyAuthenticationError);

      // 2. Calling getCurrentUser with expired token
      await expect(
        client.getCurrentUser('expired-access-token'),
      ).rejects.toThrow(SpotifyAuthenticationError);

      // 3. Refreshing with revoked/invalid refresh token
      const mockRefreshFetch = async () =>
        new Response(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'Refresh token revoked',
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          },
        );

      const refreshClient = new SpotifyApiClient({
        ...baseClientConfig,
        fetchFn: mockRefreshFetch as unknown as typeof fetch,
      });

      await expect(
        refreshClient.refreshAccessToken('revoked-refresh-token'),
      ).rejects.toThrow(SpotifyAuthenticationError);

      await expect(
        refreshClient.refreshAccessToken('revoked-refresh-token'),
      ).rejects.toThrow(/User reauthorization required/);
    });

    it('handles HTTP 403: throws SpotifyForbiddenError explaining Developer Mode allowlist restriction', async () => {
      const mockFetch = async () =>
        new Response(
          JSON.stringify({
            error: {
              status: 403,
              message:
                'User not registered in the Developer Dashboard beta allowlist',
            },
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          },
        );

      const client = new SpotifyApiClient({
        ...baseClientConfig,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      try {
        await client.getTopArtists(
          'valid-token-unallowlisted-user',
          'medium_term',
        );
        expect.fail('Expected SpotifyForbiddenError');
      } catch (err) {
        expect(err).toBeInstanceOf(SpotifyForbiddenError);
        expect((err as SpotifyForbiddenError).message).toContain(
          'Access to the Spotify application is restricted to allowlisted beta users in Development Mode',
        );
      }

      // Also test getCurrentUser under 403
      await expect(
        client.getCurrentUser('unallowlisted-token'),
      ).rejects.toThrow(SpotifyForbiddenError);
    });

    it('handles HTTP 429: throws SpotifyRateLimitError and parses Retry-After header with fallback', async () => {
      // 1. With explicit Retry-After header
      const mockFetchWithHeader = async () =>
        new Response(
          JSON.stringify({
            error: {
              status: 429,
              message: 'API rate limit exceeded',
            },
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '42',
            },
          },
        );

      const clientWithHeader = new SpotifyApiClient({
        ...baseClientConfig,
        fetchFn: mockFetchWithHeader as unknown as typeof fetch,
      });

      try {
        await clientWithHeader.getTopArtists('token', 'short_term');
        expect.fail('Expected SpotifyRateLimitError');
      } catch (err) {
        expect(err).toBeInstanceOf(SpotifyRateLimitError);
        const rateLimitErr = err as SpotifyRateLimitError;
        expect(rateLimitErr.retryAfterSeconds).toBe(42);
        expect(rateLimitErr.message).toContain('Retry after 42 seconds');
      }

      // 2. Without Retry-After header -> defaults to 5 seconds
      const mockFetchWithoutHeader = async () =>
        new Response('Rate limited', {
          status: 429,
          headers: {},
        });

      const clientWithoutHeader = new SpotifyApiClient({
        ...baseClientConfig,
        fetchFn: mockFetchWithoutHeader as unknown as typeof fetch,
      });

      try {
        await clientWithoutHeader.getTopArtists('token', 'short_term');
        expect.fail('Expected SpotifyRateLimitError');
      } catch (err) {
        expect(err).toBeInstanceOf(SpotifyRateLimitError);
        expect((err as SpotifyRateLimitError).retryAfterSeconds).toBe(5);
        expect((err as SpotifyRateLimitError).message).toContain(
          'Retry after 5 seconds',
        );
      }
    });

    it('enforces fail-closed resilience: affinity service returns empty array on failure without throwing', async () => {
      // getActiveSpotifyTopArtistsForUser gracefully fails closed when environment is not set or API fails
      const emptyResult =
        await getActiveSpotifyTopArtistsForUser('unconfigured-user');
      expect(emptyResult).toEqual([]);
    });
  });

  describe('2. Multi-Range Cache Invalidation & TTL Lifecycle', () => {
    beforeEach(() => {
      clearSpotifyAffinityCache();
    });

    it('invalidates short-, medium-, and long-term cache entries for a specific user while preserving others', () => {
      const userA = 'user-diagnostics-a';
      const userB = 'user-diagnostics-b';

      const mockArtistsA: SpotifyTopArtist[] = [
        {
          id: 'spot-artist-1',
          name: 'Artist One',
          rank: 1,
          imageUrl: null,
          spotifyUrl: 'https://open.spotify.com/artist/spot-artist-1',
          genres: ['indie'],
          popularity: 80,
          timeRange: 'short_term',
        },
      ];

      const mockArtistsB: SpotifyTopArtist[] = [
        {
          id: 'spot-artist-2',
          name: 'Artist Two',
          rank: 1,
          imageUrl: null,
          spotifyUrl: 'https://open.spotify.com/artist/spot-artist-2',
          genres: ['rock'],
          popularity: 75,
          timeRange: 'short_term',
        },
      ];

      // Populate userA across all three time ranges
      _setAffinityCacheForTesting(userA, 'short_term', mockArtistsA);
      _setAffinityCacheForTesting(userA, 'medium_term', mockArtistsA);
      _setAffinityCacheForTesting(userA, 'long_term', mockArtistsA);

      // Populate userB across two time ranges
      _setAffinityCacheForTesting(userB, 'short_term', mockArtistsB);
      _setAffinityCacheForTesting(userB, 'long_term', mockArtistsB);

      expect(getSpotifyAffinityCacheSize()).toBe(5);

      // Invalidate userA cache
      clearSpotifyAffinityCache(userA);

      // userA's 3 entries must be cleared; userB's 2 entries must remain intact
      expect(getSpotifyAffinityCacheSize()).toBe(2);

      // Invalidate userB cache
      clearSpotifyAffinityCache(userB);
      expect(getSpotifyAffinityCacheSize()).toBe(0);
    });

    it('enforces TTL expiration for stale cache entries', async () => {
      const originalNow = Date.now;
      let mockTime = 1_700_000_000_000;
      Date.now = () => mockTime;

      try {
        const userId = 'user-ttl-test';
        const mockArtists: SpotifyTopArtist[] = [
          {
            id: 'spot-ttl-1',
            name: 'TTL Artist',
            rank: 1,
            imageUrl: null,
            spotifyUrl: 'https://open.spotify.com/artist/spot-ttl-1',
            genres: ['pop'],
            popularity: 85,
            timeRange: 'short_term',
          },
        ];

        _setAffinityCacheForTesting(userId, 'short_term', mockArtists);
        expect(getSpotifyAffinityCacheSize()).toBe(1);

        // Advance simulated time past 5-minute TTL (6 minutes = 360,000 ms)
        mockTime += 6 * 60 * 1000;

        // When retrieving via getActiveSpotifyTopArtistsForUser, expired cache misses
        // and because serverEnv is unconfigured, fail-closed returns []
        const result = await getActiveSpotifyTopArtistsForUser(
          userId,
          'short_term',
        );
        expect(result).toEqual([]);
      } finally {
        Date.now = originalNow;
      }
    });
  });

  describe('3. Security Audit & Token Isolation Assertions', () => {
    it('guarantees client-facing SpotifyConnection object NEVER exposes access or refresh tokens', async () => {
      const memoryRepo = new MemorySpotifyConnectionRepository();
      const expiresAt = new Date(Date.now() + 3600 * 1000);
      const deadline = new Date(Date.now() + 180 * 86400 * 1000);

      await memoryRepo.saveConnection({
        userId: 'sec-audit-user-1',
        spotifyAccountId: 'spot-audit-acc-1',
        accessToken: 'sensitive-plaintext-access-token-xyz',
        refreshToken: 'sensitive-plaintext-refresh-token-abc',
        tokenExpiresAt: expiresAt,
        reauthorizationDeadline: deadline,
        scopes: ['user-top-read'],
      });

      // 1. Inspect getConnection() output
      const publicConnection =
        await memoryRepo.getConnection('sec-audit-user-1');
      expect(publicConnection).not.toBeNull();

      const rawObject = publicConnection as unknown as Record<string, unknown>;
      expect(rawObject.accessToken).toBeUndefined();
      expect(rawObject.refreshToken).toBeUndefined();
      expect(rawObject.encryptedAccessToken).toBeUndefined();
      expect(rawObject.encryptedRefreshToken).toBeUndefined();

      // Only metadata fields may exist
      expect(publicConnection?.userId).toBe('sec-audit-user-1');
      expect(publicConnection?.spotifyAccountId).toBe('spot-audit-acc-1');
      expect(publicConnection?.status).toBe('connected');
      expect(publicConnection?.scopes).toEqual(['user-top-read']);

      // 2. Only secure server-side getConnectionTokens() can access tokens
      const serverTokens =
        await memoryRepo.getConnectionTokens('sec-audit-user-1');
      expect(serverTokens).not.toBeNull();
      expect(serverTokens?.accessToken).toBe(
        'sensitive-plaintext-access-token-xyz',
      );
      expect(serverTokens?.refreshToken).toBe(
        'sensitive-plaintext-refresh-token-abc',
      );
    });

    it('enforces AES-256-GCM token encryption at rest via SupabaseSpotifyConnectionRepository', async () => {
      // Mock Supabase client to inspect what rows are written to Postgres
      let writtenRow: Record<string, unknown> | null = null;

      const mockSupabase = {
        from: (table: string) => {
          expect(table).toBe('user_spotify_connections');
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: writtenRow,
                  error: null,
                }),
              }),
            }),
            upsert: (row: Record<string, unknown>) => {
              writtenRow = row;
              return {
                select: () => ({
                  single: async () => ({
                    data: {
                      ...row,
                      created_at: new Date().toISOString(),
                      last_synced_at: null,
                    },
                    error: null,
                  }),
                }),
              };
            },
          };
        },
      };

      const repo = new SupabaseSpotifyConnectionRepository(
        mockSupabase as unknown as any,
        VALID_64_HEX_KEY,
      );

      const expiresAt = new Date(Date.now() + 3600 * 1000);
      const deadline = new Date(Date.now() + 180 * 86400 * 1000);

      await repo.saveConnection({
        userId: 'user-crypto-test',
        spotifyAccountId: 'spot-crypto-acc',
        accessToken: 'super-secret-access-token-999',
        refreshToken: 'super-secret-refresh-token-888',
        tokenExpiresAt: expiresAt,
        reauthorizationDeadline: deadline,
        scopes: ['user-top-read'],
      });

      // Verify the persisted row contains ONLY ciphertext, never plaintext tokens
      expect(writtenRow).not.toBeNull();
      expect(writtenRow!.encrypted_access_token).toBeDefined();
      expect(writtenRow!.encrypted_refresh_token).toBeDefined();

      const encAccess = writtenRow!.encrypted_access_token as string;
      const encRefresh = writtenRow!.encrypted_refresh_token as string;

      // AES-256-GCM format is iv:ciphertext:authTag (3 colon-separated hex segments)
      expect(encAccess.split(':')).toHaveLength(3);
      expect(encRefresh.split(':')).toHaveLength(3);

      // Plaintext MUST NEVER appear in raw database storage!
      expect(encAccess).not.toContain('super-secret-access-token-999');
      expect(encRefresh).not.toContain('super-secret-refresh-token-888');

      // Verify decrypting with legitimate key recovers original plaintext
      const decryptedAccess = decryptSecret(encAccess, VALID_64_HEX_KEY);
      const decryptedRefresh = decryptSecret(encRefresh, VALID_64_HEX_KEY);
      expect(decryptedAccess).toBe('super-secret-access-token-999');
      expect(decryptedRefresh).toBe('super-secret-refresh-token-888');

      // Verify decrypting with wrong key fails cryptographically
      expect(() => decryptSecret(encAccess, SECOND_64_HEX_KEY)).toThrow();
    });

    it('enforces strict 64-character hex encryption key validation and never leaks key in errors', () => {
      const mockSupabase = { from: vi.fn() };

      // 1. Empty or short key throws
      expect(
        () =>
          new SupabaseSpotifyConnectionRepository(
            mockSupabase as unknown as any,
            'too-short-key',
          ),
      ).toThrow(
        /SupabaseSpotifyConnectionRepository requires a valid 64-character hex encryption key/,
      );

      // 2. 63 characters throws
      expect(
        () =>
          new SupabaseSpotifyConnectionRepository(
            mockSupabase as unknown as any,
            'a'.repeat(63),
          ),
      ).toThrow();

      // 3. Error messages never contain the secret key value
      try {
        encryptSecret('data', 'invalid-key-xyz');
      } catch (err: any) {
        expect(err.message).not.toContain('invalid-key-xyz');
      }
    });

    it('enforces PKCE handshake token integrity, tamper resistance, and 10-minute expiry', () => {
      const verifier = generateCodeVerifier();
      const state = 'state-abc-123';
      const userId = 'user-handshake-456';

      // 1. Valid token creation and verification
      const token = createOAuthHandshakeToken(
        {
          state,
          codeVerifier: verifier,
          userId,
          createdAt: Date.now(),
        },
        VALID_64_HEX_KEY,
      );

      const verified = verifyOAuthHandshakeToken(token, VALID_64_HEX_KEY);
      expect(verified).not.toBeNull();
      expect(verified?.state).toBe(state);
      expect(verified?.codeVerifier).toBe(verifier);
      expect(verified?.userId).toBe(userId);

      // 2. Tampered token returns null without throwing or leaking
      const tamperedToken = token.slice(0, -4) + 'ffff';
      expect(
        verifyOAuthHandshakeToken(tamperedToken, VALID_64_HEX_KEY),
      ).toBeNull();

      // 3. Decrypting with wrong key returns null
      expect(verifyOAuthHandshakeToken(token, SECOND_64_HEX_KEY)).toBeNull();

      // 4. Expired handshake token (>10 minutes) returns null
      const expiredPayloadToken = createOAuthHandshakeToken(
        {
          state,
          codeVerifier: verifier,
          userId,
          createdAt: Date.now() - 11 * 60 * 1000, // 11 minutes ago
        },
        VALID_64_HEX_KEY,
      );

      expect(
        verifyOAuthHandshakeToken(expiredPayloadToken, VALID_64_HEX_KEY),
      ).toBeNull();

      // 5. Future-dated timestamp (clock drift > maxAgeMs) returns null
      const futurePayloadToken = createOAuthHandshakeToken(
        {
          state,
          codeVerifier: verifier,
          userId,
          createdAt: Date.now() + 60 * 1000, // 1 minute in the future
        },
        VALID_64_HEX_KEY,
      );

      expect(
        verifyOAuthHandshakeToken(futurePayloadToken, VALID_64_HEX_KEY),
      ).toBeNull();
    });
  });
});
