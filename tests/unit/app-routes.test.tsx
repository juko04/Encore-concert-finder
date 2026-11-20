// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock dependencies with vi.hoisted to ensure availability before hoisted vi.mock
const {
  mockGetAuthenticatedUser,
  mockNotFound,
  mockListEvents,
  mockGetEventById,
  mockGetPersonalizedDiscoverData,
  mockGetPublicDiscoverData,
  mockGetPreferences,
  mockGetProfile,
  mockRankEvents,
  mockSupabaseClient,
} = vi.hoisted(() => {
  const mockSupabaseClient = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    })),
  };
  return {
    mockGetAuthenticatedUser: vi.fn(),
    mockNotFound: vi.fn(() => {
      const err = new Error('NEXT_NOT_FOUND');
      (err as unknown as { digest: string }).digest = 'NEXT_NOT_FOUND';
      throw err;
    }),
    mockListEvents: vi.fn(),
    mockGetEventById: vi.fn(),
    mockGetPersonalizedDiscoverData: vi.fn(),
    mockGetPublicDiscoverData: vi.fn(),
    mockGetPreferences: vi.fn(),
    mockGetProfile: vi.fn(),
    mockRankEvents: vi.fn(),
    mockSupabaseClient,
  };
});

vi.mock('@/lib/auth/session', () => ({
  getAuthenticatedUser: () => mockGetAuthenticatedUser(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  redirect: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi
    .fn()
    .mockImplementation(() => Promise.resolve(mockSupabaseClient)),
}));

vi.mock('@/lib/repositories/catalog-repository', () => ({
  SupabaseCatalogRepository: vi.fn().mockImplementation(() => ({
    listEvents: (...args: unknown[]) => mockListEvents(...args),
    getEventById: (...args: unknown[]) => mockGetEventById(...args),
  })),
}));

vi.mock('@/lib/recommendation/service', () => ({
  getPersonalizedDiscoverData: (...args: unknown[]) =>
    mockGetPersonalizedDiscoverData(...args),
  getPublicDiscoverData: (...args: unknown[]) =>
    mockGetPublicDiscoverData(...args),
}));

vi.mock('@/lib/repositories/user-preference-repository', () => ({
  SupabaseUserPreferenceRepository: vi.fn().mockImplementation(() => ({
    getPreferences: (...args: unknown[]) => mockGetPreferences(...args),
  })),
}));

vi.mock('@/lib/repositories/profile-repository', () => ({
  SupabaseProfileRepository: vi.fn().mockImplementation(() => ({
    getProfile: (...args: unknown[]) => mockGetProfile(...args),
  })),
}));

vi.mock('@/lib/recommendation/engine', () => ({
  rankEvents: (...args: unknown[]) => mockRankEvents(...args),
}));

import HomePage from '@/app/page';
import ConcertDetailPage from '@/app/concerts/[id]/page';
import SearchPage from '@/app/search/page';
import SavedPage from '@/app/saved/page';
import { GET as searchApiHandler } from '@/app/api/catalog/search/route';
import type {
  CanonicalEventDetail,
  CanonicalEventSummary,
} from '@/lib/domain/catalog';

describe('App Router Catalog Integration Routes', () => {
  const sampleSummary: CanonicalEventSummary = {
    id: 'event-101',
    title: 'Phoebe Bridgers at Red Rocks',
    venueName: 'Red Rocks Amphitheatre',
    venueId: 'venue-rr',
    city: 'Morrison',
    region: 'CO',
    lat: 39.6654,
    lng: -105.2057,
    localStartDate: '2026-08-15',
    startsAt: '2026-08-15T19:30:00-06:00',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    eventKind: 'concert',
    artists: [
      {
        id: 'artist-pb',
        name: 'Phoebe Bridgers',
        billingPosition: 'headliner',
      },
    ],
    ticketUrl: 'https://tickets.example.com/pb-rr',
    minPrice: 55,
    maxPrice: 120,
    currency: 'USD',
    inventoryStatus: 'available',
    sourceName: 'Official Venue Calendar',
  };

  const sampleEventDetail: CanonicalEventDetail = {
    id: 'event-101',
    name: 'Phoebe Bridgers at Red Rocks',
    normalizedName: 'phoebe-bridgers-at-red-rocks',
    eventKind: 'concert',
    status: 'scheduled',
    venueId: 'venue-rr',
    city: 'Morrison',
    region: 'CO',
    countryCode: 'US',
    lat: 39.6654,
    lng: -105.2057,
    timezone: 'America/Denver',
    localStartDate: '2026-08-15',
    startsAt: '2026-08-15T19:30:00-06:00',
    startTimePrecision: 'instant',
    doorsAt: '18:00',
    isMultiDay: false,
    officialUrl: 'https://redrocksonline.com/pb',
    primaryTicketUrl: 'https://tickets.example.com/pb-rr',
    artists: [
      {
        id: 'artist-pb',
        name: 'Phoebe Bridgers',
        billingPosition: 'headliner',
      },
    ],
    venue: {
      id: 'venue-rr',
      name: 'Red Rocks Amphitheatre',
      city: 'Morrison',
      region: 'CO',
    },
    ticketLinks: [
      {
        id: 'tl-1',
        eventId: 'event-101',
        url: 'https://tickets.example.com/pb-rr',
        normalizedUrl: 'https://tickets.example.com/pb-rr',
        minPrice: 55,
        maxPrice: 120,
        currency: 'USD',
        inventoryStatus: 'available',
      },
    ],
    promoters: [],
    sources: [
      {
        sourceId: 'src-1',
        sourceUrl: 'https://redrocksonline.com/pb',
        confidence: 1,
      },
    ],
    fieldEvidence: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUser.mockResolvedValue(null);
    mockListEvents.mockResolvedValue([sampleSummary]);
    mockGetEventById.mockResolvedValue(sampleEventDetail);
    mockGetPublicDiscoverData.mockResolvedValue({
      events: [sampleSummary],
      isEmptyCatalog: false,
      totalCount: 1,
      activeMode: 'all',
    });
  });

  describe('GET / (HomePage)', () => {
    it('renders initial catalog concerts from repository for guest users', async () => {
      mockGetAuthenticatedUser.mockResolvedValueOnce(null);
      mockGetPublicDiscoverData.mockResolvedValueOnce({
        events: [sampleSummary],
        isEmptyCatalog: false,
        totalCount: 1,
        activeMode: 'all',
      });

      const jsx = await HomePage();
      render(jsx);

      expect(screen.getByText('ENCORE')).toBeInTheDocument();
      expect(screen.getAllByText(/Phoebe Bridgers/i).length).toBeGreaterThan(0);
      expect(
        screen.getAllByText(/Red Rocks Amphitheatre/i).length,
      ).toBeGreaterThan(0);
    });

    it('renders personalized recommendations when user is authenticated', async () => {
      mockGetAuthenticatedUser.mockResolvedValueOnce({
        id: 'user-42',
        email: 'phoebe_fan@example.com',
      });

      mockGetPersonalizedDiscoverData.mockResolvedValueOnce({
        recommendations: [
          {
            eventId: 'event-101',
            score: 95,
            explanation: '★ Favorite artist (Phoebe Bridgers)',
            presetUsed: 'balanced',
            weights: { artist: 50, distance: 20, price: 20, timing: 10 },
            isSuppressed: false,
            isExploratory: false,
            event: sampleSummary,
            matchedArtist: { name: 'Phoebe Bridgers', isFavorite: true },
            factors: {
              artist: { score: 100, weight: 50, explanation: 'Favorite' },
              distance: { score: 90, weight: 20, explanation: 'Close' },
              price: { score: 90, weight: 20, explanation: 'Fair' },
              timing: { score: 100, weight: 10, explanation: 'Weekend' },
            },
            diagnostics: { dataAvailability: {}, rawMetrics: {} },
          },
        ],
        exploratory: [],
        suppressed: [],
        ineligibleCount: 0,
        totalCandidateCount: 1,
        userProfile: null,
        activePreset: 'balanced',
        activeWeights: { artist: 50, distance: 20, price: 20, timing: 10 },
        activeMode: 'all',
        hasPreferences: true,
        isSpotifyConnected: true,
        isLocationConfigured: true,
        isEmptyCatalog: false,
      });

      const jsx = await HomePage();
      render(jsx);

      expect(mockGetPersonalizedDiscoverData).toHaveBeenCalledWith({
        userId: 'user-42',
      });
      expect(screen.getAllByText(/Phoebe Bridgers/i).length).toBeGreaterThan(0);
    });

    it('falls back gracefully to public catalog when personalization throws', async () => {
      mockGetAuthenticatedUser.mockResolvedValueOnce({
        id: 'user-error',
        email: 'err@example.com',
      });
      mockGetPersonalizedDiscoverData.mockRejectedValueOnce(
        new Error('Database timeout'),
      );
      mockGetPublicDiscoverData.mockResolvedValueOnce({
        events: [sampleSummary],
        isEmptyCatalog: false,
        totalCount: 1,
        activeMode: 'all',
      });

      const jsx = await HomePage();
      render(jsx);

      expect(screen.getAllByText(/Phoebe Bridgers/i).length).toBeGreaterThan(0);
    });
  });

  describe('GET /concerts/[id] (ConcertDetailPage)', () => {
    it('renders 404 via notFound() when event ID does not exist', async () => {
      mockGetEventById.mockResolvedValueOnce(null);

      await expect(
        ConcertDetailPage({
          params: Promise.resolve({ id: 'non-existent-uuid' }),
        }),
      ).rejects.toThrow('NEXT_NOT_FOUND');

      expect(mockNotFound).toHaveBeenCalled();
    });

    it('renders concert details for a valid event ID', async () => {
      mockGetEventById.mockResolvedValueOnce(sampleEventDetail);

      const jsx = await ConcertDetailPage({
        params: Promise.resolve({ id: 'event-101' }),
      });
      render(jsx);

      expect(screen.getAllByText(/Phoebe Bridgers/i).length).toBeGreaterThan(0);
      expect(
        screen.getAllByText(/Red Rocks Amphitheatre/i).length,
      ).toBeGreaterThan(0);
      expect(screen.getByText(/Official Tickets/i)).toBeInTheDocument();
    });

    it('passes through inventoryStatus === sold_out cleanly to the client', async () => {
      const soldOutDetail: CanonicalEventDetail = {
        ...sampleEventDetail,
        ticketLinks: [
          {
            ...sampleEventDetail.ticketLinks[0],
            inventoryStatus: 'sold_out',
          },
        ],
      };
      mockGetEventById.mockResolvedValueOnce(soldOutDetail);

      const jsx = await ConcertDetailPage({
        params: Promise.resolve({ id: 'event-101' }),
      });
      render(jsx);

      // Verifies 'Sold Out' status badge and/or ticket button label
      expect(screen.getAllByText(/Sold Out/i).length).toBeGreaterThan(0);
    });

    it('computes personalized score for authenticated user viewing concert', async () => {
      mockGetAuthenticatedUser.mockResolvedValueOnce({
        id: 'user-77',
        email: 'listener@example.com',
      });
      mockGetEventById.mockResolvedValueOnce(sampleEventDetail);
      mockGetPreferences.mockResolvedValueOnce([
        {
          userId: 'user-77',
          artistId: 'artist-pb',
          artistName: 'Phoebe Bridgers',
          preferenceLevel: 'favorite',
        },
      ]);
      mockGetProfile.mockResolvedValueOnce({
        id: 'user-77',
        typicalBudget: 100,
        travelRadiusMiles: 50,
      });
      mockRankEvents.mockReturnValueOnce({
        recommendations: [
          {
            eventId: 'event-101',
            score: 98,
            explanation: '★ Favorite artist match',
            presetUsed: 'balanced',
            weights: { artist: 50, distance: 20, price: 20, timing: 10 },
            isSuppressed: false,
            isExploratory: false,
            event: sampleSummary,
            matchedArtist: { name: 'Phoebe Bridgers', isFavorite: true },
            factors: {
              artist: { score: 100, weight: 50, explanation: 'Favorite' },
              distance: { score: 95, weight: 20, explanation: 'Near' },
              price: { score: 95, weight: 20, explanation: 'Affordable' },
              timing: { score: 100, weight: 10, explanation: 'Ideal' },
            },
            diagnostics: { dataAvailability: {}, rawMetrics: {} },
          },
        ],
        exploratory: [],
        suppressed: [],
      });

      const jsx = await ConcertDetailPage({
        params: Promise.resolve({ id: 'event-101' }),
      });
      render(jsx);

      expect(mockRankEvents).toHaveBeenCalled();
      expect(screen.getAllByText(/Phoebe Bridgers/i).length).toBeGreaterThan(0);
    });
  });

  describe('GET /search (SearchPage)', () => {
    it('queries repository and passes results to SearchClient with initialQuery', async () => {
      mockListEvents.mockResolvedValueOnce([sampleSummary]);

      const jsx = await SearchPage({
        searchParams: Promise.resolve({ q: 'Bridgers' }),
      });
      render(jsx);

      expect(mockListEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          searchQuery: 'Bridgers',
        }),
      );
      expect(screen.getAllByText(/Phoebe Bridgers/i).length).toBeGreaterThan(0);
    });
  });

  describe('GET /saved (SavedPage)', () => {
    it('renders SavedWatchlistClient with events from catalog repository', async () => {
      mockListEvents.mockResolvedValueOnce([sampleSummary]);

      const jsx = await SavedPage();
      render(jsx);

      expect(mockListEvents).toHaveBeenCalled();
      expect(
        screen.getByRole('heading', { name: /Saved Shows/i }),
      ).toBeInTheDocument();
    });
  });

  describe('GET /api/catalog/search (Search API Route)', () => {
    it('handles query parameters, filters by price, and returns JSON events', async () => {
      const cheapEvent: CanonicalEventSummary = {
        ...sampleSummary,
        id: 'event-cheap',
        minPrice: 15,
        maxPrice: 20,
      };
      const expensiveEvent: CanonicalEventSummary = {
        ...sampleSummary,
        id: 'event-expensive',
        minPrice: 150,
        maxPrice: 200,
      };

      mockListEvents.mockResolvedValueOnce([cheapEvent, expensiveEvent]);

      const req = new Request(
        'http://localhost/api/catalog/search?q=rock&minPrice=10&maxPrice=50&sort=price_asc',
      );
      const res = await searchApiHandler(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('event-cheap');
    });

    it('returns 500 when repository throws an error', async () => {
      mockListEvents.mockRejectedValueOnce(new Error('Connection failure'));

      const req = new Request('http://localhost/api/catalog/search');
      const res = await searchApiHandler(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe('Connection failure');
    });
  });
});
