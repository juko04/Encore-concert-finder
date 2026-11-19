import { beforeEach, describe, expect, it } from 'vitest';
import { SpotifyApiClient } from '@/lib/sources/spotify/client';
import {
  type SpotifyTimeRange,
  type SpotifyTopArtist,
  SpotifyAccountConflictError,
} from '@/lib/domain/spotify';
import {
  generateCodeVerifier,
  computeCodeChallenge,
  generateOAuthState,
  createOAuthHandshakeToken,
  verifyOAuthHandshakeToken,
} from '@/lib/sources/spotify/oauth';
import { encryptSecret, decryptSecret } from '@/lib/security/crypto';
import {
  MemoryCatalogRepository,
  MemoryProfileRepository,
  MemorySpotifyConnectionRepository,
  MemoryUserPreferenceRepository,
} from '@/lib/repositories/memory-repositories';
import { type Artist, type CanonicalEventSummary } from '@/lib/domain/catalog';
import { normalizeName } from '@/lib/domain/value-objects';
import { rankEvents } from '@/lib/recommendation/engine';
import { getPersonalizedDiscoverData } from '@/lib/recommendation/service';
import { UNMARKED_ARTIST_SCORE } from '@/lib/recommendation/factors/artist-interest';

import {
  SpotifyArtistMatcher,
  type SpotifyArtistCandidate,
} from '@/lib/entity-resolution/spotify-artist-matcher';

const TEST_ENCRYPTION_KEY =
  'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

// ---------------------------------------------------------------------------
// Helpers for Multi-Range Listening Trends
// ---------------------------------------------------------------------------

interface ArtistTimeRangeRanks {
  short_term: number | null;
  medium_term: number | null;
  long_term: number | null;
}

function calculateListeningTrend(
  ranks: ArtistTimeRangeRanks,
): 'rising' | 'consistent' | 'fading' {
  const short = ranks.short_term;
  const medium = ranks.medium_term;
  const long = ranks.long_term;

  // Rising: high momentum in short term compared to long term or unranked all-time baseline
  if (
    short !== null &&
    (long === null || (short <= 3 && (long >= 8 || long > short + 2)))
  ) {
    return 'rising';
  }

  // Fading: historical all-time favorite, but absent or significantly degraded in recent listening
  if (
    long !== null &&
    long <= 3 &&
    (short === null || short > 10 || (medium !== null && medium > 5))
  ) {
    return 'fading';
  }

  // Consistent: staple across all listening horizons
  return 'consistent';
}

function computeRecencyWeightedScore(ranks: ArtistTimeRangeRanks): number {
  const toScore = (rank: number | null): number => {
    if (rank === null) return 40; // neutral unranked baseline
    if (rank <= 5) return 70;
    if (rank <= 10) return 65;
    if (rank <= 20) return 60;
    return 50;
  };

  const shortScore = toScore(ranks.short_term);
  const mediumScore = toScore(ranks.medium_term);
  const longScore = toScore(ranks.long_term);

  // 60% short-term, 30% medium-term, 10% long-term hypothesis
  return Math.round(0.6 * shortScore + 0.3 * mediumScore + 0.1 * longScore);
}

// ---------------------------------------------------------------------------
// Helper to seed canonical events into memory catalog repository
// ---------------------------------------------------------------------------

function seedCanonicalEvent(
  repo: MemoryCatalogRepository,
  event: {
    id: string;
    title: string;
    localStartDate: string;
    venueName?: string;
    city?: string;
    artists: Array<{
      id: string;
      name: string;
      billingPosition: 'headliner' | 'support';
      spotifyArtistId?: string;
    }>;
  },
) {
  const evId = event.id;
  const venueId = `venue-${evId}`;

  repo.venues.set(venueId, {
    id: venueId,
    name: event.venueName ?? 'Red Rocks Amphitheatre',
    normalizedName: (event.venueName ?? 'Red Rocks Amphitheatre').toLowerCase(),
    city: event.city ?? 'Morrison',
    region: 'CO',
    countryCode: 'US',
    lat: 39.6654,
    lng: -105.2057,
    timezone: 'America/Denver',
    website: null,
    capacity: 9525,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  });

  repo.events.set(evId, {
    id: evId,
    name: event.title,
    normalizedName: event.title.toLowerCase(),
    eventKind: 'concert',
    status: 'scheduled',
    venueId,
    city: event.city ?? 'Morrison',
    region: 'CO',
    countryCode: 'US',
    lat: 39.6654,
    lng: -105.2057,
    timezone: 'America/Denver',
    localStartDate: event.localStartDate,
    localEndDate: null,
    startsAt: `${event.localStartDate}T20:00:00Z`,
    endsAt: null,
    startTimePrecision: 'instant',
    doorsAt: null,
    isMultiDay: false,
    officialUrl: null,
    primaryTicketUrl: `https://tickets.example.com/${evId}`,
    announcedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  });

  repo.eventTicketLinks.set(`tl-${evId}`, {
    id: `tl-${evId}`,
    eventId: evId,
    ticketProviderSourceId: 'ticketmaster',
    url: `https://tickets.example.com/${evId}`,
    normalizedUrl: `https://tickets.example.com/${evId}`,
    minPrice: 50,
    maxPrice: 85,
    currency: 'USD',
    inventoryStatus: 'available',
    verifiedAt: '2026-10-01T00:00:00Z',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  });

  for (let i = 0; i < event.artists.length; i++) {
    const a = event.artists[i];
    if (!repo.artists.has(a.id)) {
      repo.artists.set(a.id, {
        id: a.id,
        name: a.name,
        normalizedName: normalizeName(a.name),
        imageUrl: null,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      });
    }

    if (a.spotifyArtistId) {
      const extKey = `ext-${a.id}-spotify-${a.spotifyArtistId}`;
      if (!repo.artistExternalIds.has(extKey)) {
        repo.artistExternalIds.set(extKey, {
          id: extKey,
          artistId: a.id,
          provider: 'spotify',
          externalId: a.spotifyArtistId,
          providerUrl: `https://open.spotify.com/artist/${a.spotifyArtistId}`,
          createdAt: '2026-10-01T00:00:00Z',
        });
      }
    }

    repo.eventArtists.set(`ea-${evId}-${a.id}`, {
      id: `ea-${evId}-${a.id}`,
      eventId: evId,
      artistId: a.id,
      billingPosition: a.billingPosition,
      sortOrder: i,
      createdAt: '2026-10-01T00:00:00Z',
    });
  }
}

// ---------------------------------------------------------------------------
// Main End-to-End Test Suite
// ---------------------------------------------------------------------------

describe('Spotify End-to-End In-Memory Integration Journey', () => {
  let catalogRepo: MemoryCatalogRepository;
  let spotifyRepo: MemorySpotifyConnectionRepository;
  let prefRepo: MemoryUserPreferenceRepository;
  let profileRepo: MemoryProfileRepository;
  let matcher: SpotifyArtistMatcher;

  beforeEach(() => {
    catalogRepo = new MemoryCatalogRepository();
    spotifyRepo = new MemorySpotifyConnectionRepository();
    prefRepo = new MemoryUserPreferenceRepository(catalogRepo);
    profileRepo = new MemoryProfileRepository();
    matcher = new SpotifyArtistMatcher(catalogRepo);
  });

  // =========================================================================
  // Step 1: User connects Spotify
  // =========================================================================
  describe('Step 1: Spotify OAuth Connection & Token Encryption', () => {
    it('executes PKCE handshake, token exchange, authenticated encryption, and stores status connected', async () => {
      const userId = 'user-e2e-1';

      // 1. Generate RFC 7636 PKCE parameters
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = computeCodeChallenge(codeVerifier);
      const state = generateOAuthState();

      expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
      expect(codeChallenge).toBeDefined();
      expect(state.length).toBe(48); // 24 random bytes hex

      // 2. Create and verify encrypted handshake token
      const handshakeToken = createOAuthHandshakeToken(
        {
          state,
          codeVerifier,
          userId,
          createdAt: Date.now(),
        },
        TEST_ENCRYPTION_KEY,
      );
      expect(handshakeToken).toBeDefined();

      const verifiedPayload = verifyOAuthHandshakeToken(
        handshakeToken,
        TEST_ENCRYPTION_KEY,
      );
      expect(verifiedPayload).not.toBeNull();
      expect(verifiedPayload?.userId).toBe(userId);
      expect(verifiedPayload?.state).toBe(state);
      expect(verifiedPayload?.codeVerifier).toBe(codeVerifier);

      // 3. Mock exchangeAuthorizationCode via SpotifyApiClient
      const mockFetch = async () =>
        new Response(
          JSON.stringify({
            access_token: 'spot-live-access-token-12345',
            refresh_token: 'spot-live-refresh-token-67890',
            token_type: 'Bearer',
            scope: 'user-top-read',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );

      const client = new SpotifyApiClient({
        clientId: 'mock-client-id',
        clientSecret: 'mock-client-secret',
        redirectUri: 'http://127.0.0.1:3000/api/integrations/spotify/callback',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const exchangeResult = await client.exchangeAuthorizationCode(
        'mock-auth-code',
        codeVerifier,
      );

      expect(exchangeResult.accessToken).toBe('spot-live-access-token-12345');
      expect(exchangeResult.refreshToken).toBe('spot-live-refresh-token-67890');
      expect(exchangeResult.scopes).toEqual(['user-top-read']);
      // 180-day deadline
      expect(exchangeResult.reauthorizationDeadline.getTime()).toBeGreaterThan(
        Date.now() + 150 * 86400 * 1000,
      );

      // 4. Save connection in MemorySpotifyConnectionRepository
      const connection = await spotifyRepo.saveConnection({
        userId,
        spotifyAccountId: 'spot-user-account-primary',
        accessToken: exchangeResult.accessToken,
        refreshToken: exchangeResult.refreshToken,
        tokenExpiresAt: exchangeResult.tokenExpiresAt,
        reauthorizationDeadline: exchangeResult.reauthorizationDeadline,
        scopes: exchangeResult.scopes,
      });

      expect(connection.userId).toBe(userId);
      expect(connection.spotifyAccountId).toBe('spot-user-account-primary');
      expect(connection.status).toBe('connected');
      // Tokens must never be leaked on connection metadata
      expect((connection as any).accessToken).toBeUndefined();
      expect((connection as any).refreshToken).toBeUndefined();

      // 5. Retrieve tokens securely via server-only getConnectionTokens
      const tokens = await spotifyRepo.getConnectionTokens(userId);
      expect(tokens).not.toBeNull();
      expect(tokens?.accessToken).toBe('spot-live-access-token-12345');
      expect(tokens?.refreshToken).toBe('spot-live-refresh-token-67890');

      // 6. Enforce 1-to-1 account conflict invariant
      await expect(
        spotifyRepo.saveConnection({
          userId: 'user-e2e-imposter',
          spotifyAccountId: 'spot-user-account-primary', // same Spotify account
          accessToken: 'other-access',
          refreshToken: 'other-refresh',
          tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
          reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
          scopes: ['user-top-read'],
        }),
      ).rejects.toThrow(SpotifyAccountConflictError);

      // Reconnecting for the same user succeeds
      await expect(
        spotifyRepo.saveConnection({
          userId,
          spotifyAccountId: 'spot-user-account-primary',
          accessToken: 'refreshed-access',
          refreshToken: 'refreshed-refresh',
          tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
          reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
          scopes: ['user-top-read'],
        }),
      ).resolves.toBeDefined();
    });
  });

  // =========================================================================
  // Step 2: Multi-Window Top Artists Ingestion & Deduplication
  // =========================================================================
  describe('Step 2: Multi-Range Preferences, Deduplication, & Trend Calculation', () => {
    it('ingests short, medium, and long-term artists, preserves rank, calculates listening trends, and dedupes', () => {
      // Mock top artist payloads across three time ranges
      const shortTermArtists: SpotifyTopArtist[] = [
        {
          id: 'spot-chappell',
          name: 'Chappell Roan',
          rank: 1,
          imageUrl: 'https://img.test/chappell.jpg',
          spotifyUrl: 'https://open.spotify.com/artist/spot-chappell',
          genres: ['pop', 'indie pop'],
          popularity: 92,
          timeRange: 'short_term',
        },
        {
          id: 'spot-khruangbin',
          name: 'Khruangbin',
          rank: 2,
          imageUrl: 'https://img.test/khruangbin.jpg',
          spotifyUrl: 'https://open.spotify.com/artist/spot-khruangbin',
          genres: ['psychedelic rock'],
          popularity: 79,
          timeRange: 'short_term',
        },
        {
          id: 'spot-charli',
          name: 'Charli xcx',
          rank: 3,
          imageUrl: 'https://img.test/charli.jpg',
          spotifyUrl: 'https://open.spotify.com/artist/spot-charli',
          genres: ['hyperpop'],
          popularity: 88,
          timeRange: 'short_term',
        },
      ];

      const mediumTermArtists: SpotifyTopArtist[] = [
        {
          id: 'spot-tame-impala',
          name: 'Tame Impala',
          rank: 1,
          imageUrl: 'https://img.test/tame.jpg',
          spotifyUrl: 'https://open.spotify.com/artist/spot-tame-impala',
          genres: ['psychedelic pop'],
          popularity: 85,
          timeRange: 'medium_term',
        },
        {
          id: 'spot-khruangbin',
          name: 'Khruangbin',
          rank: 2,
          imageUrl: 'https://img.test/khruangbin.jpg',
          spotifyUrl: 'https://open.spotify.com/artist/spot-khruangbin',
          genres: ['psychedelic rock'],
          popularity: 79,
          timeRange: 'medium_term',
        },
        {
          id: 'spot-charli',
          name: 'Charli xcx',
          rank: 3,
          imageUrl: 'https://img.test/charli.jpg',
          spotifyUrl: 'https://open.spotify.com/artist/spot-charli',
          genres: ['hyperpop'],
          popularity: 88,
          timeRange: 'medium_term',
        },
        {
          id: 'spot-chappell',
          name: 'Chappell Roan',
          rank: 4,
          imageUrl: 'https://img.test/chappell.jpg',
          spotifyUrl: 'https://open.spotify.com/artist/spot-chappell',
          genres: ['pop', 'indie pop'],
          popularity: 92,
          timeRange: 'medium_term',
        },
      ];

      const longTermArtists: SpotifyTopArtist[] = [
        {
          id: 'spot-tame-impala',
          name: 'Tame Impala',
          rank: 1,
          imageUrl: 'https://img.test/tame.jpg',
          spotifyUrl: 'https://open.spotify.com/artist/spot-tame-impala',
          genres: ['psychedelic pop'],
          popularity: 85,
          timeRange: 'long_term',
        },
        {
          id: 'spot-khruangbin',
          name: 'Khruangbin',
          rank: 2,
          imageUrl: 'https://img.test/khruangbin.jpg',
          spotifyUrl: 'https://open.spotify.com/artist/spot-khruangbin',
          genres: ['psychedelic rock'],
          popularity: 79,
          timeRange: 'long_term',
        },
        {
          id: 'spot-charli',
          name: 'Charli xcx',
          rank: 9,
          imageUrl: 'https://img.test/charli.jpg',
          spotifyUrl: 'https://open.spotify.com/artist/spot-charli',
          genres: ['hyperpop'],
          popularity: 88,
          timeRange: 'long_term',
        },
        {
          id: 'spot-pink-floyd',
          name: 'Pink Floyd',
          rank: 4,
          imageUrl: 'https://img.test/pinkfloyd.jpg',
          spotifyUrl: 'https://open.spotify.com/artist/spot-pink-floyd',
          genres: ['classic rock'],
          popularity: 82,
          timeRange: 'long_term',
        },
      ];

      // Multi-range aggregation & deduplication map
      const multiRangeMap = new Map<
        string,
        {
          id: string;
          name: string;
          ranks: ArtistTimeRangeRanks;
          genres: string[];
          popularity: number;
        }
      >();

      const ingestRange = (
        artists: SpotifyTopArtist[],
        range: SpotifyTimeRange,
      ) => {
        for (const a of artists) {
          if (!multiRangeMap.has(a.id)) {
            multiRangeMap.set(a.id, {
              id: a.id,
              name: a.name,
              ranks: { short_term: null, medium_term: null, long_term: null },
              genres: a.genres,
              popularity: a.popularity,
            });
          }
          multiRangeMap.get(a.id)!.ranks[range] = a.rank;
        }
      };

      ingestRange(shortTermArtists, 'short_term');
      ingestRange(mediumTermArtists, 'medium_term');
      ingestRange(longTermArtists, 'long_term');

      // 1. Verify Deduplication: Exactly 5 unique artists across all 3 ranges
      expect(multiRangeMap.size).toBe(5);
      expect(Array.from(multiRangeMap.keys())).toEqual([
        'spot-chappell',
        'spot-khruangbin',
        'spot-charli',
        'spot-tame-impala',
        'spot-pink-floyd',
      ]);

      // 2. Verify Rank Preservation
      const chappell = multiRangeMap.get('spot-chappell')!;
      expect(chappell.ranks.short_term).toBe(1);
      expect(chappell.ranks.medium_term).toBe(4);
      expect(chappell.ranks.long_term).toBeNull();

      const khruangbin = multiRangeMap.get('spot-khruangbin')!;
      expect(khruangbin.ranks.short_term).toBe(2);
      expect(khruangbin.ranks.medium_term).toBe(2);
      expect(khruangbin.ranks.long_term).toBe(2);

      const tame = multiRangeMap.get('spot-tame-impala')!;
      expect(tame.ranks.short_term).toBeNull();
      expect(tame.ranks.medium_term).toBe(1);
      expect(tame.ranks.long_term).toBe(1);

      // 3. Verify Trend Calculation
      expect(calculateListeningTrend(chappell.ranks)).toBe('rising'); // short 1 vs long unranked
      expect(calculateListeningTrend(khruangbin.ranks)).toBe('consistent'); // staple in all 3
      expect(calculateListeningTrend(tame.ranks)).toBe('fading'); // historical #1, absent in short
      expect(
        calculateListeningTrend(multiRangeMap.get('spot-charli')!.ranks),
      ).toBe('rising'); // #3 vs #9

      // 4. Verify Recency Weighting (60% short / 30% medium / 10% long)
      const chappellWeighted = computeRecencyWeightedScore(chappell.ranks);
      const khruangbinWeighted = computeRecencyWeightedScore(khruangbin.ranks);
      const tameWeighted = computeRecencyWeightedScore(tame.ranks);

      // Chappell: 0.6 * 70 + 0.3 * 70 + 0.1 * 40 = 42 + 21 + 4 = 67
      expect(chappellWeighted).toBe(67);
      // Khruangbin: 0.6 * 70 + 0.3 * 70 + 0.1 * 70 = 70
      expect(khruangbinWeighted).toBe(70);
      // Tame Impala: 0.6 * 40 + 0.3 * 70 + 0.1 * 70 = 24 + 21 + 7 = 52
      expect(tameWeighted).toBe(52);
    });
  });

  // =========================================================================
  // Step 3: Match against Canonical Catalog using SpotifyArtistMatcher
  // =========================================================================
  describe('Step 3: Conservative Artist Matching & Catalog Enrichment', () => {
    it('handles exact ID match, unambiguous name match with enrichment, ambiguous collisions, and conflicts', async () => {
      // Seed pre-existing catalog entities
      // 1. Existing artist with registered Spotify ID
      catalogRepo.artists.set('canon-khruangbin', {
        id: 'canon-khruangbin',
        name: 'Khruangbin',
        normalizedName: 'khruangbin',
        imageUrl: null,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      });
      catalogRepo.artistExternalIds.set('ext-khruangbin-spotify', {
        id: 'ext-khruangbin-spotify',
        artistId: 'canon-khruangbin',
        provider: 'spotify',
        externalId: 'spot-khruangbin-verified',
        providerUrl: 'https://open.spotify.com/artist/spot-khruangbin-verified',
        createdAt: '2026-10-01T00:00:00Z',
      });

      // 2. Existing artist with NO Spotify ID (unambiguous candidate)
      catalogRepo.artists.set('canon-chappell', {
        id: 'canon-chappell',
        name: 'Chappell Roan',
        normalizedName: 'chappell roan',
        imageUrl: null,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      });

      // 3. Ambiguous collision: two distinct artists sharing the name "Ghost"
      catalogRepo.artists.set('canon-ghost-sweden', {
        id: 'canon-ghost-sweden',
        name: 'Ghost',
        normalizedName: 'ghost',
        imageUrl: null,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      });
      catalogRepo.artists.set('canon-ghost-japan', {
        id: 'canon-ghost-japan',
        name: 'Ghost',
        normalizedName: 'ghost',
        imageUrl: null,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      });

      // 4. Conflicting external ID: canonical artist has Spotify ID 'spot-phoenix-orig'
      catalogRepo.artists.set('canon-phoenix', {
        id: 'canon-phoenix',
        name: 'Phoenix',
        normalizedName: 'phoenix',
        imageUrl: null,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      });
      catalogRepo.artistExternalIds.set('ext-phoenix-orig', {
        id: 'ext-phoenix-orig',
        artistId: 'canon-phoenix',
        provider: 'spotify',
        externalId: 'spot-phoenix-orig',
        providerUrl: null,
        createdAt: '2026-10-01T00:00:00Z',
      });

      // ---------------------------------------------------------------------
      // Test 3a: Exact verified Spotify ID match
      // ---------------------------------------------------------------------
      const matchExact = await matcher.matchArtist({
        id: 'spot-khruangbin-verified',
        name: 'Khruangbin',
      });
      expect(matchExact.status).toBe('matched');
      if (matchExact.status === 'matched') {
        expect(matchExact.artistId).toBe('canon-khruangbin');
        expect(matchExact.matchMethod).toBe('exact_external_id');
        expect(matchExact.wasEnriched).toBe(false);
      }

      // ---------------------------------------------------------------------
      // Test 3b: Single unambiguous match + external ID enrichment
      // ---------------------------------------------------------------------
      const matchUnambiguous = await matcher.matchArtist({
        id: 'spot-chappell-new',
        name: 'Chappell Roan',
        spotifyUrl: 'https://open.spotify.com/artist/spot-chappell-new',
      });
      expect(matchUnambiguous.status).toBe('matched');
      if (matchUnambiguous.status === 'matched') {
        expect(matchUnambiguous.artistId).toBe('canon-chappell');
        expect(matchUnambiguous.matchMethod).toBe('verified_canonical_name');
        expect(matchUnambiguous.wasEnriched).toBe(true);
      }

      // Verify catalog was enriched in memory!
      const enrichedLookup = await catalogRepo.findArtistByExternalId(
        'spotify',
        'spot-chappell-new',
      );
      expect(enrichedLookup).not.toBeNull();
      expect(enrichedLookup?.id).toBe('canon-chappell');

      // Subsequent match of the same artist is now an exact ID match
      const followUpMatch = await matcher.matchArtist({
        id: 'spot-chappell-new',
        name: 'Chappell Roan',
      });
      expect(followUpMatch.status).toBe('matched');
      if (followUpMatch.status === 'matched') {
        expect(followUpMatch.matchMethod).toBe('exact_external_id');
        expect(followUpMatch.artistId).toBe('canon-chappell');
        expect(followUpMatch.wasEnriched).toBe(false);
      }

      // ---------------------------------------------------------------------
      // Test 3c: Ambiguous collision (multiple canonical artists with same name)
      // ---------------------------------------------------------------------
      const initialExtIdCount = catalogRepo.artistExternalIds.size;
      const matchAmbiguous = await matcher.matchArtist({
        id: 'spot-ghost-unknown',
        name: 'Ghost',
      });
      expect(matchAmbiguous.status).toBe('ambiguous');
      if (matchAmbiguous.status === 'ambiguous') {
        expect(matchAmbiguous.reason).toBe(
          'multiple_canonical_artists_with_same_name',
        );
      }
      // Invariant 5: zero catalog corruption! No external IDs added for ambiguous collisions
      expect(catalogRepo.artistExternalIds.size).toBe(initialExtIdCount);

      // ---------------------------------------------------------------------
      // Test 3d: Conflicting external ID
      // ---------------------------------------------------------------------
      const matchConflict = await matcher.matchArtist({
        id: 'spot-phoenix-imposter',
        name: 'Phoenix',
      });
      expect(matchConflict.status).toBe('ambiguous');
      if (matchConflict.status === 'ambiguous') {
        expect(matchConflict.reason).toBe('conflicting_spotify_external_id');
      }
      // Verify existing external ID remains pristine
      const phoenixExt =
        await catalogRepo.findArtistExternalIds('canon-phoenix');
      expect(phoenixExt).toHaveLength(1);
      expect(phoenixExt[0].externalId).toBe('spot-phoenix-orig');

      // ---------------------------------------------------------------------
      // Test 3e: Unmatched artist
      // ---------------------------------------------------------------------
      const matchUnmatched = await matcher.matchArtist({
        id: 'spot-unknown-artist-99',
        name: 'Completely Unheard Of Band',
      });
      expect(matchUnmatched.status).toBe('unmatched');
      if (matchUnmatched.status === 'unmatched') {
        expect(matchUnmatched.reason).toBe('not_found_in_catalog');
      }
    });
  });

  // =========================================================================
  // Step 4: Run Recommendation Engine (rankEvents & getPersonalizedDiscoverData)
  // =========================================================================
  describe('Step 4: Recommendation Engine & Personalization Impact', () => {
    it('applies ~70 personalization boost for matched Spotify artists vs 40 unmarked, enforces Invariant 11, and preserves exploratory discovery', async () => {
      const userId = 'user-rec-step4';

      // Seed Catalog:
      // 1. Concert with matched Spotify top artist as Headliner
      seedCanonicalEvent(catalogRepo, {
        id: 'event-spotify-boosted',
        title: 'Chappell Roan Live at Red Rocks',
        localStartDate: '2026-11-20',
        artists: [
          {
            id: 'artist-chappell',
            name: 'Chappell Roan',
            billingPosition: 'headliner',
            spotifyArtistId: 'spot-chappell',
          },
        ],
      });

      // 2. Concert with unfamiliar/unmarked indie band
      seedCanonicalEvent(catalogRepo, {
        id: 'event-unmarked-exploratory',
        title: 'Local Indie Showcase',
        localStartDate: '2026-11-21',
        artists: [
          {
            id: 'artist-unmarked-local',
            name: 'The Denver Sound Machine',
            billingPosition: 'headliner',
          },
        ],
      });

      // 3. Concert with a Disliked headliner (who happens to be high on Spotify)
      seedCanonicalEvent(catalogRepo, {
        id: 'event-disliked-headliner',
        title: 'Disliked Mega Pop Star Arena Tour',
        localStartDate: '2026-11-22',
        artists: [
          {
            id: 'artist-disliked-star',
            name: 'Disliked Mega Star',
            billingPosition: 'headliner',
            spotifyArtistId: 'spot-disliked-star',
          },
        ],
      });

      // 4. Concert with a Favorite headliner AND a Disliked support act
      seedCanonicalEvent(catalogRepo, {
        id: 'event-favorite-with-disliked-support',
        title: 'The Cure with Annoying Support Act',
        localStartDate: '2026-11-23',
        artists: [
          {
            id: 'artist-the-cure',
            name: 'The Cure',
            billingPosition: 'headliner',
          },
          {
            id: 'artist-bad-support',
            name: 'Annoying Opener',
            billingPosition: 'support',
          },
        ],
      });

      // Set user manual preferences in prefRepo (Invariant 11)
      await prefRepo.savePreference({
        userId,
        artistId: 'artist-disliked-star',
        artistName: 'Disliked Mega Star',
        preferenceLevel: 'dislike',
      });

      await prefRepo.savePreference({
        userId,
        artistId: 'artist-the-cure',
        artistName: 'The Cure',
        preferenceLevel: 'favorite',
      });

      await prefRepo.savePreference({
        userId,
        artistId: 'artist-bad-support',
        artistName: 'Annoying Opener',
        preferenceLevel: 'dislike',
      });

      // User Spotify top artists listening signal
      const spotifyTopArtists: SpotifyTopArtist[] = [
        {
          id: 'spot-chappell',
          name: 'Chappell Roan',
          rank: 1, // Top 5 -> artist interest factor = 70
          imageUrl: null,
          spotifyUrl: 'https://open.spotify.com/artist/spot-chappell',
          genres: ['pop'],
          popularity: 92,
          timeRange: 'short_term',
        },
        {
          id: 'spot-disliked-star',
          name: 'Disliked Mega Star',
          rank: 2, // High Spotify listening affinity (#2)
          imageUrl: null,
          spotifyUrl: 'https://open.spotify.com/artist/spot-disliked-star',
          genres: ['pop'],
          popularity: 95,
          timeRange: 'short_term',
        },
      ];

      // Retrieve all catalog events for ranking
      const allEvents = await catalogRepo.listEvents();
      expect(allEvents).toHaveLength(4);

      const userPreferences = await prefRepo.getPreferences(userId);

      // ---------------------------------------------------------------------
      // Part A: rankEvents unit verification
      // ---------------------------------------------------------------------
      const rankResult = rankEvents(allEvents, {
        userProfile: {
          id: userId,
          homeLatApprox: 39.7392,
          homeLngApprox: -104.9903,
          defaultRadiusMiles: 25,
          maxNormalTicketPrice: 100,
          maxFavoriteArtistPrice: 200,
          maxSpontaneousPrice: 50,
          travelWillingness: 'moderate',
          recommendationPreset: 'balanced',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        artistPreferences: userPreferences,
        spotifyTopArtists,
        referenceDate: '2026-11-17',
      });

      // 1. Verify Personalization Boost:
      // event-spotify-boosted receives artist factor score = 70
      const boostedRec = rankResult.recommendations.find(
        (r) => r.eventId === 'event-spotify-boosted',
      );
      expect(boostedRec).toBeDefined();
      expect(boostedRec?.factors.artist.score).toBe(70);
      expect(boostedRec?.matchedArtist?.isSpotifyAffinity).toBe(true);
      expect(boostedRec?.matchedArtist?.spotifyRank).toBe(1);

      // event-unmarked-exploratory receives neutral exploratory score = 40
      const unmarkedExploratory = rankResult.exploratory.find(
        (r) => r.eventId === 'event-unmarked-exploratory',
      );
      expect(unmarkedExploratory).toBeDefined();
      expect(unmarkedExploratory?.factors.artist.score).toBe(
        UNMARKED_ARTIST_SCORE,
      );
      expect(unmarkedExploratory?.isExploratory).toBe(true);

      // Compare composite scores: boosted concert is ranked significantly higher
      expect(boostedRec!.score).toBeGreaterThan(unmarkedExploratory!.score);

      // 2. Verify Invariant 11: Explicit user preferences strictly override Spotify affinity
      // Even though 'Disliked Mega Star' is #2 on Spotify, explicit manual 'dislike' suppresses the show!
      const suppressedShow = rankResult.suppressed.find(
        (r) => r.eventId === 'event-disliked-headliner',
      );
      expect(suppressedShow).toBeDefined();
      expect(suppressedShow?.score).toBe(0);
      expect(suppressedShow?.isSuppressed).toBe(true);
      expect(suppressedShow?.suppressionReason).toContain(
        "Headliner 'Disliked Mega Star' is marked Not Interested",
      );

      // 3. Verify Invariant 11: Favorite headliner overrides disliked support act
      const favoriteShow = rankResult.recommendations.find(
        (r) => r.eventId === 'event-favorite-with-disliked-support',
      );
      expect(favoriteShow).toBeDefined();
      expect(favoriteShow?.score).toBeGreaterThanOrEqual(85);
      expect(favoriteShow?.factors.artist.score).toBe(100); // Favorite headliner = 100
      expect(favoriteShow?.isSuppressed).toBe(false);
      expect(favoriteShow?.factors.artist.explanation).toContain(
        'Favorite headliner: The Cure',
      );
      expect(favoriteShow?.factors.artist.explanation).toContain(
        'support act Annoying Opener is marked Not Interested',
      );
      expect(favoriteShow?.explanation).toContain('Favorite artist (The Cure)');

      // 4. Verify Unfamiliar artists remain discoverable in exploratory pool
      expect(rankResult.exploratory).toHaveLength(1);
      expect(rankResult.exploratory[0].eventId).toBe(
        'event-unmarked-exploratory',
      );
      expect(rankResult.exploratory[0].isSuppressed).toBe(false);

      // ---------------------------------------------------------------------
      // Part B: getPersonalizedDiscoverData service integration verification
      // ---------------------------------------------------------------------
      await spotifyRepo.saveConnection({
        userId,
        spotifyAccountId: 'spot-step4-acc',
        accessToken: 'access-step4',
        refreshToken: 'refresh-step4',
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
        scopes: ['user-top-read'],
      });

      const discoverData = await getPersonalizedDiscoverData({
        userId,
        catalogRepo,
        prefRepo,
        profileRepo,
        spotifyRepo,
        spotifyTopArtists,
        referenceDate: '2026-11-17',
      });

      expect(discoverData.isSpotifyConnected).toBe(true);
      expect(discoverData.hasSpotifyAffinities).toBe(true);
      expect(discoverData.recommendations.length).toBeGreaterThanOrEqual(2);
      expect(discoverData.exploratory).toHaveLength(1);
      expect(discoverData.suppressed).toHaveLength(1);
    });
  });

  // =========================================================================
  // Step 5: Verify Idempotency across Repeated Syncs
  // =========================================================================
  describe('Step 5: Idempotency & Zero Row Explosion', () => {
    it('executes repeated syncs without introducing duplicate database rows', async () => {
      const userId = 'user-idempotency-sync';
      const spotifyAccountId = 'spot-idempotent-account';

      // Candidate top artist for enrichment
      catalogRepo.artists.set('canon-idempotent-band', {
        id: 'canon-idempotent-band',
        name: 'Idempotent Rock Band',
        normalizedName: 'idempotent rock band',
        imageUrl: null,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      });

      const initialExtCount = catalogRepo.artistExternalIds.size;

      // Execute sync iteration 1, 2, and 3
      for (let syncIteration = 1; syncIteration <= 3; syncIteration++) {
        // 1. Connection upsert
        await spotifyRepo.saveConnection({
          userId,
          spotifyAccountId,
          accessToken: `token-iter-${syncIteration}`,
          refreshToken: `refresh-iter-${syncIteration}`,
          tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
          reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
          scopes: ['user-top-read'],
        });

        // 2. Catalog enrichment
        await matcher.matchArtist(
          {
            id: 'spot-idempotent-band-id',
            name: 'Idempotent Rock Band',
          },
          { allowEnrichment: true },
        );
      }

      // Verify connection table has exactly 1 row for this user (no duplicate connections)
      const conn = await spotifyRepo.getConnection(userId);
      expect(conn).not.toBeNull();
      expect(conn?.userId).toBe(userId);

      // Verify external IDs table contains exactly 1 enriched row (no duplicates)
      expect(catalogRepo.artistExternalIds.size).toBe(initialExtCount + 1);

      const extIds = await catalogRepo.findArtistExternalIds(
        'canon-idempotent-band',
      );
      expect(extIds).toHaveLength(1);
      expect(extIds[0].externalId).toBe('spot-idempotent-band-id');
    });
  });

  // =========================================================================
  // Step 6: Safe Reconnection & Preservation of Manual Preferences
  // =========================================================================
  describe('Step 6: Safe Disconnection, Reconnection, & Preference Integrity', () => {
    it('preserves all explicit manual user preferences through disconnect and reconnect cycles', async () => {
      const userId = 'user-reconnect-lifecycle';

      // 1. Set explicit user preferences
      catalogRepo.artists.set('canon-band-alpha', {
        id: 'canon-band-alpha',
        name: 'Band Alpha',
        normalizedName: 'band alpha',
        imageUrl: null,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      });
      catalogRepo.artists.set('canon-band-beta', {
        id: 'canon-band-beta',
        name: 'Band Beta',
        normalizedName: 'band beta',
        imageUrl: null,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      });

      const prefAlpha = await prefRepo.savePreference({
        userId,
        artistId: 'canon-band-alpha',
        artistName: 'Band Alpha',
        preferenceLevel: 'favorite',
      });

      const prefBeta = await prefRepo.savePreference({
        userId,
        artistId: 'canon-band-beta',
        artistName: 'Band Beta',
        preferenceLevel: 'dislike',
      });

      expect(await prefRepo.getPreferences(userId)).toHaveLength(2);

      // 2. Connect Spotify
      await spotifyRepo.saveConnection({
        userId,
        spotifyAccountId: 'spot-reconnect-acc',
        accessToken: 'access-initial',
        refreshToken: 'refresh-initial',
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
        scopes: ['user-top-read'],
      });

      expect((await spotifyRepo.getConnection(userId))?.status).toBe(
        'connected',
      );

      // 3. User disconnects Spotify
      await spotifyRepo.updateStatus(userId, 'disconnected');
      expect((await spotifyRepo.getConnection(userId))?.status).toBe(
        'disconnected',
      );
      // Tokens are inaccessible when disconnected
      expect(await spotifyRepo.getConnectionTokens(userId)).toBeNull();

      // INVARIANT CHECK: Manual user preferences must remain 100% intact!
      const prefsAfterDisconnect = await prefRepo.getPreferences(userId);
      expect(prefsAfterDisconnect).toHaveLength(2);
      expect(
        prefsAfterDisconnect.find((p) => p.id === prefAlpha.id)
          ?.preferenceLevel,
      ).toBe('favorite');
      expect(
        prefsAfterDisconnect.find((p) => p.id === prefBeta.id)?.preferenceLevel,
      ).toBe('dislike');

      // 4. User reconnects Spotify with new tokens
      await spotifyRepo.saveConnection({
        userId,
        spotifyAccountId: 'spot-reconnect-acc',
        accessToken: 'access-reconnected-new',
        refreshToken: 'refresh-reconnected-new',
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
        scopes: ['user-top-read'],
      });

      expect((await spotifyRepo.getConnection(userId))?.status).toBe(
        'connected',
      );
      expect((await spotifyRepo.getConnectionTokens(userId))?.accessToken).toBe(
        'access-reconnected-new',
      );

      // INVARIANT CHECK: Manual preferences still 100% intact after reconnect!
      const prefsAfterReconnect = await prefRepo.getPreferences(userId);
      expect(prefsAfterReconnect).toHaveLength(2);
      expect(
        prefsAfterReconnect.find((p) => p.id === prefAlpha.id)?.preferenceLevel,
      ).toBe('favorite');
      expect(
        prefsAfterReconnect.find((p) => p.id === prefBeta.id)?.preferenceLevel,
      ).toBe('dislike');
    });
  });
});
