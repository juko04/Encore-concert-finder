import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearNearScanCache,
  listAllEventsWithinRadius,
  listEventsNearHome,
  type NearListRepository,
} from '@/lib/location/near-search';
import { searchCatalogPage } from '@/lib/location/catalog-search';
import { eventDistanceMiles } from '@/lib/location/radius';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { EventListFilters } from '@/lib/repositories/interfaces';

const HOME = { lat: 39.7392, lng: -104.9903 };
const RADIUS = 25;

function ev(i: number, city: string | null, region = 'CO') {
  return {
    id: `e${String(i).padStart(5, '0')}`,
    city,
    region,
  } as never as CanonicalEventSummary;
}

// Interleave in-range (Denver/Boulder), out-of-range (Seattle/Fort Collins) and unknown.
const catalog: CanonicalEventSummary[] = Array.from(
  { length: 1300 },
  (_, i) => {
    const m = i % 5;
    if (m === 0) return ev(i, 'Denver');
    if (m === 1) return ev(i, 'Seattle', 'WA');
    if (m === 2) return ev(i, 'Boulder');
    if (m === 3) return ev(i, null);
    return ev(i, 'Fort Collins');
  },
);

function repoOf(all: CanonicalEventSummary[]) {
  const calls: Array<{ limit?: number; offset?: number }> = [];
  const repo = {
    async listEvents(f?: EventListFilters) {
      calls.push({ limit: f?.limit, offset: f?.offset });
      const o = f?.offset ?? 0;
      return all.slice(o, o + (f?.limit ?? all.length));
    },
  } satisfies NearListRepository;
  return { repo, calls };
}

describe('shared near-search across pages (first page == Load More)', () => {
  beforeEach(() => clearNearScanCache());

  it('every page is within the radius, pages concatenate to the full exact set, total matches', async () => {
    const { repo } = repoOf(catalog);
    const expected = catalog.filter((e) => {
      const d = eventDistanceMiles(e as never, HOME);
      return d !== null && d <= RADIUS;
    });
    const seen: string[] = [];
    let total = -1;
    for (let offset = 0; ; offset += 50) {
      const p = await searchCatalogPage(
        repo,
        { limit: 50, offset },
        { home: HOME, radiusMiles: RADIUS },
        { cacheTtlMs: 0, concurrency: 1 },
      );
      expect(p.nearApplied).toBe(true);
      for (const e of p.events) {
        const d = eventDistanceMiles(e as never, HOME);
        expect(d).not.toBeNull();
        expect(d!).toBeLessThanOrEqual(RADIUS);
      }
      seen.push(...p.events.map((e) => e.id));
      total = p.totalCount;
      if (!p.hasMore) break;
    }
    expect(total).toBe(expected.length);
    expect(seen).toEqual(expected.map((e) => e.id)); // same order, no dups, no gaps
  });

  it('concurrent waves return exactly the same list as the sequential scan', async () => {
    const { repo } = repoOf(catalog);
    const seq = await listAllEventsWithinRadius(
      repo,
      {},
      HOME,
      RADIUS,
      100,
      Infinity,
      1,
    );
    for (const c of [2, 4, 7]) {
      const par = await listAllEventsWithinRadius(
        repo,
        {},
        HOME,
        RADIUS,
        100,
        Infinity,
        c,
      );
      expect(par.map((e) => e.id)).toEqual(seq.map((e) => e.id));
    }
  });

  it('memoises the scan between Load More pages only when a TTL is set', async () => {
    const { repo, calls } = repoOf(catalog);
    const opts = { cacheTtlMs: 60_000, concurrency: 1 };
    const p1 = await listEventsNearHome(
      repo,
      { limit: 50, offset: 0 },
      HOME,
      RADIUS,
      { limit: 50, offset: 0 },
      opts,
    );
    const afterFirst = calls.length;
    const p2 = await listEventsNearHome(
      repo,
      { limit: 50, offset: 50 },
      HOME,
      RADIUS,
      { limit: 50, offset: 50 },
      opts,
    );
    expect(calls.length).toBe(afterFirst); // second page served from the cached scan
    expect(p2.totalCount).toBe(p1.totalCount);
    expect(p2.events[0].id).not.toBe(p1.events[0].id);

    // A different radius or filter is a different result set.
    await listEventsNearHome(
      repo,
      { limit: 50, offset: 0 },
      HOME,
      5,
      { limit: 50, offset: 0 },
      opts,
    );
    expect(calls.length).toBeGreaterThan(afterFirst);

    clearNearScanCache();
    const before = calls.length;
    await listEventsNearHome(
      repo,
      {},
      HOME,
      RADIUS,
      { limit: 50, offset: 0 },
      { cacheTtlMs: 0 },
    );
    await listEventsNearHome(
      repo,
      {},
      HOME,
      RADIUS,
      { limit: 50, offset: 0 },
      { cacheTtlMs: 0 },
    );
    expect(calls.length - before).toBe(2 * Math.ceil(catalog.length / 500));
  });

  it('passes price/sort filters to the repository on every batch', async () => {
    const listEvents = vi.fn(async () => [] as CanonicalEventSummary[]);
    await searchCatalogPage(
      { listEvents },
      {
        maxPrice: 40,
        includeUnknownPrice: false,
        sortBy: 'price_asc',
        limit: 50,
        offset: 50,
      },
      { home: HOME, radiusMiles: RADIUS },
      { cacheTtlMs: 0 },
    );
    expect(listEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        maxPrice: 40,
        includeUnknownPrice: false,
        sortBy: 'price_asc',
        limit: 500,
        offset: 0,
      }),
    );
  });

  it('without a near scope it delegates to listEvents/countEvents (no scan)', async () => {
    const listEvents = vi.fn(async () => [ev(1, 'Seattle', 'WA')]);
    const countEvents = vi.fn(async () => 120);
    const p = await searchCatalogPage(
      { listEvents, countEvents },
      { limit: 50, offset: 50 },
      null,
    );
    expect(p).toMatchObject({
      totalCount: 120,
      hasMore: true,
      nearApplied: false,
    });
    expect(listEvents).toHaveBeenCalledTimes(1);
  });
});
