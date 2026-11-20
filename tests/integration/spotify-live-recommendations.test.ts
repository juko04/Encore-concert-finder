import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { SpotifyArtistMatcher } from '@/lib/entity-resolution/spotify-artist-matcher';
import { getPersonalizedDiscoverData } from '@/lib/recommendation/service';
import type { SpotifyTopArtist } from '@/lib/domain/spotify';
import { UNMARKED_ARTIST_SCORE } from '@/lib/recommendation/factors/artist-interest';

const TARGET_USER_ID = '7e0a5bed-fe7f-40cf-814d-72a944df7965';
const REFERENCE_DATE = '2026-11-12';

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

describe('PostgreSQL Integration: Live Spotify Recommendations & Invariant 11', () => {
  const credentials = resolveCredentials();
  let adminClient: SupabaseClient | null = null;
  let catalogRepo: SupabaseCatalogRepository;
  let profileRepo: SupabaseProfileRepository;
  let prefRepo: SupabaseUserPreferenceRepository;
  let spotifyRepo: SupabaseSpotifyConnectionRepository;

  let smoaklandCanonicalId: string;
  let desertDwellersCanonicalId: string;
  let smoaklandSpotifyId: string;
  let desertDwellersSpotifyId: string;
  let isLiveEnvironmentAvailable = false;

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
      'Integration test: spotify-live-recommendations',
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

    // Verify authorized Spotify user connection exists
    const connection = await spotifyRepo.getConnection(TARGET_USER_ID);
    if (!connection || connection.status !== 'connected') {
      console.warn(
        'Skipping spotify-live-recommendations.test.ts: No active Spotify connection found for TARGET_USER_ID.',
      );
      return;
    }

    // Retrieve canonical test artists
    const { data: artists, error: artErr } = await adminClient
      .from('artists')
      .select('id, name')
      .in('name', ['Smoakland', 'Desert Dwellers']);

    if (artErr || !artists || artists.length < 2) {
      console.warn(
        'Skipping spotify-live-recommendations.test.ts: Required test artists (Smoakland, Desert Dwellers) not found in catalog.',
      );
      return;
    }

    const smoakland = artists.find((a) => a.name === 'Smoakland');
    const desert = artists.find((a) => a.name === 'Desert Dwellers');

    if (!smoakland || !desert) {
      console.warn(
        'Skipping spotify-live-recommendations.test.ts: Required test artists not found in catalog.',
      );
      return;
    }

    isLiveEnvironmentAvailable = true;
    smoaklandCanonicalId = smoakland.id;
    desertDwellersCanonicalId = desert.id;

    // Resolve or establish verified Spotify external IDs
    const { data: existingExt } = await adminClient
      .from('artist_external_ids')
      .select('artist_id, external_id')
      .eq('provider', 'spotify');

    const smExt = existingExt?.find(
      (e) => e.artist_id === smoaklandCanonicalId,
    );
    const ddExt = existingExt?.find(
      (e) => e.artist_id === desertDwellersCanonicalId,
    );

    smoaklandSpotifyId = smExt?.external_id || 'spotify_smoakland_verified';
    desertDwellersSpotifyId =
      ddExt?.external_id || 'spotify_desert_dwellers_verified';

    // Clear any leftover preferences for the test user
    await adminClient
      .from('user_artist_preferences')
      .delete()
      .eq('user_id', TARGET_USER_ID);
  });

  afterEach(async () => {
    if (adminClient) {
      // Clean up test preferences after every scenario to prevent state leakage
      await adminClient
        .from('user_artist_preferences')
        .delete()
        .eq('user_id', TARGET_USER_ID);
    }
  });

  afterAll(async () => {
    if (adminClient) {
      await adminClient
        .from('user_artist_preferences')
        .delete()
        .eq('user_id', TARGET_USER_ID);
    }
  });

  it('Step 1: resolves and enriches canonical artists adhering strictly to Invariant 5', async () => {
    if (!adminClient || !isLiveEnvironmentAvailable) return;

    const matcher = new SpotifyArtistMatcher(catalogRepo, {
      allowEnrichment: true,
    });

    const candidates = [
      { id: smoaklandSpotifyId, name: 'Smoakland' },
      { id: desertDwellersSpotifyId, name: 'Desert Dwellers' },
      { id: 'spotify_helado_negro_unmatched', name: 'Helado Negro' },
      { id: 'spotify_sublime_unmatched', name: 'Sublime' },
    ];

    const report = await matcher.matchBatch(candidates);

    expect(report.summary.total).toBe(4);
    // Smoakland and Desert Dwellers match clean canonical artists
    expect(report.summary.matchedCount).toBe(2);
    expect(report.matched.map((m) => m.artistId)).toContain(
      smoaklandCanonicalId,
    );
    expect(report.matched.map((m) => m.artistId)).toContain(
      desertDwellersCanonicalId,
    );

    // Invariant 5: Helado Negro and Sublime are safely unmatched (no fuzzy corruption)
    expect(report.summary.unmatchedCount).toBe(2);
    const unmatchedNames = report.unmatched.map((u) => u.spotifyArtist.name);
    expect(unmatchedNames).toContain('Helado Negro');
    expect(unmatchedNames).toContain('Sublime');
    expect(report.summary.ambiguousCount).toBe(0);

    // Verify external IDs in database
    const { data: extRecords } = await adminClient
      .from('artist_external_ids')
      .select('*')
      .eq('provider', 'spotify')
      .in('artist_id', [smoaklandCanonicalId, desertDwellersCanonicalId]);

    expect(extRecords).toBeDefined();
    expect(extRecords!.length).toBeGreaterThanOrEqual(2);
  });

  it('Step 2: evaluates unmarked baseline concert at Artist Interest = 40 in exploratory pool', async () => {
    if (!adminClient || !isLiveEnvironmentAvailable) return;

    // Execute personalized discover without Spotify top artists or manual preferences
    const result = await getPersonalizedDiscoverData({
      userId: TARGET_USER_ID,
      client: adminClient,
      catalogRepo,
      profileRepo,
      prefRepo,
      spotifyRepo,
      spotifyTopArtists: [],
      referenceDate: REFERENCE_DATE,
    });

    const allEvents = [
      ...result.recommendations,
      ...result.exploratory,
      ...result.suppressed,
    ];

    const smoaklandEvent = allEvents.find(
      (e) =>
        e.event.title.toLowerCase().includes('smoakland') ||
        e.event.artists.some((a) => a.id === smoaklandCanonicalId),
    );

    expect(smoaklandEvent).toBeDefined();
    // Baseline artist interest factor must equal UNMARKED_ARTIST_SCORE (40)
    expect(smoaklandEvent!.factors.artist.score).toBe(UNMARKED_ARTIST_SCORE);
    expect(smoaklandEvent!.isExploratory).toBe(true);
    expect(smoaklandEvent!.isSuppressed).toBe(false);

    // Must be assigned to exploratory pool, not recommendations
    expect(
      result.exploratory.some((e) => e.eventId === smoaklandEvent!.eventId),
    ).toBe(true);
    expect(
      result.recommendations.some((e) => e.eventId === smoaklandEvent!.eventId),
    ).toBe(false);
  });

  it('Step 3: applies +30 Spotify boost (Artist Interest = 70) and elevates concert to recommendations', async () => {
    if (!adminClient || !isLiveEnvironmentAvailable) return;

    const spotifySmoakland: SpotifyTopArtist = {
      id: smoaklandSpotifyId,
      canonicalArtistId: smoaklandCanonicalId,
      name: 'Smoakland',
      rank: 3, // Top 5 listening tier -> 70 points
      timeRange: 'short_term',
      popularity: 60,
      genres: ['bass music'],
      imageUrl: null,
      spotifyUrl: `https://open.spotify.com/artist/${smoaklandSpotifyId}`,
    };

    const boostedResult = await getPersonalizedDiscoverData({
      userId: TARGET_USER_ID,
      client: adminClient,
      catalogRepo,
      profileRepo,
      prefRepo,
      spotifyRepo,
      spotifyTopArtists: [spotifySmoakland],
      referenceDate: REFERENCE_DATE,
    });

    const boostedEvent = [
      ...boostedResult.recommendations,
      ...boostedResult.exploratory,
      ...boostedResult.suppressed,
    ].find((e) => e.event.artists.some((a) => a.id === smoaklandCanonicalId));

    expect(boostedEvent).toBeDefined();

    // Verification of exact factor score boost
    expect(boostedEvent!.factors.artist.score).toBe(70);
    expect(boostedEvent!.factors.artist.isAvailable).toBe(true);
    expect(boostedEvent!.isExploratory).toBe(false);
    expect(boostedEvent!.isSuppressed).toBe(false);

    // Verification of elevation: moved from exploratory to primary recommendations
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

    // Transparent attribution explanation
    expect(boostedEvent!.explanation).toContain('Spotify top artist (#3)');
    expect(boostedEvent!.explanation).toContain('Smoakland');
  });

  it('Step 4: validates Invariant 11 — explicit manual "dislike" unconditionally suppresses event to score 0', async () => {
    if (!adminClient || !isLiveEnvironmentAvailable) return;

    const spotifySmoakland: SpotifyTopArtist = {
      id: smoaklandSpotifyId,
      canonicalArtistId: smoaklandCanonicalId,
      name: 'Smoakland',
      rank: 1, // User's #1 most-listened artist on Spotify
      timeRange: 'short_term',
      popularity: 80,
      genres: ['bass music'],
      imageUrl: null,
      spotifyUrl: `https://open.spotify.com/artist/${smoaklandSpotifyId}`,
    };

    // Explicit manual dislike on headliner
    await prefRepo.savePreference({
      userId: TARGET_USER_ID,
      artistId: smoaklandCanonicalId,
      artistName: 'Smoakland',
      preferenceLevel: 'dislike',
    });

    const dislikedResult = await getPersonalizedDiscoverData({
      userId: TARGET_USER_ID,
      client: adminClient,
      catalogRepo,
      profileRepo,
      prefRepo,
      spotifyRepo,
      spotifyTopArtists: [spotifySmoakland],
      referenceDate: REFERENCE_DATE,
    });

    const suppressedEvent = [
      ...dislikedResult.recommendations,
      ...dislikedResult.exploratory,
      ...dislikedResult.suppressed,
    ].find((e) => e.event.artists.some((a) => a.id === smoaklandCanonicalId));

    expect(suppressedEvent).toBeDefined();

    // Invariant 11: Manual preference unconditionally suppresses event regardless of Spotify rank 1
    expect(suppressedEvent!.score).toBe(0);
    expect(suppressedEvent!.factors.artist.score).toBe(0);
    expect(suppressedEvent!.isSuppressed).toBe(true);
    expect(suppressedEvent!.suppressionReason).toContain(
      "Headliner 'Smoakland' is marked Not Interested",
    );

    // Must be in suppressed pool; NEVER in recommendations or exploratory
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

  it('Step 5: validates Invariant 11 — explicit manual "favorite" scores 100 on artist interest', async () => {
    if (!adminClient || !isLiveEnvironmentAvailable) return;

    const spotifySmoakland: SpotifyTopArtist = {
      id: smoaklandSpotifyId,
      canonicalArtistId: smoaklandCanonicalId,
      name: 'Smoakland',
      rank: 15, // Rank 15 Spotify score would normally be 60
      timeRange: 'short_term',
      popularity: 55,
      genres: ['bass music'],
      imageUrl: null,
      spotifyUrl: `https://open.spotify.com/artist/${smoaklandSpotifyId}`,
    };

    // Explicit manual favorite
    await prefRepo.savePreference({
      userId: TARGET_USER_ID,
      artistId: smoaklandCanonicalId,
      artistName: 'Smoakland',
      preferenceLevel: 'favorite',
    });

    const favoriteResult = await getPersonalizedDiscoverData({
      userId: TARGET_USER_ID,
      client: adminClient,
      catalogRepo,
      profileRepo,
      prefRepo,
      spotifyRepo,
      spotifyTopArtists: [spotifySmoakland],
      referenceDate: REFERENCE_DATE,
    });

    const favoriteEvent = favoriteResult.recommendations.find((e) =>
      e.event.artists.some((a) => a.id === smoaklandCanonicalId),
    );

    expect(favoriteEvent).toBeDefined();
    // Manual favorite takes precedence: artist score = 100 (overriding Spotify rank 15 = 60)
    expect(favoriteEvent!.factors.artist.score).toBe(100);
    expect(favoriteEvent!.matchedArtist?.isFavorite).toBe(true);
    expect(favoriteEvent!.explanation).toContain('Favorite artist (Smoakland)');
  });

  it('Step 6: verifies tiered Spotify scoring (Top 6-10 -> 65 points) on Desert Dwellers', async () => {
    if (!adminClient || !isLiveEnvironmentAvailable) return;

    const spotifyDesert: SpotifyTopArtist = {
      id: desertDwellersSpotifyId,
      canonicalArtistId: desertDwellersCanonicalId,
      name: 'Desert Dwellers',
      rank: 8, // Top 6-10 tier -> 65 points
      timeRange: 'medium_term',
      popularity: 52,
      genres: ['tribal ambient'],
      imageUrl: null,
      spotifyUrl: `https://open.spotify.com/artist/${desertDwellersSpotifyId}`,
    };

    const result = await getPersonalizedDiscoverData({
      userId: TARGET_USER_ID,
      client: adminClient,
      catalogRepo,
      profileRepo,
      prefRepo,
      spotifyRepo,
      spotifyTopArtists: [spotifyDesert],
      referenceDate: REFERENCE_DATE,
    });

    const desertEvent = result.recommendations.find((e) =>
      e.event.artists.some((a) => a.id === desertDwellersCanonicalId),
    );

    expect(desertEvent).toBeDefined();
    expect(desertEvent!.factors.artist.score).toBe(65);
    expect(desertEvent!.isExploratory).toBe(false);
    expect(desertEvent!.explanation).toContain('Spotify top artist (#8)');
  });

  it('Step 7: preserves exploratory serendipity — unfamiliar artists remain discoverable in exploratory pool', async () => {
    if (!adminClient || !isLiveEnvironmentAvailable) return;

    const spotifySmoakland: SpotifyTopArtist = {
      id: smoaklandSpotifyId,
      canonicalArtistId: smoaklandCanonicalId,
      name: 'Smoakland',
      rank: 2,
      timeRange: 'short_term',
      popularity: 60,
      genres: ['bass music'],
      imageUrl: null,
      spotifyUrl: `https://open.spotify.com/artist/${smoaklandSpotifyId}`,
    };

    const result = await getPersonalizedDiscoverData({
      userId: TARGET_USER_ID,
      client: adminClient,
      catalogRepo,
      profileRepo,
      prefRepo,
      spotifyRepo,
      spotifyTopArtists: [spotifySmoakland],
      referenceDate: REFERENCE_DATE,
    });

    // Exploratory pool must preserve general catalog concerts
    expect(result.exploratory.length).toBeGreaterThan(0);

    for (const expEvent of result.exploratory.slice(0, 10)) {
      expect(expEvent.isExploratory).toBe(true);
      expect(expEvent.isSuppressed).toBe(false);
      expect(expEvent.factors.artist.score).toBe(UNMARKED_ARTIST_SCORE);
    }
  });

  it('Step 8: enforces destination guard against non-local and production URLs', () => {
    expect(() => {
      assertSafeDatabaseTarget(
        'https://app.supabase.co',
        false,
        'Integration security check',
      );
    }).toThrow(/not a verified local or development instance/);

    expect(() => {
      assertSafeDatabaseTarget(
        'http://evil-spoof-127.0.0.1.attacker.com',
        false,
        'Integration security check',
      );
    }).toThrow(/not a verified local or development instance/);
  });
});
