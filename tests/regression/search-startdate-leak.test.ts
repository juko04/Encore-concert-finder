// Finding: /api/catalog/search disabled the started-show filter whenever an
// explicit startDate was supplied (excludePastShowtimes = !startDateParam), so
// "Tonight"/"This weekend" style URLs re-showed concerts that already began.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

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

// 2026-11-24T20:00:00Z = 13:00 in America/Denver on 2026-11-24
const NOW = new Date('2026-11-24T20:00:00Z');
const TODAY = '2026-11-24';

describe('REGRESSION search-startdate-leak', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockListEvents.mockReset().mockResolvedValue([]);
    mockCountEvents.mockReset().mockResolvedValue(0);
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    ['startDate = today (Tonight)', `startDate=${TODAY}&endDate=${TODAY}`],
    ['startDate = today, no endDate', `startDate=${TODAY}`],
    ['future startDate (weekend)', 'startDate=2026-11-28&endDate=2026-11-29'],
  ])('excludes already-started shows when %s', async (_n, qs) => {
    await GET(new Request(`http://localhost/api/catalog/search?${qs}`));
    const filters = mockListEvents.mock.calls[0][0];
    expect(filters.excludePastShowtimes).toBe(true);
    expect(filters.referenceNowIso).toBe(NOW.toISOString());
    const countFilters = mockCountEvents.mock.calls[0][0];
    expect(countFilters.excludePastShowtimes).toBe(true);
  });

  it('only allows historical ranges with explicit includePast=true', async () => {
    await GET(
      new Request(
        'http://localhost/api/catalog/search?startDate=2026-01-01&includePast=true',
      ),
    );
    expect(mockListEvents.mock.calls[0][0].excludePastShowtimes).toBe(false);
  });
});
