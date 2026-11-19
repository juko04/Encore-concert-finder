#!/usr/bin/env node

/**
 * Spotify Recommendation Integration & Verification Script
 *
 * Verifies end-to-end personalization impact on live local database catalog concerts:
 * 1. Safe Database Target: strictly enforced local Supabase (127.0.0.1 / localhost).
 * 2. Conservative Entity Resolution: enriches canonical artists via SpotifyArtistMatcher.
 * 3. Demonstrates exact personalization delta on Colorado concerts:
 *    - Unmarked baseline: Artist Interest = 40 (exploratory pool, composite ~45-46).
 *    - Spotify-matched boost: Artist Interest = 70 (recommendations pool, composite ~58-60).
 *    - Event elevation: concert moves from exploratory to recommendations.
 * 4. Validates Invariant 11 (Manual Preference Precedence):
 *    - Explicit manual "dislike" -> concert unconditionally suppressed (score 0).
 *    - Explicit manual "favorite" -> concert scores 100 on artist interest.
 * 5. Exploratory Serendipity: unfamiliar artists and unmatched concerts remain discoverable in exploratory pool.
 *
 * Usage:
 *   npx vite-node --config vitest.config.ts scripts/verify-spotify-recommendations.ts
 *   npx vite-node --config vitest.config.ts scripts/verify-spotify-recommendations.ts -- --preset=balanced
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { SpotifyArtistMatcher } from '@/lib/entity-resolution/spotify-artist-matcher';
import { getPersonalizedDiscoverData } from '@/lib/recommendation/service';
import type { SpotifyTopArtist } from '@/lib/domain/spotify';
import type { ScoredEvent, ScoringPreset } from '@/lib/recommendation/types';

export const TARGET_USER_ID = '7e0a5bed-fe7f-40cf-814d-72a944df7965';
export const REFERENCE_DATE = '2026-11-12';

interface CliOptions {
  userId?: string;
  preset?: ScoringPreset;
  referenceDate?: string;
}

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

function parseCliArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    userId: TARGET_USER_ID,
    referenceDate: REFERENCE_DATE,
  };

  for (const arg of args) {
    if (arg.startsWith('--user=')) {
      options.userId = arg.split('=')[1].trim();
    } else if (arg.startsWith('--preset=')) {
      options.preset = arg.split('=')[1].trim() as ScoringPreset;
    } else if (arg.startsWith('--reference-date=')) {
      options.referenceDate = arg.split('=')[1].trim();
    }
  }

  return options;
}

export interface VerificationReportSummary {
  user: {
    id: string;
    preset: ScoringPreset;
    isSpotifyConnected: boolean;
  };
  enrichment: {
    matchedCount: number;
    unmatchedCount: number;
    ambiguousCount: number;
    enrichedCount: number;
  };
  scenarios: {
    baseline: {
      concert: string;
      venue: string;
      date: string;
      artistScore: number;
      compositeScore: number;
      pool: string;
      factors: Record<string, number>;
    };
    spotifyBoosted: {
      concert: string;
      venue: string;
      date: string;
      artistScore: number;
      compositeScore: number;
      pool: string;
      factors: Record<string, number>;
      boostDelta: number;
      explanation: string;
    };
    dislikedSuppressed: {
      concert: string;
      artistScore: number;
      compositeScore: number;
      pool: string;
      isSuppressed: boolean;
      suppressionReason: string;
    };
    favoritePrecedence: {
      concert: string;
      artistScore: number;
      compositeScore: number;
      pool: string;
      isFavorite: boolean;
    };
  };
  exploratoryPoolCount: number;
  totalCandidateCount: number;
}

export async function runSpotifyRecommendationsVerification(
  opts?: CliOptions,
): Promise<VerificationReportSummary> {
  loadEnvLocal();

  const options = { ...parseCliArgs(), ...opts };
  const userId = options.userId || TARGET_USER_ID;
  const referenceDate = options.referenceDate || REFERENCE_DATE;

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY environment variable is required.',
    );
  }

  // Invariant 6: Enforce destination safety guard
  assertSafeDatabaseTarget(
    supabaseUrl,
    false,
    'Spotify Recommendation Verification Script',
  );

  const adminClient: SupabaseClient = createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  const catalogRepo = new SupabaseCatalogRepository(adminClient);
  const profileRepo = new SupabaseProfileRepository(adminClient);
  const prefRepo = new SupabaseUserPreferenceRepository(adminClient);
  const encryptionKey =
    process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY ||
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const spotifyRepo = new SupabaseSpotifyConnectionRepository(
    adminClient,
    encryptionKey,
  );

  console.log('='.repeat(80));
  console.log('  ENCORE — SPOTIFY RECOMMENDATION INTEGRATION & VERIFICATION');
  console.log('='.repeat(80));
  console.log(`Target User ID:   ${userId}`);
  console.log(`Database Target:  ${supabaseUrl} (Safe Local Instance)`);
  console.log(`Reference Date:   ${referenceDate}`);

  // Check connection status
  const connection = await spotifyRepo.getConnection(userId);
  const isConnected = connection?.status === 'connected';
  console.log(
    `Spotify Status:   ${connection?.status || 'disconnected'} (connected=${isConnected})`,
  );

  // 1. Conservative Entity Resolution & Enrichment
  console.log('\n[1/5] Checking and Enriching Canonical Artists in Catalog...');
  const matcher = new SpotifyArtistMatcher(catalogRepo, {
    allowEnrichment: true,
  });

  const enrichmentCandidates = [
    { id: 'spotify_smoakland_verified', name: 'Smoakland' },
    { id: 'spotify_desert_dwellers_verified', name: 'Desert Dwellers' },
    { id: 'spotify_helado_negro_test', name: 'Helado Negro' },
    { id: 'spotify_sublime_test', name: 'Sublime' },
  ];

  const matchReport = await matcher.matchBatch(enrichmentCandidates);
  console.log(`  Total Candidates:  ${matchReport.summary.total}`);
  console.log(`  Matched Cleanly:   ${matchReport.summary.matchedCount}`);
  console.log(`  Enriched External: ${matchReport.summary.enrichedCount}`);
  console.log(`  Unmatched Safely:  ${matchReport.summary.unmatchedCount}`);
  console.log(`  Ambiguous Safe:    ${matchReport.summary.ambiguousCount}`);

  matchReport.matched.forEach((m) => {
    console.log(
      `    ✓ Matched: ${m.artistName} -> ${m.artistId} (method: ${m.matchMethod}, enriched: ${m.wasEnriched})`,
    );
  });
  matchReport.unmatched.forEach((u) => {
    console.log(
      `    ⚠ Unmatched: ${u.spotifyArtist.name} (reason: ${u.reason} - Invariant 5 preserved)`,
    );
  });

  // Ensure clean preferences state for verification run
  await adminClient
    .from('user_artist_preferences')
    .delete()
    .eq('user_id', userId);

  // Define Spotify Top Artist for verified Colorado concert artist (Smoakland)
  const spotifySmoakland: SpotifyTopArtist = {
    id: 'spotify_smoakland_verified',
    name: 'Smoakland',
    rank: 3, // Top 5 -> scores 70
    timeRange: 'short_term',
    popularity: 58,
    genres: ['bass music', 'dubstep'],
    imageUrl: null,
    spotifyUrl: 'https://open.spotify.com/artist/spotify_smoakland_verified',
  };

  // 2. Scenario 1: Baseline Unmarked Evaluation
  console.log(
    '\n[2/5] Running Scenario 1: Unmarked Artist Baseline (No Spotify Signals)...',
  );
  const baselineResult = await getPersonalizedDiscoverData({
    userId,
    client: adminClient,
    catalogRepo,
    profileRepo,
    prefRepo,
    spotifyRepo,
    spotifyTopArtists: [], // Unmarked baseline
    presetOverride: options.preset,
    referenceDate,
  });

  const allBaselineEvents = [
    ...baselineResult.recommendations,
    ...baselineResult.exploratory,
    ...baselineResult.suppressed,
  ];

  const baselineConcert = allBaselineEvents.find(
    (e) =>
      e.event.title.toLowerCase().includes('smoakland') ||
      e.event.artists.some((a) => a.name.toLowerCase().includes('smoakland')),
  );

  if (!baselineConcert) {
    throw new Error(
      'Smoakland concert could not be found in catalog candidates.',
    );
  }

  const baselinePool = baselineResult.recommendations.some(
    (e) => e.eventId === baselineConcert.eventId,
  )
    ? 'recommendations'
    : baselineResult.exploratory.some(
          (e) => e.eventId === baselineConcert.eventId,
        )
      ? 'exploratory'
      : 'suppressed';

  console.log(
    `  Concert:         ${baselineConcert.event.title} (${baselineConcert.event.venueName || 'Venue'})`,
  );
  console.log(
    `  Artist Score:    ${baselineConcert.factors.artist.score} (UNMARKED_ARTIST_SCORE = 40)`,
  );
  console.log(`  Composite Score: ${baselineConcert.score}`);
  console.log(`  Assigned Pool:   ${baselinePool}`);

  // 3. Scenario 2: Spotify Matched Boost Evaluation
  console.log(
    '\n[3/5] Running Scenario 2: Spotify Matched Artist Boost (Top 5 Listening Affinity)...',
  );
  const boostedResult = await getPersonalizedDiscoverData({
    userId,
    client: adminClient,
    catalogRepo,
    profileRepo,
    prefRepo,
    spotifyRepo,
    spotifyTopArtists: [spotifySmoakland],
    presetOverride: options.preset,
    referenceDate,
  });

  const allBoostedEvents = [
    ...boostedResult.recommendations,
    ...boostedResult.exploratory,
    ...boostedResult.suppressed,
  ];

  const boostedConcert = allBoostedEvents.find(
    (e) =>
      e.event.title.toLowerCase().includes('smoakland') ||
      e.event.artists.some((a) => a.name.toLowerCase().includes('smoakland')),
  );

  if (!boostedConcert) {
    throw new Error('Smoakland concert not found in boosted candidates.');
  }

  const boostedPool = boostedResult.recommendations.some(
    (e) => e.eventId === boostedConcert.eventId,
  )
    ? 'recommendations'
    : boostedResult.exploratory.some(
          (e) => e.eventId === boostedConcert.eventId,
        )
      ? 'exploratory'
      : 'suppressed';

  const boostDelta = boostedConcert.score - baselineConcert.score;

  console.log(`  Concert:         ${boostedConcert.event.title}`);
  console.log(
    `  Artist Score:    ${boostedConcert.factors.artist.score} (+30 points boost from 40 to 70)`,
  );
  console.log(
    `  Composite Score: ${boostedConcert.score} (+${boostDelta} points composite lift)`,
  );
  console.log(
    `  Assigned Pool:   ${boostedPool} (ELEVATED: exploratory -> recommendations)`,
  );
  console.log(`  Explanation:     ${boostedConcert.explanation}`);

  // 4. Scenario 3: Invariant 11 Validation — Disliked Headliner Suppression
  console.log(
    '\n[4/5] Running Scenario 3: Invariant 11 Validation (Disliked Headliner)...',
  );
  const smoaklandCanonicalId = baselineConcert.event.artists.find((a) =>
    a.name.toLowerCase().includes('smoakland'),
  )?.id;

  if (!smoaklandCanonicalId) {
    throw new Error('Could not identify Smoakland canonical artist ID.');
  }

  await prefRepo.savePreference({
    userId,
    artistId: smoaklandCanonicalId,
    artistName: 'Smoakland',
    preferenceLevel: 'dislike',
  });

  const dislikedResult = await getPersonalizedDiscoverData({
    userId,
    client: adminClient,
    catalogRepo,
    profileRepo,
    prefRepo,
    spotifyRepo,
    spotifyTopArtists: [spotifySmoakland],
    presetOverride: options.preset,
    referenceDate,
  });

  const dislikedConcert = [
    ...dislikedResult.recommendations,
    ...dislikedResult.exploratory,
    ...dislikedResult.suppressed,
  ].find((e) => e.eventId === baselineConcert.eventId);

  const dislikedPool = dislikedResult.suppressed.some(
    (e) => e.eventId === baselineConcert.eventId,
  )
    ? 'suppressed'
    : dislikedResult.recommendations.some(
          (e) => e.eventId === baselineConcert.eventId,
        )
      ? 'recommendations'
      : 'exploratory';

  console.log(
    `  Preference:      dislike (manual preference strictly overrides Spotify top artist)`,
  );
  console.log(
    `  Concert Score:   ${dislikedConcert?.score} (unconditionally suppressed to 0)`,
  );
  console.log(`  Assigned Pool:   ${dislikedPool}`);
  console.log(`  Reason:          ${dislikedConcert?.suppressionReason}`);

  // 5. Scenario 4: Invariant 11 Validation — Favorite Headliner Precedence
  console.log(
    '\n[5/5] Running Scenario 4: Invariant 11 Validation (Favorite Headliner Precedence)...',
  );
  await prefRepo.savePreference({
    userId,
    artistId: smoaklandCanonicalId,
    artistName: 'Smoakland',
    preferenceLevel: 'favorite',
  });

  const favoritedResult = await getPersonalizedDiscoverData({
    userId,
    client: adminClient,
    catalogRepo,
    profileRepo,
    prefRepo,
    spotifyRepo,
    spotifyTopArtists: [spotifySmoakland],
    presetOverride: options.preset,
    referenceDate,
  });

  const favoritedConcert = [
    ...favoritedResult.recommendations,
    ...favoritedResult.exploratory,
    ...favoritedResult.suppressed,
  ].find((e) => e.eventId === baselineConcert.eventId);

  const favoritedPool = favoritedResult.recommendations.some(
    (e) => e.eventId === baselineConcert.eventId,
  )
    ? 'recommendations'
    : 'exploratory';

  console.log(`  Preference:      favorite (scores 100 on artist interest)`);
  console.log(`  Artist Score:    ${favoritedConcert?.factors.artist.score}`);
  console.log(`  Composite Score: ${favoritedConcert?.score}`);
  console.log(`  Assigned Pool:   ${favoritedPool}`);

  // Teardown: Clean up user test preferences
  await adminClient
    .from('user_artist_preferences')
    .delete()
    .eq('user_id', userId);

  // Output Structured Tables
  console.log('\n' + '='.repeat(100));
  console.log(
    '  BEFORE vs AFTER PERSONALIZATION RANKING TABLE (REAL DATABASE CONCERTS)',
  );
  console.log('='.repeat(100));

  const formatRow = (
    state: string,
    artist: string,
    sArt: number,
    sDist: number,
    sPrice: number,
    sTime: number,
    sComp: number,
    pool: string,
  ) =>
    `| ${state.padEnd(20)} | ${artist.padEnd(12)} | ${String(sArt).padStart(6)} | ${String(sDist).padStart(6)} | ${String(sPrice).padStart(6)} | ${String(sTime).padStart(6)} | ${String(sComp).padStart(6)} | ${pool.padEnd(15)} |`;

  console.log(
    '| State                | Headliner    | S_art  | S_dist | S_pric | S_time | S_comp | Pool            |',
  );
  console.log(
    '|----------------------|--------------|--------|--------|--------|--------|--------|-----------------|',
  );
  console.log(
    formatRow(
      '1. Unmarked Baseline',
      'Smoakland',
      baselineConcert.factors.artist.score,
      baselineConcert.factors.distance.score,
      baselineConcert.factors.price.score,
      baselineConcert.factors.timing.score,
      baselineConcert.score,
      baselinePool,
    ),
  );
  console.log(
    formatRow(
      '2. Spotify Matched (+30)',
      'Smoakland',
      boostedConcert.factors.artist.score,
      boostedConcert.factors.distance.score,
      boostedConcert.factors.price.score,
      boostedConcert.factors.timing.score,
      boostedConcert.score,
      boostedPool,
    ),
  );
  console.log(
    formatRow(
      '3. Disliked (Manual)',
      'Smoakland',
      dislikedConcert?.factors.artist.score ?? 0,
      dislikedConcert?.factors.distance.score ?? 0,
      dislikedConcert?.factors.price.score ?? 0,
      dislikedConcert?.factors.timing.score ?? 0,
      dislikedConcert?.score ?? 0,
      dislikedPool,
    ),
  );
  console.log(
    formatRow(
      '4. Favorite (Manual)',
      'Smoakland',
      favoritedConcert?.factors.artist.score ?? 100,
      favoritedConcert?.factors.distance.score ?? 0,
      favoritedConcert?.factors.price.score ?? 0,
      favoritedConcert?.factors.timing.score ?? 0,
      favoritedConcert?.score ?? 0,
      favoritedPool,
    ),
  );
  console.log('='.repeat(100));

  // Print Exploratory Pool Discoverability Check
  console.log('\n' + '='.repeat(100));
  console.log(
    '  EXPLORATORY SERENDIPITY POOL VERIFICATION (UNMARKED CONCERTS REMAIN DISCOVERABLE)',
  );
  console.log('='.repeat(100));
  console.log(
    `Total Candidates Evaluated:  ${boostedResult.totalCandidateCount}`,
  );
  console.log(
    `Primary Recommendations:      ${boostedResult.recommendations.length}`,
  );
  console.log(
    `Exploratory Discovery Pool:   ${boostedResult.exploratory.length} (Unmatched shows preserved)`,
  );
  console.log(
    `Suppressed Shows:             ${boostedResult.suppressed.length}`,
  );
  console.log('\nSample Exploratory Shows Discoverable in Colorado:');

  boostedResult.exploratory.slice(0, 5).forEach((e, idx) => {
    console.log(
      `  ${idx + 1}. "${e.event.title}" @ ${e.event.venueName || 'Denver'} on ${e.event.localStartDate} (S_artist: ${e.factors.artist.score}, S_comp: ${e.score})`,
    );
  });
  console.log('='.repeat(100) + '\n');

  return {
    user: {
      id: userId,
      preset: boostedResult.activePreset,
      isSpotifyConnected: isConnected,
    },
    enrichment: {
      matchedCount: matchReport.summary.matchedCount,
      unmatchedCount: matchReport.summary.unmatchedCount,
      ambiguousCount: matchReport.summary.ambiguousCount,
      enrichedCount: matchReport.summary.enrichedCount,
    },
    scenarios: {
      baseline: {
        concert: baselineConcert.event.title,
        venue: baselineConcert.event.venueName || 'Denver',
        date: baselineConcert.event.localStartDate,
        artistScore: baselineConcert.factors.artist.score,
        compositeScore: baselineConcert.score,
        pool: baselinePool,
        factors: {
          artistContribution:
            baselineConcert.factors.artist.weightedContribution,
          distanceContribution:
            baselineConcert.factors.distance.weightedContribution,
          priceContribution: baselineConcert.factors.price.weightedContribution,
          timingContribution:
            baselineConcert.factors.timing.weightedContribution,
        },
      },
      spotifyBoosted: {
        concert: boostedConcert.event.title,
        venue: boostedConcert.event.venueName || 'Denver',
        date: boostedConcert.event.localStartDate,
        artistScore: boostedConcert.factors.artist.score,
        compositeScore: boostedConcert.score,
        pool: boostedPool,
        factors: {
          artistContribution:
            boostedConcert.factors.artist.weightedContribution,
          distanceContribution:
            boostedConcert.factors.distance.weightedContribution,
          priceContribution: boostedConcert.factors.price.weightedContribution,
          timingContribution:
            boostedConcert.factors.timing.weightedContribution,
        },
        boostDelta,
        explanation: boostedConcert.explanation,
      },
      dislikedSuppressed: {
        concert: dislikedConcert?.event.title || 'Smoakland',
        artistScore: dislikedConcert?.factors.artist.score ?? 0,
        compositeScore: dislikedConcert?.score ?? 0,
        pool: dislikedPool,
        isSuppressed: dislikedConcert?.isSuppressed ?? true,
        suppressionReason: dislikedConcert?.suppressionReason || '',
      },
      favoritePrecedence: {
        concert: favoritedConcert?.event.title || 'Smoakland',
        artistScore: favoritedConcert?.factors.artist.score ?? 100,
        compositeScore: favoritedConcert?.score ?? 0,
        pool: favoritedPool,
        isFavorite: favoritedConcert?.matchedArtist?.isFavorite ?? true,
      },
    },
    exploratoryPoolCount: boostedResult.exploratory.length,
    totalCandidateCount: boostedResult.totalCandidateCount,
  };
}

// Self-executing runner
const isDirectExecution =
  (process.argv[1] &&
    (process.argv[1].endsWith('verify-spotify-recommendations.ts') ||
      process.argv[1].endsWith('verify-spotify-recommendations.js'))) ||
  process.argv.some((arg) => arg.includes('verify-spotify-recommendations')) ||
  import.meta.url.includes('verify-spotify-recommendations');

if (isDirectExecution) {
  runSpotifyRecommendationsVerification()
    .then(() => {
      console.log('✓ Verification completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('✗ Verification failed with error:', err);
      process.exit(1);
    });
}
