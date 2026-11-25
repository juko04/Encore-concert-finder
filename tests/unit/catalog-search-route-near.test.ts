import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { EventListFilters } from '@/lib/repositories/interfaces';

const HOME = { lat: 39.7392, lng: -104.9903 };
const all: CanonicalEventSummary[] = Array.from({ length: 600 }, (_, i) => {
  const near = i % 3 === 0;
  return {
    id: `e${String(i).padStart(4, '0')}`,
    title: `t${i}`,
    city: near ? 'Denver' : 'Seattle',
    region: near ? 'CO' : 'WA',
    localStartDate: '2030-01-01',
  } as never as CanonicalEventSummary;
});

const listEvents = vi.fn(async (f?: EventListFilters) => {
  const o = f?.offset ?? 0;
  return all.slice(o, o + (f?.limit ?? all.length));
});
const countEvents = vi.fn(async () => all.length);
const resolveNearContext = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/repositories/catalog-repository', () => ({
  SupabaseCatalogRepository: vi.fn().mockImplementation(() => ({
    listEvents: (f?: EventListFilters) => listEvents(f),
    countEvents: () => countEvents(),
  })),
}));
vi.mock('@/lib/location/near-context', () => ({
  resolveNearContext: () => resolveNearContext(),
}));

import { GET } from '@/app/api/catalog/search/route';
import { clearNearScanCache } from '@/lib/location/near-search';

describe('GET /api/catalog/search?near=1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearNearScanCache();
  });

  it('page 2 (Load More) is radius-filtered with the exact total, using server-derived scope', async () => {
    resolveNearContext.mockResolvedValue({
      scope: { home: HOME, radiusMiles: 25 },
    });
    const base = 'http://localhost/api/catalog/search?near=1&limit=50';
    const r1 = await (await GET(new Request(`${base}&page=1`))).json();
    const r2 = await (await GET(new Request(`${base}&page=2`))).json();
    expect(r1.pagination).toMatchObject({
      totalCount: 200,
      nearApplied: true,
      hasMore: true,
    });
    expect(r2.pagination).toMatchObject({ totalCount: 200, nearApplied: true });
    for (const e of [...r1.events, ...r2.events]) expect(e.city).toBe('Denver');
    expect(
      new Set([...r1.events, ...r2.events].map((e: { id: string }) => e.id))
        .size,
    ).toBe(100);
  });

  it('ignores client-supplied lat/lng/radius', async () => {
    resolveNearContext.mockResolvedValue({
      scope: { home: HOME, radiusMiles: 25 },
    });
    const r = await (
      await GET(
        new Request(
          'http://localhost/api/catalog/search?near=1&lat=47.6&lng=-122.3&radius=5000&radiusMiles=5000&limit=100',
        ),
      )
    ).json();
    expect(r.pagination.totalCount).toBe(200);
    expect(r.events.every((e: { city: string }) => e.city === 'Denver')).toBe(
      true,
    );
  });

  it('guest / no home location: near is not applied, ordinary paginated result', async () => {
    resolveNearContext.mockResolvedValue({ scope: null });
    const res = await GET(
      new Request('http://localhost/api/catalog/search?near=1&limit=50&page=2'),
    );
    const r = await res.json();
    expect(res.headers.get('X-Near-Applied')).toBe('false');
    expect(r.pagination).toMatchObject({ nearApplied: false, totalCount: 600 });
    expect(r.events).toHaveLength(50);
  });

  it('does not resolve a user at all when near is not requested', async () => {
    await GET(new Request('http://localhost/api/catalog/search?limit=50'));
    expect(resolveNearContext).not.toHaveBeenCalled();
  });
});
