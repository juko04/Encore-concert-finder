import { describe, expect, it } from 'vitest';
import { MemorySpotifyConnectionRepository } from '@/lib/repositories/memory-repositories';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { SpotifyAccountConflictError } from '@/lib/domain/spotify';
import { decryptSecret } from '@/lib/security/crypto';

const TEST_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('SpotifyConnectionRepository', () => {
  describe('MemorySpotifyConnectionRepository', () => {
    it('saves a new Spotify connection and retrieves it without tokens', async () => {
      const repo = new MemorySpotifyConnectionRepository();
      const expiresAt = new Date(Date.now() + 3600 * 1000);
      const deadline = new Date(Date.now() + 180 * 86400 * 1000);

      const conn = await repo.saveConnection({
        userId: 'user-1',
        spotifyAccountId: 'spot-acc-1',
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        tokenExpiresAt: expiresAt,
        reauthorizationDeadline: deadline,
        scopes: ['user-top-read'],
      });

      expect(conn.userId).toBe('user-1');
      expect(conn.spotifyAccountId).toBe('spot-acc-1');
      expect(conn.status).toBe('connected');
      expect(conn.scopes).toEqual(['user-top-read']);
      // Raw tokens must not be on connection object
      expect(
        (conn as unknown as Record<string, unknown>).accessToken,
      ).toBeUndefined();

      const retrieved = await repo.getConnection('user-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.spotifyAccountId).toBe('spot-acc-1');
      expect(retrieved?.status).toBe('connected');

      const tokens = await repo.getConnectionTokens('user-1');
      expect(tokens).not.toBeNull();
      expect(tokens?.accessToken).toBe('access-123');
      expect(tokens?.refreshToken).toBe('refresh-456');
    });

    it('enforces 1-to-1 account conflict when another user connects the same Spotify account', async () => {
      const repo = new MemorySpotifyConnectionRepository();
      const expiresAt = new Date(Date.now() + 3600 * 1000);
      const deadline = new Date(Date.now() + 180 * 86400 * 1000);

      await repo.saveConnection({
        userId: 'user-alpha',
        spotifyAccountId: 'shared-spotify-acc',
        accessToken: 'access-alpha',
        refreshToken: 'refresh-alpha',
        tokenExpiresAt: expiresAt,
        reauthorizationDeadline: deadline,
        scopes: ['user-top-read'],
      });

      // Different user connecting the same Spotify account must fail
      await expect(
        repo.saveConnection({
          userId: 'user-beta',
          spotifyAccountId: 'shared-spotify-acc',
          accessToken: 'access-beta',
          refreshToken: 'refresh-beta',
          tokenExpiresAt: expiresAt,
          reauthorizationDeadline: deadline,
          scopes: ['user-top-read'],
        }),
      ).rejects.toThrow(SpotifyAccountConflictError);

      // Same user reconnecting the same Spotify account must succeed
      await expect(
        repo.saveConnection({
          userId: 'user-alpha',
          spotifyAccountId: 'shared-spotify-acc',
          accessToken: 'access-alpha-updated',
          refreshToken: 'refresh-alpha-updated',
          tokenExpiresAt: expiresAt,
          reauthorizationDeadline: deadline,
          scopes: ['user-top-read'],
        }),
      ).resolves.toBeDefined();
    });

    it('updates tokens and status correctly', async () => {
      const repo = new MemorySpotifyConnectionRepository();
      const expiresAt = new Date(Date.now() + 3600 * 1000);
      const deadline = new Date(Date.now() + 180 * 86400 * 1000);

      await repo.saveConnection({
        userId: 'user-1',
        spotifyAccountId: 'spot-1',
        accessToken: 'initial-access',
        refreshToken: 'initial-refresh',
        tokenExpiresAt: expiresAt,
        reauthorizationDeadline: deadline,
        scopes: ['user-top-read'],
      });

      const newExpiresAt = new Date(Date.now() + 7200 * 1000);
      await repo.updateTokens('user-1', {
        accessToken: 'refreshed-access',
        tokenExpiresAt: newExpiresAt,
      });

      const tokens = await repo.getConnectionTokens('user-1');
      expect(tokens?.accessToken).toBe('refreshed-access');
      expect(tokens?.refreshToken).toBe('initial-refresh');

      // Update status to disconnected
      await repo.updateStatus('user-1', 'disconnected');
      const conn = await repo.getConnection('user-1');
      expect(conn?.status).toBe('disconnected');

      // Disconnected connection returns null tokens
      const disconnectedTokens = await repo.getConnectionTokens('user-1');
      expect(disconnectedTokens).toBeNull();
    });

    it('deletes connection on request', async () => {
      const repo = new MemorySpotifyConnectionRepository();
      await repo.saveConnection({
        userId: 'user-1',
        spotifyAccountId: 'spot-1',
        accessToken: 'access',
        refreshToken: 'refresh',
        tokenExpiresAt: new Date(),
        reauthorizationDeadline: new Date(),
        scopes: ['user-top-read'],
      });

      const deleted = await repo.deleteConnection('user-1');
      expect(deleted).toBe(true);

      const conn = await repo.getConnection('user-1');
      expect(conn).toBeNull();
    });
  });

  describe('SupabaseSpotifyConnectionRepository', () => {
    function createMockSupabase(initialRows: Record<string, unknown>[] = []) {
      const storage = new Map<string, Record<string, unknown>>(
        initialRows.map((r) => [r.user_id as string, { ...r }]),
      );

      return {
        from: (table: string) => {
          if (table !== 'user_spotify_connections') {
            throw new Error(`Unexpected table: ${table}`);
          }

          let filterCol: string | null = null;
          let filterVal: unknown = null;
          let upsertPayload: Record<string, unknown> | null = null;
          let updatePayload: Record<string, unknown> | null = null;
          let deleteMode = false;

          const queryObj = {
            select: () => queryObj,
            eq: (col: string, val: unknown) => {
              filterCol = col;
              filterVal = val;
              return queryObj;
            },
            maybeSingle: async () => {
              for (const row of storage.values()) {
                if (filterCol && row[filterCol] === filterVal) {
                  return { data: { ...row }, error: null };
                }
              }
              return { data: null, error: null };
            },
            single: async () => {
              if (upsertPayload) {
                const userId = upsertPayload.user_id as string;
                const spotId = upsertPayload.spotify_account_id as string;
                // Check unique constraint on spotify_account_id
                for (const existing of storage.values()) {
                  if (
                    existing.spotify_account_id === spotId &&
                    existing.user_id !== userId
                  ) {
                    return {
                      data: null,
                      error: {
                        code: '23505',
                        message:
                          'duplicate key value violates unique constraint "idx_user_spotify_connections_account_id"',
                      },
                    };
                  }
                }
                const saved = {
                  ...upsertPayload,
                  created_at: new Date().toISOString(),
                };
                storage.set(userId, saved);
                return { data: saved, error: null };
              }
              return { data: null, error: null };
            },
            upsert: (payload: Record<string, unknown>) => {
              upsertPayload = payload;
              return queryObj;
            },
            update: (payload: Record<string, unknown>) => {
              updatePayload = payload;
              return {
                eq: (col: string, val: unknown) => {
                  filterCol = col;
                  filterVal = val;
                  return {
                    select: () => ({
                      maybeSingle: async () => {
                        const target = storage.get(val as string);
                        if (!target) return { data: null, error: null };
                        const updated = { ...target, ...updatePayload };
                        storage.set(val as string, updated);
                        return { data: updated, error: null };
                      },
                    }),
                    then: (resolve: (val: { error: null }) => void) => {
                      const target = storage.get(val as string);
                      if (target) {
                        storage.set(val as string, {
                          ...target,
                          ...updatePayload,
                        });
                      }
                      resolve({ error: null });
                    },
                  };
                },
              };
            },
            delete: (opts?: { count?: string }) => {
              deleteMode = true;
              return {
                eq: async (col: string, val: unknown) => {
                  const existed = storage.has(val as string);
                  if (existed) storage.delete(val as string);
                  return {
                    error: null,
                    count: existed ? 1 : 0,
                  };
                },
              };
            },
          };

          return queryObj;
        },
        _storage: storage,
      };
    }

    it('encrypts access and refresh tokens at rest in database', async () => {
      const mockClient = createMockSupabase();
      const repo = new SupabaseSpotifyConnectionRepository(
        mockClient as any,
        TEST_ENCRYPTION_KEY,
      );

      const expiresAt = new Date(Date.now() + 3600 * 1000);
      const deadline = new Date(Date.now() + 180 * 86400 * 1000);

      await repo.saveConnection({
        userId: 'test-user-uuid',
        spotifyAccountId: 'spotify-acc-999',
        accessToken: 'sensitive-spotify-access-token',
        refreshToken: 'sensitive-spotify-refresh-token',
        tokenExpiresAt: expiresAt,
        reauthorizationDeadline: deadline,
        scopes: ['user-top-read'],
      });

      // Verify what was stored in the database mock
      const stored = mockClient._storage.get('test-user-uuid') as any;
      expect(stored).toBeDefined();
      expect(stored.spotify_account_id).toBe('spotify-acc-999');

      // Tokens must NOT be stored in plaintext
      expect(stored.encrypted_access_token).not.toBe(
        'sensitive-spotify-access-token',
      );
      expect(stored.encrypted_refresh_token).not.toBe(
        'sensitive-spotify-refresh-token',
      );

      // Tokens must be decryptable with the encryption key
      const decryptedAccess = decryptSecret(
        stored.encrypted_access_token,
        TEST_ENCRYPTION_KEY,
      );
      expect(decryptedAccess).toBe('sensitive-spotify-access-token');

      const decryptedRefresh = decryptSecret(
        stored.encrypted_refresh_token,
        TEST_ENCRYPTION_KEY,
      );
      expect(decryptedRefresh).toBe('sensitive-spotify-refresh-token');

      // Tokens returned by repository should be decrypted
      const tokens = await repo.getConnectionTokens('test-user-uuid');
      expect(tokens?.accessToken).toBe('sensitive-spotify-access-token');
      expect(tokens?.refreshToken).toBe('sensitive-spotify-refresh-token');
    });

    it('handles unique constraint violation with SpotifyAccountConflictError', async () => {
      const mockClient = createMockSupabase();
      const repo = new SupabaseSpotifyConnectionRepository(
        mockClient as any,
        TEST_ENCRYPTION_KEY,
      );

      const expiresAt = new Date(Date.now() + 3600 * 1000);
      const deadline = new Date(Date.now() + 180 * 86400 * 1000);

      await repo.saveConnection({
        userId: 'user-1',
        spotifyAccountId: 'shared-account-id',
        accessToken: 'token-1',
        refreshToken: 'refresh-1',
        tokenExpiresAt: expiresAt,
        reauthorizationDeadline: deadline,
        scopes: ['user-top-read'],
      });

      await expect(
        repo.saveConnection({
          userId: 'user-2',
          spotifyAccountId: 'shared-account-id',
          accessToken: 'token-2',
          refreshToken: 'refresh-2',
          tokenExpiresAt: expiresAt,
          reauthorizationDeadline: deadline,
          scopes: ['user-top-read'],
        }),
      ).rejects.toThrow(SpotifyAccountConflictError);
    });

    it('allows deleting connection and reading metadata without an encryption key', async () => {
      const mockClient = createMockSupabase([
        {
          user_id: 'user-to-disconnect',
          spotify_account_id: 'spot-disconnect',
          encrypted_access_token: 'enc-access',
          encrypted_refresh_token: 'enc-refresh',
          token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          reauthorization_deadline: new Date(
            Date.now() + 30 * 86400 * 1000,
          ).toISOString(),
          scopes: ['user-top-read'],
          status: 'connected',
          last_synced_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);

      // Instantiate repository WITHOUT an encryption key
      const repoNoKey = new SupabaseSpotifyConnectionRepository(
        mockClient as any,
      );

      // Metadata read must work without key
      const conn = await repoNoKey.getConnection('user-to-disconnect');
      expect(conn).not.toBeNull();
      expect(conn?.spotifyAccountId).toBe('spot-disconnect');

      // Attempting to decrypt tokens without key must fail
      await expect(
        repoNoKey.getConnectionTokens('user-to-disconnect'),
      ).rejects.toThrow('requires an encryption key to decrypt tokens');

      // Deleting connection without encryption key must succeed
      const deleted = await repoNoKey.deleteConnection('user-to-disconnect');
      expect(deleted).toBe(true);

      const afterDelete = await repoNoKey.getConnection('user-to-disconnect');
      expect(afterDelete).toBeNull();
    });
  });
});
