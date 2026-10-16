import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { SpotifyAccountConflictError } from '@/lib/domain/spotify';
import { decryptSecret } from '@/lib/security/crypto';

interface LocalCredentials {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

const TEST_ENCRYPTION_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

function resolveSupabaseCredentials(): LocalCredentials | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && anonKey && serviceRoleKey) {
    return {
      url,
      anonKey,
      serviceRoleKey,
    };
  }

  try {
    const rawOutput = execSync('npx supabase status -o json', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(rawOutput) as {
      API_URL?: string;
      ANON_KEY?: string;
      SERVICE_ROLE_KEY?: string;
    };

    if (parsed.API_URL && parsed.ANON_KEY && parsed.SERVICE_ROLE_KEY) {
      return {
        url: url || parsed.API_URL,
        anonKey: anonKey || parsed.ANON_KEY,
        serviceRoleKey: serviceRoleKey || parsed.SERVICE_ROLE_KEY,
      };
    }
  } catch {
    // Supabase CLI status not available
  }

  return null;
}

describe('PostgreSQL RLS & Invariants on public.user_spotify_connections', () => {
  const credentials = resolveSupabaseCredentials();

  let adminClient: SupabaseClient | null = null;
  let clientA: SupabaseClient | null = null;
  let anonClient: SupabaseClient | null = null;

  let userAId: string | null = null;
  let userBId: string | null = null;
  let isDbAvailable = false;

  beforeAll(async () => {
    if (!credentials) {
      if (process.env.CI) {
        throw new Error('Supabase credentials could not be resolved in CI.');
      }
      return;
    }

    assertSafeDatabaseTarget(
      credentials.url,
      false,
      'Integration suite testing user_spotify_connections',
    );

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Check if user_spotify_connections table exists in current schema
    const { error: probeError } = await adminClient
      .from('user_spotify_connections')
      .select('user_id')
      .limit(0);

    if (probeError) {
      if (process.env.CI) {
        throw new Error(
          `user_spotify_connections table probe failed in CI: ${probeError.message}`,
        );
      }
      return;
    }

    isDbAvailable = true;

    // Create user A
    const emailA = `spotify_test_a_${Date.now()}@example.com`;
    const passwordA = 'TestPass123!Secure';
    const { data: authA, error: errA } =
      await adminClient.auth.admin.createUser({
        email: emailA,
        password: passwordA,
        email_confirm: true,
      });
    if (errA || !authA.user) {
      throw new Error(`Failed to create test user A: ${errA?.message}`);
    }
    userAId = authA.user.id;

    // Create user B
    const emailB = `spotify_test_b_${Date.now()}@example.com`;
    const passwordB = 'TestPass123!Secure';
    const { data: authB, error: errB } =
      await adminClient.auth.admin.createUser({
        email: emailB,
        password: passwordB,
        email_confirm: true,
      });
    if (errB || !authB.user) {
      throw new Error(`Failed to create test user B: ${errB?.message}`);
    }
    userBId = authB.user.id;

    // Create authenticated client for user A
    clientA = createClient(credentials.url, credentials.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInErr } = await clientA.auth.signInWithPassword({
      email: emailA,
      password: passwordA,
    });
    if (signInErr) {
      throw new Error(`Failed to sign in test user A: ${signInErr.message}`);
    }

    // Create anonymous client
    anonClient = createClient(credentials.url, credentials.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterAll(async () => {
    if (!adminClient || !isDbAvailable) return;

    if (userAId) {
      await adminClient
        .from('user_spotify_connections')
        .delete()
        .eq('user_id', userAId);
      await adminClient
        .from('user_artist_preferences')
        .delete()
        .eq('user_id', userAId);
      await adminClient.auth.admin.deleteUser(userAId);
    }
    if (userBId) {
      await adminClient
        .from('user_spotify_connections')
        .delete()
        .eq('user_id', userBId);
      await adminClient
        .from('user_artist_preferences')
        .delete()
        .eq('user_id', userBId);
      await adminClient.auth.admin.deleteUser(userBId);
    }
  });

  it('enforces Zero-Client RLS: anon client receives 0 rows on select', async () => {
    if (!isDbAvailable || !anonClient) return;

    const { data, error } = await anonClient
      .from('user_spotify_connections')
      .select('*');

    // With RLS enabled and zero SELECT policies, anon sees 0 rows
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('enforces Zero-Client RLS: authenticated client cannot read token table directly', async () => {
    if (!isDbAvailable || !clientA || !adminClient || !userAId) return;

    const repo = new SupabaseSpotifyConnectionRepository(
      adminClient,
      TEST_ENCRYPTION_KEY,
    );

    // Save a connection via trusted backend service-role
    await repo.saveConnection({
      userId: userAId,
      spotifyAccountId: `spotify_acc_${Date.now()}`,
      accessToken: 'secret_access_token_123',
      refreshToken: 'secret_refresh_token_456',
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
      scopes: ['user-top-read'],
    });

    // Attempting direct select from clientA (even for their own user_id) returns 0 rows!
    const { data, error } = await clientA
      .from('user_spotify_connections')
      .select('*')
      .eq('user_id', userAId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('enforces Zero-Client RLS: authenticated client cannot insert directly into token table', async () => {
    if (!isDbAvailable || !clientA || !userAId) return;

    const { error } = await clientA.from('user_spotify_connections').insert({
      user_id: userAId,
      spotify_account_id: 'malicious_insert',
      encrypted_access_token: 'dummy',
      encrypted_refresh_token: 'dummy',
      token_expires_at: new Date().toISOString(),
      reauthorization_deadline: new Date().toISOString(),
      scopes: ['user-top-read'],
    });

    // Direct insert by browser/client role must be rejected by RLS
    expect(error).not.toBeNull();
  });

  it('allows service-role repository to manage connection and encrypts tokens at rest', async () => {
    if (!isDbAvailable || !adminClient || !userAId) return;

    const repo = new SupabaseSpotifyConnectionRepository(
      adminClient,
      TEST_ENCRYPTION_KEY,
    );

    const spotifyAcc = `spotify_acc_enc_${Date.now()}`;
    await repo.saveConnection({
      userId: userAId,
      spotifyAccountId: spotifyAcc,
      accessToken: 'live_user_access_token_super_secret',
      refreshToken: 'live_user_refresh_token_super_secret',
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
      scopes: ['user-top-read'],
    });

    // Inspect database row directly via SQL/admin
    const { data: row } = await adminClient
      .from('user_spotify_connections')
      .select('*')
      .eq('user_id', userAId)
      .single();

    expect(row).toBeDefined();
    expect(row.encrypted_access_token).not.toBe(
      'live_user_access_token_super_secret',
    );
    expect(row.encrypted_refresh_token).not.toBe(
      'live_user_refresh_token_super_secret',
    );

    // Verify it is decryptable with the test key
    const decrypted = decryptSecret(
      row.encrypted_access_token,
      TEST_ENCRYPTION_KEY,
    );
    expect(decrypted).toBe('live_user_access_token_super_secret');

    // Verify repository returns decrypted tokens
    const tokens = await repo.getConnectionTokens(userAId);
    expect(tokens?.accessToken).toBe('live_user_access_token_super_secret');
    expect(tokens?.refreshToken).toBe('live_user_refresh_token_super_secret');
  });

  it('enforces 1-to-1 account conflict: duplicate spotify_account_id is rejected', async () => {
    if (!isDbAvailable || !adminClient || !userAId || !userBId) return;

    const repo = new SupabaseSpotifyConnectionRepository(
      adminClient,
      TEST_ENCRYPTION_KEY,
    );

    const sharedSpotifyAcc = `spotify_shared_${Date.now()}`;

    // User A connects Spotify account
    await repo.saveConnection({
      userId: userAId,
      spotifyAccountId: sharedSpotifyAcc,
      accessToken: 'token_a',
      refreshToken: 'refresh_a',
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
      scopes: ['user-top-read'],
    });

    // User B attempts to connect the same Spotify account
    await expect(
      repo.saveConnection({
        userId: userBId,
        spotifyAccountId: sharedSpotifyAcc,
        accessToken: 'token_b',
        refreshToken: 'refresh_b',
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
        scopes: ['user-top-read'],
      }),
    ).rejects.toThrow(SpotifyAccountConflictError);
  });

  it('reliably disconnects Spotify and purges encrypted credentials', async () => {
    if (!isDbAvailable || !adminClient || !userAId) return;

    const repo = new SupabaseSpotifyConnectionRepository(
      adminClient,
      TEST_ENCRYPTION_KEY,
    );

    await repo.saveConnection({
      userId: userAId,
      spotifyAccountId: `spotify_acc_disc_${Date.now()}`,
      accessToken: 'token_to_delete',
      refreshToken: 'refresh_to_delete',
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
      scopes: ['user-top-read'],
    });

    const beforeTokens = await repo.getConnectionTokens(userAId);
    expect(beforeTokens).not.toBeNull();

    // Disconnect
    const deleted = await repo.deleteConnection(userAId);
    expect(deleted).toBe(true);

    // Verify tokens and connection are purged
    const afterTokens = await repo.getConnectionTokens(userAId);
    expect(afterTokens).toBeNull();
    const afterConn = await repo.getConnection(userAId);
    expect(afterConn).toBeNull();

    // Direct database verification
    const { data: rows } = await adminClient
      .from('user_spotify_connections')
      .select('*')
      .eq('user_id', userAId);
    expect(rows).toEqual([]);
  });

  it('preserves user_artist_preferences across Spotify connection and disconnection', async () => {
    if (!isDbAvailable || !adminClient || !userAId) return;

    const repo = new SupabaseSpotifyConnectionRepository(
      adminClient,
      TEST_ENCRYPTION_KEY,
    );

    // 1. User has an explicit manual concert preference
    const artistName = 'The Cure';
    const normalizedName = 'the cure';
    const { data: pref, error: insertErr } = await adminClient
      .from('user_artist_preferences')
      .insert({
        user_id: userAId,
        artist_name: artistName,
        normalized_artist_name: normalizedName,
        preference_level: 'favorite',
      })
      .select()
      .single();

    expect(insertErr).toBeNull();
    expect(pref).toBeDefined();

    // 2. User connects Spotify
    await repo.saveConnection({
      userId: userAId,
      spotifyAccountId: `spotify_pref_test_${Date.now()}`,
      accessToken: 'token_pref_test',
      refreshToken: 'refresh_pref_test',
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
      scopes: ['user-top-read'],
    });

    // 3. User disconnects Spotify
    await repo.deleteConnection(userAId);

    // 4. Verify manual preference is intact and unaltered
    const { data: prefAfterDisconnect, error: fetchErr } = await adminClient
      .from('user_artist_preferences')
      .select('*')
      .eq('user_id', userAId);

    expect(fetchErr).toBeNull();
    expect(prefAfterDisconnect).toHaveLength(1);
    expect(prefAfterDisconnect![0].artist_name).toBe(artistName);
    expect(prefAfterDisconnect![0].preference_level).toBe('favorite');
  });

  it('enforces reauthorization deadline: transitions connection to expired', async () => {
    if (!isDbAvailable || !adminClient || !userAId) return;

    const repo = new SupabaseSpotifyConnectionRepository(
      adminClient,
      TEST_ENCRYPTION_KEY,
    );

    // Connection with deadline in the past
    await repo.saveConnection({
      userId: userAId,
      spotifyAccountId: `spotify_expired_test_${Date.now()}`,
      accessToken: 'token_expired',
      refreshToken: 'refresh_expired',
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      reauthorizationDeadline: new Date(Date.now() - 10000),
      scopes: ['user-top-read'],
    });

    await repo.updateStatus(userAId, 'expired');
    const conn = await repo.getConnection(userAId);
    expect(conn?.status).toBe('expired');
  });
});
