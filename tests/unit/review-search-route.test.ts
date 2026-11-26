import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListEvents = vi.fn();
const mockCountEvents = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/repositories/catalog-repository', () => ({
  SupabaseCatalogRepository: vi.fn().mockImplementation(() => ({
    listEvents: (...a: unknown[]) => mockListEvents(...a),
    countEvents: (...a: unknown[]) => mockCountEvents(...a),
  })),
}));

import { GET } from '@/app/api/catalog/search/route';
import { deriveLocalDateFromInstant } from '@/lib/domain/value-objects';

const get = (qs: string) =>
  GET(new Request(`http://localhost/api/catalog/search?${qs}`));
// With no timezone cookie or home city the route's viewer timezone is UTC (no hardcoded Colorado
// zone), so "today" here must be the UTC date or the test flakes in the evening Mountain Time.
const today = () => deriveLocalDateFromInstant(new Date().toISOString(), 'UTC');

describe('/api/catalog/search review regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListEvents.mockResolvedValue([]);
    mockCountEvents.mockResolvedValue(0);
  });

  it('Tonight (startDate=today) still excludes shows that already started', async () => {
    const res = await get(`startDate=${today()}&endDate=${today()}`);
    expect(res.status).toBe(200);
    expect(mockListEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        fromDate: today(),
        excludePastShowtimes: true,
      }),
    );
  });

  it('a past startDate is clamped to today unless includePast=true', async () => {
    await get('startDate=2020-01-01');
    expect(mockListEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fromDate: today(),
        excludePastShowtimes: true,
      }),
    );
    await get('startDate=2020-01-01&includePast=true');
    expect(mockListEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fromDate: '2020-01-01',
        excludePastShowtimes: false,
      }),
    );
  });

  it('page 2 of a broad query is a 200 with offset = (page-1)*limit', async () => {
    mockCountEvents.mockResolvedValue(173);
    const res = await get('q=a&limit=50&page=2');
    expect(res.status).toBe(200);
    expect(mockListEvents).toHaveBeenCalledWith(
      expect.objectContaining({ searchQuery: 'a', limit: 50, offset: 50 }),
    );
    const body = await res.json();
    expect(body.pagination).toMatchObject({
      page: 2,
      totalCount: 173,
      totalPages: 4,
    });
  });

  it.each([
    'startDate=not-a-date',
    'endDate=2026-02-31',
    'maxPrice=abc',
    'minPrice=Infinity',
    'timezone=Mars/Olympus',
  ])('returns 400 (not 500) for bad input: %s', async (qs) => {
    const res = await get(qs);
    expect(res.status).toBe(400);
    expect(mockListEvents).not.toHaveBeenCalled();
  });
});
