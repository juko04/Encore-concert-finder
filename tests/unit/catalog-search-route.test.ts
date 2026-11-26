import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';

const mockListEvents = vi.fn();
const mockCountEvents = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/repositories/catalog-repository', () => ({
  SupabaseCatalogRepository: vi.fn().mockImplementation(() => ({
    listEvents: (...args: unknown[]) => mockListEvents(...args),
    countEvents: (...args: unknown[]) => mockCountEvents(...args),
  })),
}));

import { GET } from '@/app/api/catalog/search/route';

describe('GET /api/catalog/search (Server-side Pagination & Filter Route)', () => {
  const sampleEvent: CanonicalEventSummary = {
    id: 'ev-1',
    title: 'The National at Mission Ballroom',
    venueName: 'Mission Ballroom',
    venueId: 'venue-mb',
    city: 'Denver',
    region: 'CO',
    lat: 39.7712,
    lng: -104.9754,
    localStartDate: '2026-10-15',
    startsAt: '2026-10-15T20:00:00Z',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    eventKind: 'concert',
    artists: [
      {
        id: 'art-nat',
        name: 'The National',
        billingPosition: 'headliner',
      },
    ],
    minPrice: 55,
    maxPrice: 85,
    currency: 'USD',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts and passes all filter parameters to listEvents and countEvents without 300 limit truncation', async () => {
    mockListEvents.mockResolvedValueOnce([sampleEvent]);
    mockCountEvents.mockResolvedValueOnce(542);

    const url =
      'http://localhost/api/catalog/search?q=National&venueId=venue-mb&city=Denver&startDate=2026-10-01&endDate=2026-10-31&includePast=true&minPrice=40&maxPrice=100&freeOnly=false&sort=price_asc&page=2&limit=50';
    const req = new Request(url);

    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();

    // Verify filters passed to listEvents
    expect(mockListEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        searchQuery: 'National',
        venueId: 'venue-mb',
        venueName: undefined,
        city: 'Denver',
        genre: undefined,
        fromDate: '2026-10-01',
        toDate: '2026-10-31',
        excludePastShowtimes: false, // includePast=true is the only opt-out
        minPrice: 40,
        maxPrice: 100,
        freeOnly: undefined,
        includeUnknownPrice: true,
        sortBy: 'price_asc',
        limit: 50,
        offset: 50, // (page 2 - 1) * 50
      }),
    );

    // Verify filters passed to countEvents
    expect(mockCountEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        searchQuery: 'National',
        venueId: 'venue-mb',
        city: 'Denver',
        fromDate: '2026-10-01',
        toDate: '2026-10-31',
      }),
    );

    // Verify structured response
    expect(data.events).toHaveLength(1);
    expect(data.events[0].id).toBe('ev-1');
    expect(data.pagination).toEqual({
      page: 2,
      limit: 50,
      totalCount: 542,
      totalPages: 11,
      hasMore: true,
      nearApplied: false,
    });

    // Verify pagination headers
    expect(res.headers.get('X-Total-Count')).toBe('542');
    expect(res.headers.get('X-Page')).toBe('2');
    expect(res.headers.get('X-Limit')).toBe('50');
    expect(res.headers.get('X-Total-Pages')).toBe('11');
    expect(res.headers.get('X-Has-More')).toBe('true');
  });

  it('supports custom offset directly and handles last page hasMore=false', async () => {
    mockListEvents.mockResolvedValueOnce([sampleEvent]);
    mockCountEvents.mockResolvedValueOnce(101);

    const url = 'http://localhost/api/catalog/search?limit=50&offset=100';
    const req = new Request(url);

    const res = await GET(req);
    const data = await res.json();

    expect(data.pagination).toEqual({
      page: 3,
      limit: 50,
      totalCount: 101,
      totalPages: 3,
      hasMore: false,
      nearApplied: false,
    });
    expect(res.headers.get('X-Has-More')).toBe('false');
  });

  it('supports freeOnly filter flag', async () => {
    mockListEvents.mockResolvedValueOnce([]);
    mockCountEvents.mockResolvedValueOnce(0);

    const url = 'http://localhost/api/catalog/search?freeOnly=true';
    const req = new Request(url);

    await GET(req);

    expect(mockListEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        freeOnly: true,
      }),
    );
  });

  it('supports format=array for legacy backward-compatibility while preserving headers', async () => {
    mockListEvents.mockResolvedValueOnce([sampleEvent]);
    mockCountEvents.mockResolvedValueOnce(1);

    const url = 'http://localhost/api/catalog/search?format=array';
    const req = new Request(url);

    const res = await GET(req);
    const data = await res.json();

    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    expect(res.headers.get('X-Total-Count')).toBe('1');
  });

  it('supports includeUnknownPrice=false and sorts', async () => {
    mockListEvents.mockResolvedValueOnce([]);
    mockCountEvents.mockResolvedValueOnce(0);

    const url =
      'http://localhost/api/catalog/search?includeUnknownPrice=false&sort=price_desc';
    const req = new Request(url);

    await GET(req);

    expect(mockListEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        includeUnknownPrice: false,
        sortBy: 'price_desc',
      }),
    );
  });

  it('returns 500 when catalog repository throws error', async () => {
    mockListEvents.mockRejectedValueOnce(new Error('Database unavailable'));

    const req = new Request('http://localhost/api/catalog/search');
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Database unavailable');
  });

  it('handles GET /api/catalog/search?venueId=Red+Rocks+Amphitheatre&sort=date_asc&limit=50&page=2 gracefully without HTTP 500', async () => {
    mockListEvents.mockResolvedValueOnce([]);
    mockCountEvents.mockResolvedValueOnce(3);

    const url =
      'http://localhost/api/catalog/search?venueId=Red+Rocks+Amphitheatre&sort=date_asc&limit=50&page=2';
    const req = new Request(url);

    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(mockListEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        venueId: 'Red Rocks Amphitheatre',
        sortBy: 'date_asc',
        limit: 50,
        offset: 50,
      }),
    );
    expect(data.events).toEqual([]);
    expect(data.pagination).toEqual({
      page: 2,
      limit: 50,
      totalCount: 3,
      totalPages: 1,
      hasMore: false,
      nearApplied: false,
    });
  });
});
