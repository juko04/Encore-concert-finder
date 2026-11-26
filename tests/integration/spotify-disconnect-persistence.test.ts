import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { SupabaseSpotifyAffinityRepository } from '@/lib/repositories/spotify-affinity-repository';

const TEST_ENCRYPTION_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

interface LocalCredentials {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

function resolveCredentials(): LocalCredentials | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && anonKey && serviceRoleKey) return { url, anonKey, serviceRoleKey };
  try {
    const parsed = JSON.parse(
      execSync('npx supabase status -o json', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    ) as { API_URL?: string; ANON_KEY?: string; SERVICE_ROLE_KEY?: string };
    if (parsed.API_URL && parsed.ANON_KEY && parsed.SERVICE_ROLE_KEY) {
      return {
        url: url || parsed.API_URL,
        anonKey: anonKey || parsed.ANON_KEY,
        serviceRoleKey: serviceRoleKey || parsed.SERVICE_ROLE_KEY,
      };
    }
  } catch {
    // CLI unavailable
  }
  return null;
}

describe('Spotify disconnect and account deletion persistence', () => {
  const credentials = resolveCredentials();
  let admin: SupabaseClient;
  let isDbAvailable = false;
  const createdUsers: string[] = [];

  async function makeUser(label: string): Promise<string> {
    const { data, error } = await admin.auth.admin.createUser({
      email: `spotify_persist_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`,
      password: 'TestPass123!Secure',
      email_confirm: true,
    });
    if (error || !data.user)
      throw new Error(`createUser failed: ${error?.message}`);
    createdUsers.push(data.user.id);
    return data.user.id;
  }

  async function seed(userId: string, spotifyAccountId: string) {
    const connRepo = new SupabaseSpotifyConnectionRepository(
      admin,
      TEST_ENCRYPTION_KEY,
    );
    await connRepo.saveConnection({
      userId,
      spotifyAccountId,
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      reauthorizationDeadline: new Date(Date.now() + 86400_000),
      scopes: ['user-top-read'],
    });
    const { error: prefErr } = await admin
      .from('user_artist_preferences')
      .insert({
        user_id: userId,
        artist_name: 'Imported Artist',
        normalized_artist_name: 'imported artist',
        preference_level: 'favorite',
        spotify_artist_id: `sp_${spotifyAccountId}`,
      });
    if (prefErr) throw new Error(prefErr.message);
    const affRepo = new SupabaseSpotifyAffinityRepository(admin);
    await affRepo.replaceAffinities(userId, [
      {
        id: `sp_${spotifyAccountId}`,
        name: 'Imported Artist',
        rank: 1,
        imageUrl: null,
        spotifyUrl: 'https://open.spotify.com/artist/x',
        genres: ['indie'],
        popularity: 70,
        timeRange: 'short_term',
        ranksByRange: { short_term: 1, long_term: 4 },
        affinity: 0.92,
        affinityReason: 'rising',
        trend: 'rising',
      },
    ]);
    return { connRepo, affRepo };
  }

  async function count(
    table: string,
    userId: string,
    column = 'user_id',
  ): Promise<number> {
    const { count: c, error } = await admin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, userId);
    if (error) throw new Error(`${table}: ${error.message}`);
    return c ?? 0;
  }

  beforeAll(async () => {
    if (!credentials) {
      if (process.env.CI)
        throw new Error('Supabase credentials unavailable in CI.');
      return;
    }
    assertSafeDatabaseTarget(
      credentials.url,
      false,
      'Integration suite testing Spotify disconnect persistence',
    );
    admin = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin
      .from('user_spotify_artist_affinities')
      .select('user_id')
      .limit(0);
    if (error) {
      if (process.env.CI)
        throw new Error(`affinities table probe failed: ${error.message}`);
      return;
    }
    isDbAvailable = true;
  });

  afterAll(async () => {
    if (!isDbAvailable) return;
    for (const id of createdUsers) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it('disconnect deletes tokens but keeps preferences and imported affinities', async () => {
    if (!isDbAvailable) return;
    const userId = await makeUser('disc');
    const { connRepo, affRepo } = await seed(userId, `acc_disc_${Date.now()}`);

    expect(await count('user_spotify_connections', userId)).toBe(1);

    expect(await connRepo.deleteConnection(userId)).toBe(true);

    expect(await count('user_spotify_connections', userId)).toBe(0);
    expect(await count('user_artist_preferences', userId)).toBe(1);
    const stored = await affRepo.getAffinities(userId);
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Imported Artist');
    expect(stored[0].affinity).toBeCloseTo(0.92);
    expect(stored[0].ranksByRange).toEqual({ short_term: 1, long_term: 4 });
    expect(stored[0].trend).toBe('rising');
  });

  it('expired/revoked status keeps stored affinities and preferences', async () => {
    if (!isDbAvailable) return;
    const userId = await makeUser('exp');
    const { connRepo, affRepo } = await seed(userId, `acc_exp_${Date.now()}`);

    await connRepo.updateStatus(userId, 'revoked');
    expect(await connRepo.getConnectionTokens(userId)).toBeNull();
    expect(await count('user_artist_preferences', userId)).toBe(1);
    expect(await affRepo.getAffinities(userId)).toHaveLength(1);
  });

  it('re-sync replaces and prunes stale affinities; empty sync never wipes', async () => {
    if (!isDbAvailable) return;
    const userId = await makeUser('sync');
    const { affRepo } = await seed(userId, `acc_sync_${Date.now()}`);
    const base = {
      imageUrl: null,
      spotifyUrl: '',
      genres: [],
      popularity: 1,
      timeRange: 'short_term' as const,
    };
    await affRepo.replaceAffinities(userId, [
      { ...base, id: 'new1', name: 'New One', rank: 1 },
    ]);
    const after = await affRepo.getAffinities(userId);
    expect(after.map((a) => a.id)).toEqual(['new1']);
    await affRepo.replaceAffinities(userId, []);
    expect(await affRepo.getAffinities(userId)).toHaveLength(1);
  });

  it('account deletion removes connections, preferences, and affinities', async () => {
    if (!isDbAvailable) return;
    const userId = await makeUser('del');
    await seed(userId, `acc_del_${Date.now()}`);
    await admin.from('profiles').upsert({ id: userId }, { onConflict: 'id' });

    expect(await count('user_spotify_connections', userId)).toBe(1);
    expect(await count('user_artist_preferences', userId)).toBe(1);
    expect(await count('user_spotify_artist_affinities', userId)).toBe(1);

    const { error } = await admin.auth.admin.deleteUser(userId);
    expect(error).toBeNull();
    createdUsers.splice(createdUsers.indexOf(userId), 1);

    expect(await count('user_spotify_connections', userId)).toBe(0);
    expect(await count('user_artist_preferences', userId)).toBe(0);
    expect(await count('user_spotify_artist_affinities', userId)).toBe(0);
    expect(await count('profiles', userId, 'id')).toBe(0);
  });

  it('RLS: another user cannot read stored affinities', async () => {
    if (!isDbAvailable || !credentials) return;
    const ownerId = await makeUser('own');
    await seed(ownerId, `acc_own_${Date.now()}`);
    const email = `spotify_persist_other_${Date.now()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!Secure',
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(error?.message);
    createdUsers.push(data.user.id);
    const other = createClient(credentials.url, credentials.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await other.auth.signInWithPassword({
      email,
      password: 'TestPass123!Secure',
    });
    const { data: rows } = await other
      .from('user_spotify_artist_affinities')
      .select('*');
    expect(rows).toEqual([]);
  });
});
