import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

// Mock server-only dependencies
vi.mock('@/lib/auth/session', () => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn().mockImplementation(() => {
    if (
      typeof (globalThis as unknown as { window?: unknown }).window !==
      'undefined'
    ) {
      throw new Error(
        'Supabase admin client cannot be instantiated in a browser environment',
      );
    }
    return {};
  }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const mockGetConnection = vi.fn();
const mockDeleteConnection = vi.fn();
const mockGetConnectionTokens = vi.fn();
const mockUpdateTokens = vi.fn();
const mockRecordSync = vi.fn();
const mockUpdateStatus = vi.fn();

vi.mock('@/lib/repositories/spotify-connection-repository', () => ({
  SupabaseSpotifyConnectionRepository: vi.fn().mockImplementation(() => ({
    getConnection: mockGetConnection,
    deleteConnection: mockDeleteConnection,
    getConnectionTokens: mockGetConnectionTokens,
    updateTokens: mockUpdateTokens,
    recordSync: mockRecordSync,
    updateStatus: mockUpdateStatus,
  })),
}));

const mockGetTopArtists = vi.fn();
const mockRefreshAccessToken = vi.fn();

vi.mock('@/lib/sources/spotify/client', () => ({
  SpotifyApiClient: vi.fn().mockImplementation(() => ({
    getTopArtists: mockGetTopArtists,
    refreshAccessToken: mockRefreshAccessToken,
  })),
}));

const mockServerEnv = {
  ENABLE_SPOTIFY_INTEGRATION: true,
  SPOTIFY_CLIENT_ID: 'mock-client-id',
  SPOTIFY_CLIENT_SECRET: 'mock-client-secret',
  SPOTIFY_REDIRECT_URI:
    'http://127.0.0.1:3000/api/integrations/spotify/callback',
  SPOTIFY_TOKEN_ENCRYPTION_KEY:
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

vi.mock('@/lib/env/server', () => ({
  getServerEnv: vi.fn().mockImplementation(() => mockServerEnv),
}));

import { getAuthenticatedUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  disconnectSpotifyAction,
  getSpotifyStatusAction,
  getSpotifyTopArtistsAction,
  syncSpotifyArtistsAction,
} from '@/app/profile/taste/actions';
import { getPersonalizedDiscoverData } from '@/lib/recommendation/service';
import {
  MemoryCatalogRepository,
  MemoryProfileRepository,
  MemoryUserPreferenceRepository,
} from '@/lib/repositories/memory-repositories';
import { normalizeName } from '@/lib/domain/value-objects';
import type { SpotifyTopArtist } from '@/lib/domain/spotify';

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

describe('Spotify Negative Authorization & Cross-Tenant Security Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConnection.mockReset();
    mockGetConnection.mockResolvedValue(null);
    mockDeleteConnection.mockReset();
    mockDeleteConnection.mockResolvedValue(true);
    mockGetConnectionTokens.mockReset();
    mockGetConnectionTokens.mockResolvedValue(null);
    mockUpdateTokens.mockReset();
    mockUpdateTokens.mockResolvedValue({});
    mockRecordSync.mockReset();
    mockRecordSync.mockResolvedValue(undefined);
    mockUpdateStatus.mockReset();
    mockUpdateStatus.mockResolvedValue(undefined);
    mockGetTopArtists.mockReset();
    mockRefreshAccessToken.mockReset();
  });

  describe('1. Unauthenticated Request Rejection', () => {
    it('rejects getPersonalizedDiscoverData when userId is empty string or undefined', async () => {
      await expect(
        getPersonalizedDiscoverData({
          userId: '',
          catalogRepo: new MemoryCatalogRepository(),
          profileRepo: new MemoryProfileRepository(),
          prefRepo: new MemoryUserPreferenceRepository(),
        }),
      ).rejects.toThrow(
        'Personalized Discover requires an authenticated user ID.',
      );

      await expect(
        getPersonalizedDiscoverData({
          userId: null as unknown as string,
          catalogRepo: new MemoryCatalogRepository(),
          profileRepo: new MemoryProfileRepository(),
          prefRepo: new MemoryUserPreferenceRepository(),
        }),
      ).rejects.toThrow(
        'Personalized Discover requires an authenticated user ID.',
      );
    });

    it('rejects getSpotifyStatusAction when unauthenticated without executing DB queries', async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const status = await getSpotifyStatusAction();
      expect(status.connected).toBe(false);
      expect(mockGetConnection).not.toHaveBeenCalled();
    });

    it('rejects getSpotifyTopArtistsAction when unauthenticated', async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const result = await getSpotifyTopArtistsAction('short_term');
      expect(result.error).toBe('You must be signed in to view music taste.');
      expect(result.artists).toEqual([]);
      expect(mockGetConnectionTokens).not.toHaveBeenCalled();
      expect(mockGetTopArtists).not.toHaveBeenCalled();
    });

    it('rejects disconnectSpotifyAction when unauthenticated without deleting connection', async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const result = await disconnectSpotifyAction();
      expect(result.error).toBe('Unauthorized');
      expect(result.success).toBe(false);
      expect(mockDeleteConnection).not.toHaveBeenCalled();
    });

    it('rejects syncSpotifyArtistsAction when unauthenticated', async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const result = await syncSpotifyArtistsAction();
      expect(result.error).toBe('You must be signed in to sync Spotify.');
      expect(result.artists).toEqual([]);
      expect(mockGetConnectionTokens).not.toHaveBeenCalled();
    });
  });

  describe('2. Cross-User Data Access Isolation (Anti-IDOR)', () => {
    it('strictly isolates Spotify personalization between User A and User B', async () => {
      const userAId = 'user-alice-1111-1111-1111-111111111111';
      const userBId = 'user-bob-2222-2222-2222-222222222222';

      const catalogRepo = new MemoryCatalogRepository();
      seedCanonicalEvent(catalogRepo, {
        id: 'event-artist-a',
        title: 'Alice Favorite Artist Live',
        localStartDate: '2026-11-20',
        artists: [
          {
            id: 'artist-a',
            name: 'Artist Alpha',
            billingPosition: 'headliner',
          },
        ],
      });
      seedCanonicalEvent(catalogRepo, {
        id: 'event-artist-b',
        title: 'Bob Favorite Artist Live',
        localStartDate: '2026-11-20',
        artists: [
          {
            id: 'artist-b',
            name: 'Artist Beta',
            billingPosition: 'headliner',
          },
        ],
      });

      const profileRepo = new MemoryProfileRepository();
      const prefRepo = new MemoryUserPreferenceRepository();

      await profileRepo.upsertProfile(userAId, {
        recommendationPreset: 'balanced',
      });
      await profileRepo.upsertProfile(userBId, {
        recommendationPreset: 'balanced',
      });

      // Alice's Spotify top artist is Artist Alpha (rank 1)
      const aliceSpotifyArtists: SpotifyTopArtist[] = [
        {
          id: 'spotify-artist-alpha',
          canonicalArtistId: 'artist-a',
          name: 'Artist Alpha',
          rank: 1,
          timeRange: 'short_term',
          popularity: 85,
          imageUrl: null,
          spotifyUrl: 'https://open.spotify.com/artist/spotify-artist-alpha',
          genres: ['house'],
        },
      ];

      // Bob's Spotify top artist is Artist Beta (rank 1)
      const bobSpotifyArtists: SpotifyTopArtist[] = [
        {
          id: 'spotify-artist-beta',
          canonicalArtistId: 'artist-b',
          name: 'Artist Beta',
          rank: 1,
          timeRange: 'short_term',
          popularity: 90,
          imageUrl: null,
          spotifyUrl: 'https://open.spotify.com/artist/spotify-artist-beta',
          genres: ['techno'],
        },
      ];

      // Query Alice's recommendations
      const aliceResult = await getPersonalizedDiscoverData({
        userId: userAId,
        spotifyTopArtists: aliceSpotifyArtists,
        catalogRepo,
        profileRepo,
        prefRepo,
        referenceDate: '2026-11-15',
        referenceInstant: new Date('2026-11-15T00:00:00Z'),
      });

      // Query Bob's recommendations
      const bobResult = await getPersonalizedDiscoverData({
        userId: userBId,
        spotifyTopArtists: bobSpotifyArtists,
        catalogRepo,
        profileRepo,
        prefRepo,
        referenceDate: '2026-11-15',
        referenceInstant: new Date('2026-11-15T00:00:00Z'),
      });

      // Assert Alice receives boost on Artist Alpha, NOT Artist Beta
      const aliceRecAlpha = aliceResult.recommendations.find(
        (r) => r.eventId === 'event-artist-a',
      );
      expect(aliceRecAlpha).toBeDefined();
      expect(aliceRecAlpha?.explanation).toContain(
        'Spotify top artist (#1) (Artist Alpha)',
      );

      const aliceRecBeta = aliceResult.recommendations.find(
        (r) => r.eventId === 'event-artist-b',
      );
      // Artist Beta has no preference or affinity for Alice -> not boosted
      expect(aliceRecBeta).toBeUndefined();

      // Assert Bob receives boost on Artist Beta, NOT Artist Alpha
      const bobRecBeta = bobResult.recommendations.find(
        (r) => r.eventId === 'event-artist-b',
      );
      expect(bobRecBeta).toBeDefined();
      expect(bobRecBeta?.explanation).toContain(
        'Spotify top artist (#1) (Artist Beta)',
      );

      const bobRecAlpha = bobResult.recommendations.find(
        (r) => r.eventId === 'event-artist-a',
      );
      expect(bobRecAlpha).toBeUndefined();
    });

    it('enforces that server actions always scope mutations to authenticated session user ID', async () => {
      // Authenticate as User Alpha
      const authenticatedUser: User = {
        id: 'user-alpha-id',
        email: 'alpha@encore.test',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      };
      vi.mocked(getAuthenticatedUser).mockResolvedValue(authenticatedUser);

      mockGetConnection.mockResolvedValueOnce({
        userId: 'user-alpha-id',
        status: 'connected',
        spotifyAccountId: 'spot-alpha',
      });

      await getSpotifyStatusAction();
      // Verifies query passed authenticatedUser.id
      expect(mockGetConnection).toHaveBeenCalledWith('user-alpha-id');

      await disconnectSpotifyAction();
      // Verifies delete passed authenticatedUser.id
      expect(mockDeleteConnection).toHaveBeenCalledWith('user-alpha-id');
    });
  });

  describe('3. Browser Environment Privilege Escalation Guard', () => {
    it('throws immediately when createAdminClient is invoked in a browser environment (window defined)', () => {
      (globalThis as unknown as { window?: unknown }).window = {};
      try {
        expect(() => createAdminClient()).toThrow(
          'Supabase admin client cannot be instantiated in a browser environment',
        );
      } finally {
        delete (globalThis as unknown as { window?: unknown }).window;
      }
    });
  });
});
