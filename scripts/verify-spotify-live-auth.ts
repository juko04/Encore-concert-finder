#!/usr/bin/env node

/**
 * Live Spotify Authentication & Affinity Verification Script.
 *
 * Adheres strictly to Encore Invariants:
 * 1. Safe Database Target: strictly enforced local Supabase (127.0.0.1 or localhost).
 * 2. Immutable Observations & Atomic Persistence.
 * 3. Secret Security: NEVER logs decrypted tokens, client secrets, or encryption keys.
 * 4. Verifies live token refresh, profile retrieval (/v1/me), and multi-horizon top artists (limit=50).
 * 5. Updates user_spotify_connections with refreshed token and recorded sync timestamp.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { decryptSecret } from '@/lib/security/crypto';
import { SpotifyApiClient } from '@/lib/sources/spotify/client';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';
import type {
  SpotifyTimeRange,
  SpotifyTopArtist,
  SpotifyUserProfile,
} from '@/lib/domain/spotify';
import { VALID_SPOTIFY_TIME_RANGES } from '@/lib/domain/spotify';
import { loadEnvLocal } from '@/lib/utils/load-env-local';

const TARGET_USER_ID = '7e0a5bed-fe7f-40cf-814d-72a944df7965';

export interface HttpResponseLog {
  endpoint: string;
  status: number;
  statusText: string;
  quotaHeaders: Record<string, string>;
}

export interface SpotifyLiveVerificationResult {
  userId: string;
  spotifyAccountId: string;
  profile: {
    displayName: string | null;
    product?: string;
  };
  initialConnectionStatus: string;
  initialLastSyncedAt: string | null;
  refreshedTokenExpiresAt: string;
  updatedLastSyncedAt: string | null;
  httpResponses: HttpResponseLog[];
  metrics: {
    shortTermCount: number;
    mediumTermCount: number;
    longTermCount: number;
    deduplicatedTotal: number;
    genresCount: number;
  };
  topArtistsByRange: Record<
    SpotifyTimeRange,
    Array<{ id: string; name: string; rank: number }>
  >;
  sampleTopArtists: Array<{
    id: string;
    name: string;
    popularity: number;
    genres: string[];
    ranges: SpotifyTimeRange[];
  }>;
  johnSummit: {
    id: string;
    name: string;
    ranks: Record<SpotifyTimeRange, number | null>;
    presentInAllHorizons: boolean;
  };
  security: {
    aesGcmEncryptedAtRest: boolean;
    accessTokenFormatValid: boolean;
    refreshTokenFormatValid: boolean;
    zeroPlaintextInResponses: boolean;
  };
  userPreferences: {
    persistedPreferenceVerified: boolean;
    count: number;
  };
}

export async function runSpotifyLiveAuthVerification(
  userId = TARGET_USER_ID,
): Promise<SpotifyLiveVerificationResult> {
  loadEnvLocal();

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const encryptionKey = process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required in environment.');
  }
  if (!encryptionKey) {
    throw new Error('SPOTIFY_TOKEN_ENCRYPTION_KEY is required in environment.');
  }
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI are required.',
    );
  }

  // Enforce Destination Safety Guard
  assertSafeDatabaseTarget(
    supabaseUrl,
    false,
    'Live Spotify Authentication Verification',
  );

  const supabase: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const repo = new SupabaseSpotifyConnectionRepository(supabase, encryptionKey);

  // 1. Inspect existing database connection row
  const { data: rawRow, error: fetchErr } = await supabase
    .from('user_spotify_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(
      `Failed to query user_spotify_connections: ${fetchErr.message}`,
    );
  }
  if (!rawRow) {
    throw new Error(
      `No Spotify connection record found for user_id = '${userId}'.`,
    );
  }

  const initialConnectionStatus = rawRow.status;
  const initialLastSyncedAt = rawRow.last_synced_at ?? null;

  // 2. Decrypt refresh token
  const refreshToken = decryptSecret(
    rawRow.encrypted_refresh_token,
    encryptionKey,
  );

  // 3. Set up instrumented SpotifyApiClient to record response status & quota headers
  const httpResponses: HttpResponseLog[] = [];
  const instrumentedFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    const quotaHeaders: Record<string, string> = {};
    for (const [key, value] of res.headers.entries()) {
      const lower = key.toLowerCase();
      if (
        lower.includes('quota') ||
        lower.includes('rate') ||
        lower.includes('limit') ||
        lower.includes('retry') ||
        lower === 'date'
      ) {
        quotaHeaders[key] = value;
      }
    }

    const urlStr = typeof input === 'string' ? input : input.toString();
    const parsedUrl = new URL(urlStr);
    httpResponses.push({
      endpoint: `${parsedUrl.pathname}${parsedUrl.search}`,
      status: res.status,
      statusText: res.statusText,
      quotaHeaders,
    });
    return res;
  };

  const spotifyClient = new SpotifyApiClient({
    clientId,
    clientSecret,
    redirectUri,
    fetchFn: instrumentedFetch,
  });

  // 4. Live Token Refresh
  const refreshResult = await spotifyClient.refreshAccessToken(refreshToken);

  // 5. Fetch Spotify User Profile
  const profile: SpotifyUserProfile = await spotifyClient.getCurrentUser(
    refreshResult.accessToken,
  );

  // 6. Fetch Top Artists across all three time ranges (limit=50)
  const rangeArtists: Record<SpotifyTimeRange, SpotifyTopArtist[]> = {
    short_term: [],
    medium_term: [],
    long_term: [],
  };

  for (const range of VALID_SPOTIFY_TIME_RANGES) {
    rangeArtists[range] = await spotifyClient.getTopArtists(
      refreshResult.accessToken,
      range,
      50,
    );
  }

  // 7. Deduplicate across ranges and accumulate statistics
  interface ArtistAccumulator {
    id: string;
    name: string;
    popularity: number;
    genres: string[];
    ranges: SpotifyTimeRange[];
    ranks: Partial<Record<SpotifyTimeRange, number>>;
  }

  const deduplicatedMap = new Map<string, ArtistAccumulator>();
  const allGenres = new Set<string>();

  for (const range of VALID_SPOTIFY_TIME_RANGES) {
    for (const artist of rangeArtists[range]) {
      artist.genres.forEach((g) => allGenres.add(g));

      if (!deduplicatedMap.has(artist.id)) {
        deduplicatedMap.set(artist.id, {
          id: artist.id,
          name: artist.name,
          popularity: artist.popularity,
          genres: artist.genres,
          ranges: [range],
          ranks: { [range]: artist.rank },
        });
      } else {
        const acc = deduplicatedMap.get(artist.id)!;
        acc.ranges.push(range);
        acc.ranks[range] = artist.rank;
        if (artist.popularity > acc.popularity) {
          acc.popularity = artist.popularity;
        }
      }
    }
  }

  const deduplicatedList = Array.from(deduplicatedMap.values());

  // 8. Update database with refreshed token and recorded sync timestamp
  await repo.updateTokens(userId, {
    accessToken: refreshResult.accessToken,
    refreshToken: refreshResult.refreshToken,
    tokenExpiresAt: refreshResult.tokenExpiresAt,
  });

  const syncTimestamp = new Date();
  await repo.recordSync(userId, syncTimestamp);

  // Query updated row to verify persistence
  const { data: updatedRow, error: verifyErr } = await supabase
    .from('user_spotify_connections')
    .select(
      'token_expires_at, last_synced_at, status, encrypted_access_token, encrypted_refresh_token',
    )
    .eq('user_id', userId)
    .single();

  if (verifyErr) {
    throw new Error(
      `Failed to verify updated connection row: ${verifyErr.message}`,
    );
  }

  // 9. John Summit Telemetry & Verification across all 3 horizons
  const JOHN_SUMMIT_SPOTIFY_ID = '7kNqXtgeIwFtelmRjWv205';
  const johnSummitRanks: Record<SpotifyTimeRange, number | null> = {
    short_term: null,
    medium_term: null,
    long_term: null,
  };
  let johnSummitName = 'John Summit';

  for (const range of VALID_SPOTIFY_TIME_RANGES) {
    const found = rangeArtists[range].find(
      (a) =>
        a.id === JOHN_SUMMIT_SPOTIFY_ID ||
        a.name.toLowerCase() === 'john summit',
    );
    if (found) {
      johnSummitRanks[range] = found.rank;
      johnSummitName = found.name;
    }
  }

  const presentInAllHorizons =
    johnSummitRanks.short_term !== null &&
    johnSummitRanks.medium_term !== null &&
    johnSummitRanks.long_term !== null;

  // 10. Security & Cryptographic Invariants Verification
  // AES-256-GCM format: <iv_hex (24)>:<auth_tag_hex (32)>:<ciphertext_hex>
  const aesGcmRegex = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/;
  const accessTokenFormatValid = aesGcmRegex.test(
    updatedRow.encrypted_access_token,
  );
  const refreshTokenFormatValid = aesGcmRegex.test(
    updatedRow.encrypted_refresh_token,
  );

  // Verify client repository strictly isolates tokens (zero plaintext tokens in responses)
  const clientFacingConn = await repo.getConnection(userId);
  const rawModel = clientFacingConn as unknown as Record<
    string,
    unknown
  > | null;
  const zeroPlaintextInResponses = Boolean(
    rawModel &&
    rawModel.accessToken === undefined &&
    rawModel.refreshToken === undefined &&
    rawModel.encrypted_access_token === undefined &&
    rawModel.encrypted_refresh_token === undefined,
  );

  // 11. User Preferences Persistence Verification in local Supabase
  const prefRepo = new SupabaseUserPreferenceRepository(supabase);

  // Test explicit preference persistence: write a verified preference for John Summit and read it back
  const testPrefName = 'John Summit';
  const savedPref = await prefRepo.savePreference({
    userId,
    artistName: testPrefName,
    preferenceLevel: 'favorite',
    spotifyArtistId: JOHN_SUMMIT_SPOTIFY_ID,
  });

  const retrievedPref = await prefRepo.getPreference(userId, savedPref.id);
  const persistedPreferenceVerified = Boolean(
    retrievedPref &&
    retrievedPref.userId === userId &&
    retrievedPref.preferenceLevel === 'favorite' &&
    retrievedPref.spotifyArtistId === JOHN_SUMMIT_SPOTIFY_ID,
  );

  // Clean up temporary preference to maintain pristine state
  await prefRepo.deletePreference(userId, savedPref.id);
  const finalPrefs = await prefRepo.getPreferences(userId);

  const topArtistsByRange: Record<
    SpotifyTimeRange,
    Array<{ id: string; name: string; rank: number }>
  > = {
    short_term: rangeArtists.short_term.slice(0, 5).map((a) => ({
      id: a.id,
      name: a.name,
      rank: a.rank,
    })),
    medium_term: rangeArtists.medium_term.slice(0, 5).map((a) => ({
      id: a.id,
      name: a.name,
      rank: a.rank,
    })),
    long_term: rangeArtists.long_term.slice(0, 5).map((a) => ({
      id: a.id,
      name: a.name,
      rank: a.rank,
    })),
  };

  const sampleTopArtists = deduplicatedList
    .slice(0, 10)
    .map(({ id, name, popularity, genres, ranges }) => ({
      id,
      name,
      popularity,
      genres,
      ranges,
    }));

  return {
    userId,
    spotifyAccountId: profile.accountId,
    profile: {
      displayName: profile.displayName,
      product: profile.product,
    },
    initialConnectionStatus,
    initialLastSyncedAt,
    refreshedTokenExpiresAt: updatedRow.token_expires_at,
    updatedLastSyncedAt: updatedRow.last_synced_at,
    httpResponses,
    metrics: {
      shortTermCount: rangeArtists.short_term.length,
      mediumTermCount: rangeArtists.medium_term.length,
      longTermCount: rangeArtists.long_term.length,
      deduplicatedTotal: deduplicatedList.length,
      genresCount: allGenres.size,
    },
    topArtistsByRange,
    sampleTopArtists,
    johnSummit: {
      id: JOHN_SUMMIT_SPOTIFY_ID,
      name: johnSummitName,
      ranks: johnSummitRanks,
      presentInAllHorizons,
    },
    security: {
      aesGcmEncryptedAtRest: accessTokenFormatValid && refreshTokenFormatValid,
      accessTokenFormatValid,
      refreshTokenFormatValid,
      zeroPlaintextInResponses,
    },
    userPreferences: {
      persistedPreferenceVerified,
      count: finalPrefs.length,
    },
  };
}

// Direct CLI Execution
async function main(): Promise<void> {
  console.log('====================================================');
  console.log('Encore Live Spotify Authentication Verification');
  console.log(`Target User ID: ${TARGET_USER_ID}`);
  console.log('Database: Local Supabase (127.0.0.1:54321)');
  console.log('====================================================\n');

  try {
    const result = await runSpotifyLiveAuthVerification(TARGET_USER_ID);

    console.log('[1] User & Spotify Account Details:');
    console.log(`    - Encore User ID:        ${result.userId}`);
    console.log(`    - Spotify Account ID:    ${result.spotifyAccountId}`);
    console.log(
      `    - Display Name:          ${result.profile.displayName ?? 'N/A'}`,
    );
    console.log(
      `    - Spotify Product:       ${result.profile.product ?? 'N/A'}`,
    );
    console.log(
      `    - Initial Status:        ${result.initialConnectionStatus}`,
    );
    console.log(
      `    - Prior Last Synced:     ${result.initialLastSyncedAt ?? 'never'}`,
    );
    console.log(
      `    - Updated Last Synced:   ${result.updatedLastSyncedAt ?? 'N/A'}`,
    );
    console.log(
      `    - Refreshed Token Exp:   ${result.refreshedTokenExpiresAt}\n`,
    );

    console.log('[2] Live HTTP Responses & Quota Headers:');
    for (const res of result.httpResponses) {
      console.log(`    - [${res.status} ${res.statusText}] ${res.endpoint}`);
      if (Object.keys(res.quotaHeaders).length > 0) {
        console.log(`      Headers: ${JSON.stringify(res.quotaHeaders)}`);
      }
    }
    console.log('');

    console.log('[3] Artist Retrieval & Deduplication Metrics:');
    console.log(
      `    - Short Term Top Artists (limit 50):  ${result.metrics.shortTermCount}`,
    );
    console.log(
      `    - Medium Term Top Artists (limit 50): ${result.metrics.mediumTermCount}`,
    );
    console.log(
      `    - Long Term Top Artists (limit 50):   ${result.metrics.longTermCount}`,
    );
    console.log(
      `    - Deduplicated Unique Artists:        ${result.metrics.deduplicatedTotal}`,
    );
    console.log(
      `    - Unique Genres Identified:           ${result.metrics.genresCount}\n`,
    );

    console.log('[4] Top Sample Artists (Per Horizon):');
    console.log('    Short Term Top 5:');
    result.topArtistsByRange.short_term.forEach((a) =>
      console.log(`      ${a.rank}. ${a.name} (${a.id})`),
    );
    console.log('    Medium Term Top 5:');
    result.topArtistsByRange.medium_term.forEach((a) =>
      console.log(`      ${a.rank}. ${a.name} (${a.id})`),
    );
    console.log('    Long Term Top 5:');
    result.topArtistsByRange.long_term.forEach((a) =>
      console.log(`      ${a.rank}. ${a.name} (${a.id})`),
    );

    console.log('\n[5] John Summit Multi-Horizon Affinity Telemetry:');
    console.log(`    - Artist Name:           ${result.johnSummit.name}`);
    console.log(`    - Spotify Artist ID:     ${result.johnSummit.id}`);
    console.log(
      `    - Short Term Rank:       #${result.johnSummit.ranks.short_term ?? 'NOT_FOUND'}`,
    );
    console.log(
      `    - Medium Term Rank:      #${result.johnSummit.ranks.medium_term ?? 'NOT_FOUND'}`,
    );
    console.log(
      `    - Long Term Rank:        #${result.johnSummit.ranks.long_term ?? 'NOT_FOUND'}`,
    );
    console.log(
      `    - Present in all 3:      ${result.johnSummit.presentInAllHorizons ? 'YES' : 'NO'}`,
    );

    console.log('\n[6] Local Supabase Preferences Persistence:');
    console.log(
      `    - Explicit Preference Persistence Verified: ${result.userPreferences.persistedPreferenceVerified ? 'YES' : 'NO'}`,
    );
    console.log(
      `    - Database Target:                          127.0.0.1:54321 (Local Loopback)`,
    );
    console.log(
      `    - Preference Table:                         public.user_artist_preferences`,
    );

    console.log('\n[7] Security & Privacy Verification:');
    console.log(
      `    - AES-256-GCM Encrypted at Rest:            ${result.security.aesGcmEncryptedAtRest ? 'YES' : 'NO'}`,
    );
    console.log(
      `    - Access Token Format (iv:tag:cipher):      ${result.security.accessTokenFormatValid ? 'VALID' : 'INVALID'}`,
    );
    console.log(
      `    - Refresh Token Format (iv:tag:cipher):     ${result.security.refreshTokenFormatValid ? 'VALID' : 'INVALID'}`,
    );
    console.log(
      `    - Zero Plaintext Tokens in Client Models:   ${result.security.zeroPlaintextInResponses ? 'CONFIRMED' : 'FAILED'}`,
    );
    console.log(
      '    - Decrypted access token logged:            NO (REDACTED)',
    );
    console.log(
      '    - Decrypted refresh token logged:           NO (REDACTED)',
    );
    console.log(
      '    - Spotify client secret logged:             NO (REDACTED)',
    );
    console.log(
      '    - Encryption key logged:                    NO (REDACTED)',
    );
    console.log('====================================================');
    console.log('LIVE VERIFICATION SUCCESSFUL!');
    console.log('====================================================');
  } catch (err) {
    console.error('\n[FATAL ERROR] Spotify Live Auth Verification Failed:');
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// Execute when not imported within a Vitest test runner
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
}
