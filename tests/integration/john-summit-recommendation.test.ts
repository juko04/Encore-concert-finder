import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { getPersonalizedDiscoverData } from '@/lib/recommendation/service';
import type { SpotifyTopArtist } from '@/lib/domain/spotify';
import { UNMARKED_ARTIST_SCORE } from '@/lib/recommendation/factors/artist-interest';
import {
  seedJohnSummitFixture,
  JOHN_SUMMIT_ARTIST_NAME,
  JOHN_SUMMIT_SPOTIFY_ID,
  SYNTHETIC_EVENT_TITLE,
  SYNTHETIC_SOURCE_SLUG,
  type SeedResult,
} from '@/scripts/seed-john-summit-fixture';
import { cleanupJohnSummitFixture } from '@/scripts/cleanup-john-summit-fixture';

const TARGET_USER_ID = '7e0a5bed-fe7f-40cf-814d-72a944df7965';
const REFERENCE_DATE = '2026-11-20';

interface LocalCredentials {
  url: string;
  serviceRoleKey: string;
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

function resolveCredentials(): LocalCredentials | null {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && serviceRoleKey) {
    return { url, serviceRoleKey };
  }
  return null;
}

describe('PostgreSQL Integration: John Summit Synthetic Fixture End-to-End Recommendation', () => {
  const credentials = resolveCredentials();
  let adminClient: SupabaseClient | null = null;
  let catalogRepo: SupabaseCatalogRepository;
  let profileRepo: SupabaseProfileRepository;
  let prefRepo: SupabaseUserPreferenceRepository;
  let spotifyRepo: SupabaseSpotifyConnectionRepository;

  let seedResult: SeedResult;
  let originalProfilePreset: string | null = null;

  beforeAll(async () => {
    if (!credentials) {
      if (process.env.CI) {
        throw new Error(
          'Supabase integration credentials could not be resolved in CI.',
        );
      }
      return;
    }

    // Invariant 6: Strictly enforce local database destination
    assertSafeDatabaseTarget(
      credentials.url,
      false,
      'Integration test: john-summit-recommendation',
    );

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    catalogRepo = new SupabaseCatalogRepository(adminClient);
    profileRepo = new SupabaseProfileRepository(adminClient);
    prefRepo = new SupabaseUserPreferenceRepository(adminClient);
    const encryptionKey =
      process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY ||
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    spotifyRepo = new SupabaseSpotifyConnectionRepository(
      adminClient,
      encryptionKey,
    );

    // Save original profile recommendation preset
    const { data: profile } = await adminClient
      .from('profiles')
      .select('recommendation_preset')
      .eq('id', TARGET_USER_ID)
      .maybeSingle();

    originalProfilePreset = profile?.recommendation_preset ?? null;

    // Set profile preset to 'balanced' for standard 50/20/20/10 weighting
    await adminClient
      .from('profiles')
      .update({ recommendation_preset: 'balanced' })
      .eq('id', TARGET_USER_ID);

    // Seed the synthetic fixture idempotently
    seedResult = await seedJohnSummitFixture(adminClient);

    // Ensure clean preference state
    await adminClient
      .from('user_artist_preferences')
      .delete()
      .eq('user_id', TARGET_USER_ID);
  });

  afterEach(async () => {
    if (adminClient) {
      // Clean up test preferences after each scenario to prevent state leakage
      await adminClient
        .from('user_artist_preferences')
        .delete()
        .eq('user_id', TARGET_USER_ID);
    }
  });

  afterAll(async () => {
    if (adminClient) {
      // Restore profile preset
      if (originalProfilePreset) {
        await adminClient
          .from('profiles')
          .update({ recommendation_preset: originalProfilePreset })
          .eq('id', TARGET_USER_ID);
      }

      // Clear any remaining test preferences
      await adminClient
        .from('user_artist_preferences')
        .delete()
        .eq('user_id', TARGET_USER_ID);

      // Clean up synthetic fixture
      await cleanupJohnSummitFixture(adminClient);
    }
  });

  it('Step 1: evaluates unmarked baseline concert fixture at Artist Score = 40, Composite = 45.0 in exploratory pool', async () => {
    if (!adminClient) return;

    // Simulate baseline state where user has no active Spotify connection or signals
    const disconnectedSpotifyRepo = Object.create(
      spotifyRepo,
    ) as SupabaseSpotifyConnectionRepository;
    disconnectedSpotifyRepo.getConnection = async () => null;

    const result = await getPersonalizedDiscoverData({
      userId: TARGET_USER_ID,
      client: adminClient,
      catalogRepo,
      profileRepo,
      prefRepo,
      spotifyRepo: disconnectedSpotifyRepo,
      spotifyTopArtists: [], // No Spotify affinity
      presetOverride: 'balanced',
      referenceDate: REFERENCE_DATE,
    });

    const allEvents = [
      ...result.recommendations,
      ...result.exploratory,
      ...result.suppressed,
    ];

    const baselineEvent = allEvents.find(
      (e) => e.event.title === SYNTHETIC_EVENT_TITLE,
    );

    expect(baselineEvent).toBeDefined();

    // Baseline factor assertions
    expect(baselineEvent!.factors.artist.score).toBe(UNMARKED_ARTIST_SCORE); // 40
    expect(baselineEvent!.factors.artist.isAvailable).toBe(false);
    expect(baselineEvent!.factors.distance.score).toBe(50);
    expect(baselineEvent!.factors.price.score).toBe(50);
    expect(baselineEvent!.factors.timing.score).toBe(50);

    // Under balanced weights (50% artist, 20% dist, 20% price, 10% timing):
    // 40 * 0.5 + 50 * 0.2 + 50 * 0.2 + 50 * 0.1 = 20 + 10 + 10 + 5 = 45.0
    expect(baselineEvent!.score).toBe(45.0);
    expect(baselineEvent!.isExploratory).toBe(true);
    expect(baselineEvent!.isSuppressed).toBe(false);

    // Pool assignment: strictly in exploratory, NOT recommendations or suppressed
    expect(
      result.exploratory.some((e) => e.eventId === baselineEvent!.eventId),
    ).toBe(true);
    expect(
      result.recommendations.some((e) => e.eventId === baselineEvent!.eventId),
    ).toBe(false);
    expect(
      result.suppressed.some((e) => e.eventId === baselineEvent!.eventId),
    ).toBe(false);
  });

  it('Step 2: applies +30 Spotify affinity boost (Rank 1: Artist Score = 70, Composite = 60.0) elevating to recommendations pool', async () => {
    if (!adminClient) return;

    const spotifyJohnSummit: SpotifyTopArtist = {
      id: JOHN_SUMMIT_SPOTIFY_ID,
      canonicalArtistId: seedResult.artistId,
      name: JOHN_SUMMIT_ARTIST_NAME,
      rank: 1, // User's #1 Spotify listening tier -> 70 points
      timeRange: 'short_term',
      popularity: 85,
      genres: ['tech house', 'house'],
      imageUrl: null,
      spotifyUrl: `https://open.spotify.com/artist/${JOHN_SUMMIT_SPOTIFY_ID}`,
    };

    const boostedResult = await getPersonalizedDiscoverData({
      userId: TARGET_USER_ID,
      client: adminClient,
      catalogRepo,
      profileRepo,
      prefRepo,
      spotifyRepo,
      spotifyTopArtists: [spotifyJohnSummit],
      presetOverride: 'balanced',
      referenceDate: REFERENCE_DATE,
    });

    const boostedEvent = [
      ...boostedResult.recommendations,
      ...boostedResult.exploratory,
      ...boostedResult.suppressed,
    ].find((e) => e.event.title === SYNTHETIC_EVENT_TITLE);

    expect(boostedEvent).toBeDefined();

    // Verification of exact factor score boost: 40 -> 70 (+30 points)
    expect(boostedEvent!.factors.artist.score).toBe(70);
    expect(boostedEvent!.factors.artist.isAvailable).toBe(true);

    // Under balanced weights: 70 * 0.5 + 50 * 0.2 + 50 * 0.2 + 50 * 0.1 = 35 + 10 + 10 + 5 = 60.0
    expect(boostedEvent!.score).toBe(60.0);
    expect(boostedEvent!.isExploratory).toBe(false);
    expect(boostedEvent!.isSuppressed).toBe(false);

    // Pool assignment: elevated to primary recommendations, removed from exploratory
    expect(
      boostedResult.recommendations.some(
        (e) => e.eventId === boostedEvent!.eventId,
      ),
    ).toBe(true);
    expect(
      boostedResult.exploratory.some(
        (e) => e.eventId === boostedEvent!.eventId,
      ),
    ).toBe(false);
    expect(
      boostedResult.suppressed.some((e) => e.eventId === boostedEvent!.eventId),
    ).toBe(false);

    // Transparent attribution headline explanation
    expect(boostedEvent!.explanation).toContain('Spotify top artist (#1)');
    expect(boostedEvent!.explanation).toContain(JOHN_SUMMIT_ARTIST_NAME);
  });

  it('Step 3: validates Invariant 11 — explicit manual "dislike" unconditionally suppresses event (Score = 0, pool = suppressed)', async () => {
    if (!adminClient) return;

    const spotifyJohnSummit: SpotifyTopArtist = {
      id: JOHN_SUMMIT_SPOTIFY_ID,
      canonicalArtistId: seedResult.artistId,
      name: JOHN_SUMMIT_ARTIST_NAME,
      rank: 1, // User's #1 Spotify artist
      timeRange: 'short_term',
      popularity: 85,
      genres: ['tech house', 'house'],
      imageUrl: null,
      spotifyUrl: `https://open.spotify.com/artist/${JOHN_SUMMIT_SPOTIFY_ID}`,
    };

    // User explicitly dislikes the headliner
    await prefRepo.savePreference({
      userId: TARGET_USER_ID,
      artistId: seedResult.artistId,
      artistName: JOHN_SUMMIT_ARTIST_NAME,
      preferenceLevel: 'dislike',
    });

    const dislikedResult = await getPersonalizedDiscoverData({
      userId: TARGET_USER_ID,
      client: adminClient,
      catalogRepo,
      profileRepo,
      prefRepo,
      spotifyRepo,
      spotifyTopArtists: [spotifyJohnSummit],
      presetOverride: 'balanced',
      referenceDate: REFERENCE_DATE,
    });

    const suppressedEvent = [
      ...dislikedResult.recommendations,
      ...dislikedResult.exploratory,
      ...dislikedResult.suppressed,
    ].find((e) => e.event.title === SYNTHETIC_EVENT_TITLE);

    expect(suppressedEvent).toBeDefined();

    // Invariant 11: Explicit manual dislike overrides Spotify affinity
    expect(suppressedEvent!.score).toBe(0);
    expect(suppressedEvent!.factors.artist.score).toBe(0);
    expect(suppressedEvent!.isSuppressed).toBe(true);
    expect(suppressedEvent!.suppressionReason).toContain(
      `Headliner '${JOHN_SUMMIT_ARTIST_NAME}' is marked Not Interested`,
    );

    // Pool assignment: strictly in suppressed, NEVER in recommendations or exploratory
    expect(
      dislikedResult.suppressed.some(
        (e) => e.eventId === suppressedEvent!.eventId,
      ),
    ).toBe(true);
    expect(
      dislikedResult.recommendations.some(
        (e) => e.eventId === suppressedEvent!.eventId,
      ),
    ).toBe(false);
    expect(
      dislikedResult.exploratory.some(
        (e) => e.eventId === suppressedEvent!.eventId,
      ),
    ).toBe(false);
  });

  it('Step 4: validates Invariant 11 — explicit manual "favorite" overrides Spotify rank (Artist Score = 100, Composite = 75.0, pool = recommendations)', async () => {
    if (!adminClient) return;

    const spotifyJohnSummit: SpotifyTopArtist = {
      id: JOHN_SUMMIT_SPOTIFY_ID,
      canonicalArtistId: seedResult.artistId,
      name: JOHN_SUMMIT_ARTIST_NAME,
      rank: 1,
      timeRange: 'short_term',
      popularity: 85,
      genres: ['tech house', 'house'],
      imageUrl: null,
      spotifyUrl: `https://open.spotify.com/artist/${JOHN_SUMMIT_SPOTIFY_ID}`,
    };

    // User explicitly marks headliner as favorite
    await prefRepo.savePreference({
      userId: TARGET_USER_ID,
      artistId: seedResult.artistId,
      artistName: JOHN_SUMMIT_ARTIST_NAME,
      preferenceLevel: 'favorite',
    });

    const favoriteResult = await getPersonalizedDiscoverData({
      userId: TARGET_USER_ID,
      client: adminClient,
      catalogRepo,
      profileRepo,
      prefRepo,
      spotifyRepo,
      spotifyTopArtists: [spotifyJohnSummit],
      presetOverride: 'balanced',
      referenceDate: REFERENCE_DATE,
    });

    const favoriteEvent = [
      ...favoriteResult.recommendations,
      ...favoriteResult.exploratory,
      ...favoriteResult.suppressed,
    ].find((e) => e.event.title === SYNTHETIC_EVENT_TITLE);

    expect(favoriteEvent).toBeDefined();

    // Manual favorite takes precedence: artist score = 100
    expect(favoriteEvent!.factors.artist.score).toBe(100);

    // Under balanced weights: 100 * 0.5 + 50 * 0.2 + 50 * 0.2 + 50 * 0.1 = 50 + 10 + 10 + 5 = 75.0
    expect(favoriteEvent!.score).toBe(75.0);
    expect(favoriteEvent!.isSuppressed).toBe(false);
    expect(favoriteEvent!.isExploratory).toBe(false);
    expect(favoriteEvent!.matchedArtist?.isFavorite).toBe(true);

    // Pool assignment: recommendations pool
    expect(
      favoriteResult.recommendations.some(
        (e) => e.eventId === favoriteEvent!.eventId,
      ),
    ).toBe(true);
    expect(
      favoriteResult.exploratory.some(
        (e) => e.eventId === favoriteEvent!.eventId,
      ),
    ).toBe(false);
    expect(
      favoriteResult.suppressed.some(
        (e) => e.eventId === favoriteEvent!.eventId,
      ),
    ).toBe(false);

    expect(favoriteEvent!.explanation).toContain(
      `Favorite artist (${JOHN_SUMMIT_ARTIST_NAME})`,
    );
  });

  it('Step 5: cleans up synthetic fixture cleanly preserving genuine artists and venues', async () => {
    if (!adminClient) return;

    const cleanup = await cleanupJohnSummitFixture(adminClient);

    expect(cleanup.deletedEvents).toBeGreaterThanOrEqual(1);

    // Verify synthetic event is gone
    const { data: eventsAfter } = await adminClient
      .from('events')
      .select('id')
      .eq('name', SYNTHETIC_EVENT_TITLE);

    expect(eventsAfter).toHaveLength(0);

    // Verify synthetic source is gone
    const { data: sourceAfter } = await adminClient
      .from('sources')
      .select('id')
      .eq('slug', SYNTHETIC_SOURCE_SLUG);

    expect(sourceAfter).toHaveLength(0);

    // Invariant 12: Verify genuine artist John Summit is strictly preserved
    const { data: artistAfter } = await adminClient
      .from('artists')
      .select('id, name')
      .eq('id', seedResult.artistId)
      .maybeSingle();

    expect(artistAfter).not.toBeNull();
    expect(artistAfter?.name).toBe(JOHN_SUMMIT_ARTIST_NAME);

    // Verify artist external Spotify ID is strictly preserved
    const { data: extAfter } = await adminClient
      .from('artist_external_ids')
      .select('id, external_id')
      .eq('artist_id', seedResult.artistId)
      .eq('provider', 'spotify')
      .maybeSingle();

    expect(extAfter).not.toBeNull();
    expect(extAfter?.external_id).toBe(JOHN_SUMMIT_SPOTIFY_ID);

    // Verify genuine venue is strictly preserved
    const { data: venueAfter } = await adminClient
      .from('venues')
      .select('id, name')
      .eq('id', seedResult.venueId)
      .maybeSingle();

    expect(venueAfter).not.toBeNull();
  });
});
