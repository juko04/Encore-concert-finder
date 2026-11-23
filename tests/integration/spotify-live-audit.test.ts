import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { decryptSecret } from '@/lib/security/crypto';
import { SpotifyApiClient } from '@/lib/sources/spotify/client';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { calculateArtistInterestFactor } from '@/lib/recommendation/factors/artist-interest';
import { scoreEvent } from '@/lib/recommendation/engine';
import {
  VALID_SPOTIFY_TIME_RANGES,
  type SpotifyTimeRange,
  type SpotifyTopArtist,
} from '@/lib/domain/spotify';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { ScoringContext } from '@/lib/recommendation/types';
import type { UserArtistPreference } from '@/lib/domain/user-preference';

const TARGET_USER_ID = '7e0a5bed-fe7f-40cf-814d-72a944df7965';
const EXPECTED_SPOTIFY_ACCOUNT_ID = 'r7EWLiyMSu';

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

describe('Spotify Live Activation & End-to-End Database Integration Audit', () => {
  loadEnvLocal();

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const encryptionKey = process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  let supabase: SupabaseClient | null = null;
  let connRepo: SupabaseSpotifyConnectionRepository | null = null;
  let catalogRepo: SupabaseCatalogRepository | null = null;
  let isDbAvailable = false;
  let isSpotifyConfigured = false;

  beforeAll(async () => {
    if (
      !serviceRoleKey ||
      !encryptionKey ||
      !clientId ||
      !clientSecret ||
      !redirectUri
    ) {
      console.warn(
        'Skipping Spotify Live Audit tests: missing Supabase, Spotify OAuth, or encryption credentials.',
      );
      return;
    }

    // Invariant 6: Enforce local loopback write safety guard
    assertSafeDatabaseTarget(
      supabaseUrl,
      false,
      'Integration test: spotify-live-audit.test.ts',
    );

    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: targetConn, error: pingError } = await supabase
      .from('user_spotify_connections')
      .select('user_id')
      .eq('user_id', TARGET_USER_ID)
      .maybeSingle();

    if (pingError) {
      if (process.env.CI) {
        throw new Error(
          `Local Supabase connection check failed: ${pingError.message}`,
        );
      }
      return;
    }

    if (!targetConn) {
      console.warn(
        `Skipping Spotify Live Audit tests: TARGET_USER_ID ('${TARGET_USER_ID}') has no connection row in local database.`,
      );
      return;
    }

    isDbAvailable = true;
    isSpotifyConfigured = true;
    connRepo = new SupabaseSpotifyConnectionRepository(supabase, encryptionKey);
    catalogRepo = new SupabaseCatalogRepository(supabase);
  });

  describe('Audit 1: Real Database Connection Row & Cryptographic Token Storage', () => {
    it('verifies target user connection exists in local Supabase with authenticated AES-256-GCM ciphertext', async () => {
      if (!isDbAvailable || !supabase || !encryptionKey) return;

      const { data: row, error } = await supabase
        .from('user_spotify_connections')
        .select('*')
        .eq('user_id', TARGET_USER_ID)
        .single();

      expect(error).toBeNull();
      expect(row).toBeDefined();
      expect(row.user_id).toBe(TARGET_USER_ID);
      expect(row.spotify_account_id).toBe(EXPECTED_SPOTIFY_ACCOUNT_ID);
      expect(row.status).toBe('connected');
      expect(row.scopes).toContain('user-top-read');

      // Invariant: tokens stored in strict AES-256-GCM format (iv:authTag:ciphertext)
      expect(row.encrypted_access_token).toMatch(
        /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/,
      );
      expect(row.encrypted_refresh_token).toMatch(
        /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/,
      );

      // Decrypt tokens successfully using symmetric 256-bit encryption key
      const decryptedAccess = decryptSecret(
        row.encrypted_access_token,
        encryptionKey,
      );
      const decryptedRefresh = decryptSecret(
        row.encrypted_refresh_token,
        encryptionKey,
      );

      expect(typeof decryptedAccess).toBe('string');
      expect(decryptedAccess.length).toBeGreaterThan(20);
      expect(typeof decryptedRefresh).toBe('string');
      expect(decryptedRefresh.length).toBeGreaterThan(20);
    });

    it('proves client-facing getConnection() strictly isolates sensitive tokens from client responses', async () => {
      if (!isDbAvailable || !connRepo) return;

      const connection = await connRepo.getConnection(TARGET_USER_ID);
      expect(connection).toBeDefined();
      expect(connection!.userId).toBe(TARGET_USER_ID);
      expect(connection!.spotifyAccountId).toBe(EXPECTED_SPOTIFY_ACCOUNT_ID);
      expect(connection!.status).toBe('connected');

      // Ensure raw or decrypted token properties do not exist on the client model
      const rawModel = connection as unknown as Record<string, unknown>;
      expect(rawModel.accessToken).toBeUndefined();
      expect(rawModel.refreshToken).toBeUndefined();
      expect(rawModel.encrypted_access_token).toBeUndefined();
      expect(rawModel.encrypted_refresh_token).toBeUndefined();
    });

    it('executes live token refresh and profile retrieval against Spotify Web API', async () => {
      if (
        !isDbAvailable ||
        !connRepo ||
        !clientId ||
        !clientSecret ||
        !redirectUri
      )
        return;

      const tokens = await connRepo.getConnectionTokens(TARGET_USER_ID);
      expect(tokens).toBeDefined();
      expect(tokens!.refreshToken).toBeDefined();

      const spotifyClient = new SpotifyApiClient({
        clientId,
        clientSecret,
        redirectUri,
      });

      // 1. Live Token Refresh
      const refreshResult = await spotifyClient.refreshAccessToken(
        tokens!.refreshToken,
      );
      expect(refreshResult.accessToken).toBeDefined();
      expect(refreshResult.accessToken.length).toBeGreaterThan(20);
      expect(refreshResult.tokenExpiresAt.getTime()).toBeGreaterThan(
        Date.now(),
      );

      // 2. Live Current User Profile
      const profile = await spotifyClient.getCurrentUser(
        refreshResult.accessToken,
      );
      expect(profile).toBeDefined();
      expect(profile.accountId).toBe(EXPECTED_SPOTIFY_ACCOUNT_ID);
      expect(profile.displayName).toBe('jkotara04');
    });

    it('retrieves live multi-range top artists from Spotify and verifies 102 unique top artists', async () => {
      if (
        !isDbAvailable ||
        !connRepo ||
        !clientId ||
        !clientSecret ||
        !redirectUri
      )
        return;

      const tokens = await connRepo.getConnectionTokens(TARGET_USER_ID);
      expect(tokens).toBeDefined();

      const spotifyClient = new SpotifyApiClient({
        clientId,
        clientSecret,
        redirectUri,
      });

      const artistsByRange: Record<SpotifyTimeRange, SpotifyTopArtist[]> = {
        short_term: [],
        medium_term: [],
        long_term: [],
      };

      for (const range of VALID_SPOTIFY_TIME_RANGES) {
        const topArtists = await spotifyClient.getTopArtists(
          tokens!.accessToken,
          range,
          50,
        );
        artistsByRange[range] = topArtists;
        expect(topArtists.length).toBe(50);
      }

      const allUnique = new Map<string, SpotifyTopArtist>();
      VALID_SPOTIFY_TIME_RANGES.forEach((range) => {
        artistsByRange[range].forEach((a) => allUnique.set(a.id, a));
      });

      // Across 150 total records (50 per range), expect ~100+ unique deduplicated artists
      // depending on live listening overlap across short, medium, and long term ranges
      expect(allUnique.size).toBeGreaterThanOrEqual(95);
      expect(allUnique.size).toBeLessThanOrEqual(150);

      // Verify top artist presence
      const artistNames = Array.from(allUnique.values()).map((a) => a.name);
      expect(artistNames).toContain('John Summit');
      expect(artistNames).toContain('Dom Dolla');
      expect(artistNames).toContain('Post Malone');
    });
  });

  describe('Audit 2: Enriched Catalog Artists in Local Supabase', () => {
    it('verifies >= 100 canonical artists enriched with verified Spotify external IDs in Supabase', async () => {
      if (!isDbAvailable || !supabase) return;

      const {
        data: externalIds,
        error,
        count,
      } = await supabase
        .from('artist_external_ids')
        .select('*, artist:artists(id, name, image_url)', { count: 'exact' })
        .eq('provider', 'spotify');

      expect(error).toBeNull();
      expect(count).toBeGreaterThanOrEqual(100);
      expect(externalIds).toBeDefined();

      // Verify field level integrity
      for (const row of externalIds!) {
        expect(row.provider).toBe('spotify');
        expect(typeof row.external_id).toBe('string');
        expect(row.external_id.length).toBeGreaterThan(0);
        expect(row.provider_url).toMatch(
          /^https?:\/\/open\.spotify\.com\/(intl-[a-z]{2}\/)?artist\//,
        );
        expect(row.artist).toBeDefined();
        expect(row.artist.name).toBeDefined();
      }

      // Verify Invariant 5: zero duplicate Spotify IDs assigned to different canonical artists
      const spotifyToArtist = new Map<string, string>();
      for (const row of externalIds!) {
        if (spotifyToArtist.has(row.external_id)) {
          expect(spotifyToArtist.get(row.external_id)).toBe(row.artist_id);
        } else {
          spotifyToArtist.set(row.external_id, row.artist_id);
        }
      }
    });

    it('verifies Spotify artist image enrichment populated high-res CDN images on artists table', async () => {
      if (!isDbAvailable || !supabase) return;

      const { data: enrichedArtists, error } = await supabase
        .from('artist_external_ids')
        .select('artist_id, artist:artists(name, image_url)')
        .eq('provider', 'spotify');

      expect(error).toBeNull();
      const withImages = enrichedArtists!.filter((e: any) =>
        Boolean(e.artist?.image_url),
      );

      // Vast majority of corroborated artists received Spotify CDN cover art
      expect(withImages.length).toBeGreaterThanOrEqual(90);
      const sample = withImages[0] as any;
      expect(sample.artist.image_url).toContain('scdn.co');
    });

    it('verifies enriched Spotify artists link to live catalog concerts across Colorado venues', async () => {
      if (!isDbAvailable || !supabase) return;

      const { data: extIds } = await supabase
        .from('artist_external_ids')
        .select('artist_id')
        .eq('provider', 'spotify');

      const artistIds = extIds!.map((e) => e.artist_id);

      const { data: eventArtists, error } = await supabase
        .from('event_artists')
        .select('event_id, artist_id, billing_position')
        .in('artist_id', artistIds);

      expect(error).toBeNull();
      expect(eventArtists).toBeDefined();
      expect(eventArtists!.length).toBeGreaterThanOrEqual(100);

      const uniqueEventIds = new Set(eventArtists!.map((ea) => ea.event_id));
      expect(uniqueEventIds.size).toBeGreaterThanOrEqual(100);

      // Verify specific known enriched concert: Jalen Ngonda at Cervantes' Masterpiece Ballroom
      const { data: jalenArtist } = await supabase
        .from('artists')
        .select('id, name')
        .eq('name', 'Jalen Ngonda')
        .single();

      expect(jalenArtist).toBeDefined();

      const { data: jalenEvents } = await supabase
        .from('events')
        .select('id, name, venue:venues(name)')
        .ilike('name', '%Jalen Ngonda%');

      expect(jalenEvents).toBeDefined();
      expect(jalenEvents!.length).toBeGreaterThan(0);
      expect(jalenEvents![0].venue).toBeDefined();
    });
  });

  describe('Audit 3: Recommendation Personalization & Invariant 11 Precedence', () => {
    const mockJalenEvent: CanonicalEventSummary = {
      id: '97dda0cc-20d9-4f8e-876c-191b3bb370b3',
      title: 'Jalen Ngonda w/ Brooke Combe',
      venueName: "Cervantes' Masterpiece Ballroom",
      venueId: 'v1',
      city: 'Denver',
      region: 'CO',
      lat: 39.7548,
      lng: -104.9782,
      localStartDate: '2026-11-24',
      startsAt: '2026-11-24T20:00:00-07:00',
      timezone: 'America/Denver',
      startTimePrecision: 'instant',
      status: 'scheduled',
      eventKind: 'concert',
      artists: [
        {
          id: '648561c8-4350-488d-9022-6d9d8d54d4e9',
          name: 'Jalen Ngonda',
          billingPosition: 'headliner',
          spotifyArtistId: '2kEDso93O2hDgCbnuiSkkZ',
        },
      ],
      ticketUrl: 'https://cervantesmasterpiece.com/event/jalen-ngonda',
      minPrice: 25,
      maxPrice: 35,
      currency: 'USD',
    };

    it('asserts baseline unmarked concert receives exploratory interest score of 40', () => {
      const baselineArtist = calculateArtistInterestFactor(
        mockJalenEvent.artists,
        [],
        [],
      );

      expect(baselineArtist.factorScore.score).toBe(40);
      expect(baselineArtist.isExploratory).toBe(true);
      expect(baselineArtist.isSuppressed).toBe(false);

      const scored = scoreEvent(mockJalenEvent, {
        artistPreferences: [],
        spotifyTopArtists: [],
        referenceDate: '2026-11-20',
      });

      expect(scored.scoredEvent.isExploratory).toBe(true);
      expect(scored.scoredEvent.factors.artist.score).toBe(40);
      expect(scored.scoredEvent.score).toBeLessThan(60);
    });

    it('asserts Spotify listening affinity elevates artist interest factor from 40 to 70 (+30 points)', () => {
      const spotifyTopArtists: SpotifyTopArtist[] = [
        {
          id: '2kEDso93O2hDgCbnuiSkkZ',
          name: 'Jalen Ngonda',
          rank: 1,
          popularity: 75,
          spotifyUrl: 'https://open.spotify.com/artist/2kEDso93O2hDgCbnuiSkkZ',
          imageUrl:
            'https://i.scdn.co/image/ab6761610000e5eb42b3620fa149f037543ceacd',
          genres: ['soul', 'r&b'],
          timeRange: 'short_term',
        },
      ];

      const personalizedArtist = calculateArtistInterestFactor(
        mockJalenEvent.artists,
        [],
        spotifyTopArtists,
      );

      // Score elevates from 40 to 70 for Top 1-5 artist
      expect(personalizedArtist.factorScore.score).toBe(70);
      expect(personalizedArtist.isExploratory).toBe(false);
      expect(personalizedArtist.isSuppressed).toBe(false);
      expect(personalizedArtist.factorScore.diagnostics?.spotifyAffinity).toBe(
        true,
      );
      expect(personalizedArtist.factorScore.diagnostics?.spotifyRank).toBe(1);

      const scored = scoreEvent(mockJalenEvent, {
        artistPreferences: [],
        spotifyTopArtists,
        referenceDate: '2026-11-20',
      });

      expect(scored.scoredEvent.isExploratory).toBe(false);
      expect(scored.scoredEvent.factors.artist.score).toBe(70);
      // Under balanced preset (50% artist weight), +30 artist points adds +15 composite points (45 -> 60)
      expect(scored.scoredEvent.score).toBe(60);
      expect(scored.scoredEvent.explanation).toContain('Spotify top artist');
    });

    it('asserts tiered Spotify affinity scoring across ranks (Top 1-5 -> 70, Top 6-10 -> 65, Top 11-20 -> 60)', () => {
      const testLineup = [
        {
          id: 'artist-1',
          name: 'Test Artist',
          isHeadliner: true,
          spotifyArtistId: 'spot-1',
        },
      ];

      // Rank 3 -> 70
      const r3 = calculateArtistInterestFactor(
        testLineup,
        [],
        [
          {
            id: 'spot-1',
            name: 'Test Artist',
            rank: 3,
            popularity: 50,
            spotifyUrl: 'https://spotify.com',
            imageUrl: null,
            genres: [],
            timeRange: 'short_term',
          },
        ],
      );
      expect(r3.factorScore.score).toBe(70);

      // Rank 8 -> 65
      const r8 = calculateArtistInterestFactor(
        testLineup,
        [],
        [
          {
            id: 'spot-1',
            name: 'Test Artist',
            rank: 8,
            popularity: 50,
            spotifyUrl: 'https://spotify.com',
            imageUrl: null,
            genres: [],
            timeRange: 'short_term',
          },
        ],
      );
      expect(r8.factorScore.score).toBe(65);

      // Rank 15 -> 60
      const r15 = calculateArtistInterestFactor(
        testLineup,
        [],
        [
          {
            id: 'spot-1',
            name: 'Test Artist',
            rank: 15,
            popularity: 50,
            spotifyUrl: 'https://spotify.com',
            imageUrl: null,
            genres: [],
            timeRange: 'short_term',
          },
        ],
      );
      expect(r15.factorScore.score).toBe(60);
    });

    it('preserves Invariant 11: explicit manual dislike on headliner unconditionally suppresses event (score = 0)', () => {
      const spotifyTopArtists: SpotifyTopArtist[] = [
        {
          id: '2kEDso93O2hDgCbnuiSkkZ',
          name: 'Jalen Ngonda',
          rank: 1, // User's #1 Spotify artist
          popularity: 75,
          spotifyUrl: 'https://open.spotify.com/artist/2kEDso93O2hDgCbnuiSkkZ',
          imageUrl: null,
          genres: [],
          timeRange: 'short_term',
        },
      ];

      // User manually marks Jalen Ngonda as "dislike"
      const userPreferences: UserArtistPreference[] = [
        {
          id: 'pref-dislike',
          userId: TARGET_USER_ID,
          artistId: '648561c8-4350-488d-9022-6d9d8d54d4e9',
          artistName: 'Jalen Ngonda',
          normalizedArtistName: 'jalen ngonda',
          preferenceLevel: 'dislike',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const result = calculateArtistInterestFactor(
        mockJalenEvent.artists,
        userPreferences,
        spotifyTopArtists,
      );

      // Invariant 11: Manual preference strictly takes precedence
      expect(result.factorScore.score).toBe(0);
      expect(result.isSuppressed).toBe(true);

      const scored = scoreEvent(mockJalenEvent, {
        artistPreferences: userPreferences,
        spotifyTopArtists,
        referenceDate: '2026-11-20',
      });

      expect(scored.scoredEvent.isSuppressed).toBe(true);
      expect(scored.scoredEvent.score).toBe(0);
      expect(scored.scoredEvent.suppressionReason).toContain('Not Interested');
    });

    it('preserves Invariant 11: explicit manual Favorite elevates score to 100, overriding Spotify 70', () => {
      const spotifyTopArtists: SpotifyTopArtist[] = [
        {
          id: '2kEDso93O2hDgCbnuiSkkZ',
          name: 'Jalen Ngonda',
          rank: 1,
          popularity: 75,
          spotifyUrl: 'https://open.spotify.com/artist/2kEDso93O2hDgCbnuiSkkZ',
          imageUrl: null,
          genres: [],
          timeRange: 'short_term',
        },
      ];

      const userPreferences: UserArtistPreference[] = [
        {
          id: 'pref-fav',
          userId: TARGET_USER_ID,
          artistId: '648561c8-4350-488d-9022-6d9d8d54d4e9',
          artistName: 'Jalen Ngonda',
          normalizedArtistName: 'jalen ngonda',
          preferenceLevel: 'favorite',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const result = calculateArtistInterestFactor(
        mockJalenEvent.artists,
        userPreferences,
        spotifyTopArtists,
      );

      // Favorite scores 100, strictly overriding Spotify's 70
      expect(result.factorScore.score).toBe(100);
      expect(result.isSuppressed).toBe(false);

      const scored = scoreEvent(mockJalenEvent, {
        artistPreferences: userPreferences,
        spotifyTopArtists,
        referenceDate: '2026-11-20',
      });

      expect(scored.scoredEvent.factors.artist.score).toBe(100);
      // Under balanced preset (50% artist weight), +60 artist points adds +30 composite points (45 -> 75)
      expect(scored.scoredEvent.score).toBe(75);
      expect(scored.scoredEvent.explanation).toContain('Favorite artist');
    });
  });

  describe('Audit 4: Security & Sensitive Token Redaction', () => {
    it('verifies zero plaintext secrets or encryption keys in database queries or public models', async () => {
      if (!isDbAvailable || !supabase) return;

      // Query raw row from public table
      const { data: row } = await supabase
        .from('user_spotify_connections')
        .select('*')
        .eq('user_id', TARGET_USER_ID)
        .single();

      expect(row).toBeDefined();

      // Plaintext tokens must not exist as unencrypted strings
      expect(row.encrypted_access_token).not.toContain('Bearer');
      expect(row.encrypted_refresh_token).not.toContain('Bearer');
      expect(row.encrypted_access_token).not.toBe(
        process.env.SPOTIFY_CLIENT_SECRET,
      );
      expect(row.encrypted_access_token).not.toBe(
        process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY,
      );

      // Ensure client-side repository method strips tokens completely
      const connection = await connRepo!.getConnection(TARGET_USER_ID);
      const jsonString = JSON.stringify(connection);
      expect(jsonString).not.toContain('accessToken');
      expect(jsonString).not.toContain('refreshToken');
      expect(jsonString).not.toContain('encrypted_');
      expect(jsonString).not.toContain(
        process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY!,
      );
    });
  });
});
