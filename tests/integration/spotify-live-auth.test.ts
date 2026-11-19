import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { decryptSecret } from '@/lib/security/crypto';
import { SpotifyApiClient } from '@/lib/sources/spotify/client';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';
import {
  VALID_SPOTIFY_TIME_RANGES,
  type SpotifyTimeRange,
  type SpotifyTopArtist,
} from '@/lib/domain/spotify';

const TARGET_USER_ID = '7e0a5bed-fe7f-40cf-814d-72a944df7965';
const EXPECTED_SPOTIFY_ACCOUNT_ID = 'r7EWLiyMSu';
const JOHN_SUMMIT_SPOTIFY_ID = '7kNqXtgeIwFtelmRjWv205';

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

describe('Spotify Live Authentication & Data Retrieval Integration Test', () => {
  loadEnvLocal();

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const encryptionKey = process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  let supabase: SupabaseClient | null = null;
  let repo: SupabaseSpotifyConnectionRepository | null = null;
  let prefRepo: SupabaseUserPreferenceRepository | null = null;
  let isDbAvailable = false;

  beforeAll(async () => {
    if (!serviceRoleKey || !encryptionKey) {
      if (process.env.CI) {
        throw new Error('Required Supabase and encryption keys missing in CI.');
      }
      return;
    }

    if (!clientId || !clientSecret || !redirectUri) {
      if (process.env.CI) {
        throw new Error(
          'Required Spotify OAuth environment variables missing in CI.',
        );
      }
      return;
    }

    assertSafeDatabaseTarget(
      supabaseUrl,
      false,
      'Integration test spotify-live-auth.test.ts',
    );

    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: probeError } = await supabase
      .from('user_spotify_connections')
      .select('user_id')
      .limit(1);

    if (probeError) {
      if (process.env.CI) {
        throw new Error(
          `user_spotify_connections table probe failed: ${probeError.message}`,
        );
      }
      return;
    }

    isDbAvailable = true;
    repo = new SupabaseSpotifyConnectionRepository(supabase, encryptionKey);
    prefRepo = new SupabaseUserPreferenceRepository(supabase);
  });

  it('verifies target user has an active, validly encrypted Spotify connection row and enforces token security', async () => {
    if (!isDbAvailable || !supabase || !encryptionKey || !repo) {
      return;
    }

    const { data: row, error } = await supabase
      .from('user_spotify_connections')
      .select('*')
      .eq('user_id', TARGET_USER_ID)
      .maybeSingle();

    expect(error).toBeNull();
    expect(row).toBeDefined();
    if (!row) throw new Error('Expected row to be defined');

    expect(row.user_id).toBe(TARGET_USER_ID);
    expect(row.status).toBe('connected');
    expect(row.spotify_account_id).toBe(EXPECTED_SPOTIFY_ACCOUNT_ID);

    // Verify AES-256-GCM format: <iv_hex (24)>:<auth_tag_hex (32)>:<ciphertext_hex>
    expect(row.encrypted_access_token).toMatch(
      /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/,
    );
    expect(row.encrypted_refresh_token).toMatch(
      /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/,
    );

    // Verify token can be decrypted without error with valid key
    const decryptedRefresh = decryptSecret(
      row.encrypted_refresh_token,
      encryptionKey,
    );
    expect(typeof decryptedRefresh).toBe('string');
    expect(decryptedRefresh.length).toBeGreaterThan(10);

    // Verify tampered ciphertext throws decryption failure (AEAD integrity check)
    const tamperedPayload = `bad${row.encrypted_refresh_token.slice(3)}`;
    expect(() => decryptSecret(tamperedPayload, encryptionKey)).toThrow();

    // Verify zero plaintext tokens in client-facing models
    const clientConnection = await repo.getConnection(TARGET_USER_ID);
    expect(clientConnection).toBeDefined();
    expect(clientConnection!.userId).toBe(TARGET_USER_ID);
    expect(clientConnection!.spotifyAccountId).toBe(
      EXPECTED_SPOTIFY_ACCOUNT_ID,
    );

    const rawModel = clientConnection as unknown as Record<string, unknown>;
    expect(rawModel.accessToken).toBeUndefined();
    expect(rawModel.refreshToken).toBeUndefined();
    expect(rawModel.encrypted_access_token).toBeUndefined();
    expect(rawModel.encrypted_refresh_token).toBeUndefined();
  });

  it('refreshes Spotify access token using live OAuth endpoint and updates persistence in Supabase', async () => {
    if (
      !isDbAvailable ||
      !supabase ||
      !repo ||
      !encryptionKey ||
      !clientId ||
      !clientSecret ||
      !redirectUri
    ) {
      return;
    }

    const { data: initialRow } = await supabase
      .from('user_spotify_connections')
      .select('encrypted_refresh_token, last_synced_at')
      .eq('user_id', TARGET_USER_ID)
      .single();

    expect(initialRow).toBeDefined();
    if (!initialRow) throw new Error('Expected initialRow to be defined');

    const refreshToken = decryptSecret(
      initialRow.encrypted_refresh_token,
      encryptionKey,
    );

    const client = new SpotifyApiClient({
      clientId,
      clientSecret,
      redirectUri,
    });

    const refreshResult = await client.refreshAccessToken(refreshToken);
    expect(refreshResult.accessToken).toBeDefined();
    expect(typeof refreshResult.accessToken).toBe('string');
    expect(refreshResult.accessToken.length).toBeGreaterThan(20);
    expect(refreshResult.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now());

    // Update tokens and record sync in database
    await repo.updateTokens(TARGET_USER_ID, {
      accessToken: refreshResult.accessToken,
      refreshToken: refreshResult.refreshToken,
      tokenExpiresAt: refreshResult.tokenExpiresAt,
    });

    const syncTime = new Date();
    await repo.recordSync(TARGET_USER_ID, syncTime);

    // Verify updated database state
    const { data: updatedRow, error: updateErr } = await supabase
      .from('user_spotify_connections')
      .select('token_expires_at, last_synced_at, status')
      .eq('user_id', TARGET_USER_ID)
      .single();

    expect(updateErr).toBeNull();
    expect(updatedRow).toBeDefined();
    if (!updatedRow) throw new Error('Expected updatedRow to be defined');

    expect(updatedRow.status).toBe('connected');
    expect(new Date(updatedRow.token_expires_at).getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(updatedRow.last_synced_at).toBeDefined();
    expect(new Date(updatedRow.last_synced_at).getTime()).toBeCloseTo(
      syncTime.getTime(),
      -3, // within ~1-2 seconds
    );
  });

  it('retrieves live Spotify user profile matching stored account_id', async () => {
    if (
      !isDbAvailable ||
      !supabase ||
      !repo ||
      !clientId ||
      !clientSecret ||
      !redirectUri
    ) {
      return;
    }

    const tokens = await repo.getConnectionTokens(TARGET_USER_ID);
    expect(tokens).toBeDefined();
    expect(tokens!.accessToken).toBeDefined();

    const client = new SpotifyApiClient({
      clientId,
      clientSecret,
      redirectUri,
    });

    const profile = await client.getCurrentUser(tokens!.accessToken);
    expect(profile).toBeDefined();
    expect(profile.accountId).toBe(EXPECTED_SPOTIFY_ACCOUNT_ID);
    expect(profile.displayName).toBe('jkotara04');

    const connection = await repo.getConnection(TARGET_USER_ID);
    expect(connection).toBeDefined();
    expect(connection!.spotifyAccountId).toBe(profile.accountId);
  });

  it('retrieves real top artists across all 3 horizons (limit 50) and validates 102 unique deduplicated artists', async () => {
    if (!isDbAvailable || !repo || !clientId || !clientSecret || !redirectUri) {
      return;
    }

    const tokens = await repo.getConnectionTokens(TARGET_USER_ID);
    expect(tokens).toBeDefined();

    const client = new SpotifyApiClient({
      clientId,
      clientSecret,
      redirectUri,
    });

    const resultsByRange: Record<SpotifyTimeRange, SpotifyTopArtist[]> = {
      short_term: [],
      medium_term: [],
      long_term: [],
    };

    for (const range of VALID_SPOTIFY_TIME_RANGES) {
      const topArtists = await client.getTopArtists(
        tokens!.accessToken,
        range,
        50,
      );
      resultsByRange[range] = topArtists;
      expect(topArtists.length).toBe(50);

      // Verify artist shape
      for (const artist of topArtists) {
        expect(artist.id).toBeDefined();
        expect(typeof artist.id).toBe('string');
        expect(artist.name).toBeDefined();
        expect(typeof artist.name).toBe('string');
        expect(artist.rank).toBeGreaterThanOrEqual(1);
        expect(artist.spotifyUrl).toContain('spotify.com');
      }
    }

    // Deduplicate across all three time ranges
    const uniqueArtistMap = new Map<string, SpotifyTopArtist>();
    for (const range of VALID_SPOTIFY_TIME_RANGES) {
      resultsByRange[range].forEach((a) => uniqueArtistMap.set(a.id, a));
    }

    // Exactly 102 unique artists across 150 total records
    expect(uniqueArtistMap.size).toBe(102);
  });

  it('explicitly verifies John Summit presence, Spotify artist ID (7kNqXtgeIwFtelmRjWv205), and exact ranks across short, medium, and long term', async () => {
    if (!isDbAvailable || !repo || !clientId || !clientSecret || !redirectUri) {
      return;
    }

    const tokens = await repo.getConnectionTokens(TARGET_USER_ID);
    expect(tokens).toBeDefined();

    const client = new SpotifyApiClient({
      clientId,
      clientSecret,
      redirectUri,
    });

    const ranks: Partial<Record<SpotifyTimeRange, number>> = {};
    const artistIds: Partial<Record<SpotifyTimeRange, string>> = {};

    for (const range of VALID_SPOTIFY_TIME_RANGES) {
      const topArtists = await client.getTopArtists(
        tokens!.accessToken,
        range,
        50,
      );
      const summit = topArtists.find(
        (a) =>
          a.id === JOHN_SUMMIT_SPOTIFY_ID ||
          a.name.toLowerCase() === 'john summit',
      );

      expect(summit).toBeDefined();
      if (!summit) throw new Error(`John Summit not found in ${range}`);

      ranks[range] = summit.rank;
      artistIds[range] = summit.id;
    }

    // Verified Spotify Artist ID
    expect(artistIds.short_term).toBe(JOHN_SUMMIT_SPOTIFY_ID);
    expect(artistIds.medium_term).toBe(JOHN_SUMMIT_SPOTIFY_ID);
    expect(artistIds.long_term).toBe(JOHN_SUMMIT_SPOTIFY_ID);

    // Verified Exact/Near Ranks across Horizons:
    // Short Term:  #1
    // Medium Term: #2
    // Long Term:   Top 20 (dynamic live Spotify window, e.g. #18-#19)
    expect(ranks.short_term).toBe(1);
    expect(ranks.medium_term).toBe(2);
    expect(ranks.long_term).toBeGreaterThanOrEqual(1);
    expect(ranks.long_term).toBeLessThanOrEqual(25);
  });

  it('verifies user preferences persistence in local Supabase and isolation from Spotify tokens', async () => {
    if (!isDbAvailable || !supabase || !prefRepo || !repo) {
      return;
    }

    // 1. Save an explicit user preference in public.user_artist_preferences
    const savedPref = await prefRepo.savePreference({
      userId: TARGET_USER_ID,
      artistName: 'John Summit',
      preferenceLevel: 'favorite',
      spotifyArtistId: JOHN_SUMMIT_SPOTIFY_ID,
    });

    expect(savedPref).toBeDefined();
    expect(savedPref.id).toBeDefined();
    expect(savedPref.userId).toBe(TARGET_USER_ID);
    expect(savedPref.preferenceLevel).toBe('favorite');
    expect(savedPref.spotifyArtistId).toBe(JOHN_SUMMIT_SPOTIFY_ID);

    // 2. Query back directly from Supabase to confirm persistence in PostgreSQL
    const { data: dbRow, error: dbErr } = await supabase
      .from('user_artist_preferences')
      .select('*')
      .eq('id', savedPref.id)
      .eq('user_id', TARGET_USER_ID)
      .single();

    expect(dbErr).toBeNull();
    expect(dbRow).toBeDefined();
    expect(dbRow.preference_level).toBe('favorite');
    expect(dbRow.spotify_artist_id).toBe(JOHN_SUMMIT_SPOTIFY_ID);

    // 3. Confirm Spotify connection remains intact and isolated
    const connection = await repo.getConnection(TARGET_USER_ID);
    expect(connection).toBeDefined();
    expect(connection!.status).toBe('connected');

    // 4. Clean up test preference to restore clean database state
    const deleted = await prefRepo.deletePreference(
      TARGET_USER_ID,
      savedPref.id,
    );
    expect(deleted).toBe(true);

    const recheck = await prefRepo.getPreference(TARGET_USER_ID, savedPref.id);
    expect(recheck).toBeNull();
  });
});
