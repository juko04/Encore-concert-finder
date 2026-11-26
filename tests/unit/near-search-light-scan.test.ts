import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearNearScanCache,
  listAllEventsWithinRadius,
  type NearListRepository,
} from '@/lib/location/near-search';
import { searchCatalogPage } from '@/lib/location/catalog-search';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type {
  EventListFilters,
  EventLocationRow,
} from '@/lib/repositories/interfaces';

const HOME = { lat: 39.7392, lng: -104.9903 };
const RADIUS = 25;

function ev(i: number, city: string | null, region = 'CO') {
  return {
    id: `e${String(i).padStart(5, '0')}`,
    title: `t${i}`,
    city,
    region,
    lat: null,
    lng: null,
  } as never as CanonicalEventSummary;
}

const catalog: CanonicalEventSummary[] = Array.from(
  { length: 2300 },
  (_, i) => {
    const m = i % 5;
    if (m === 0) return ev(i, 'Denver');
    if (m === 1) return ev(i, 'Seattle', 'WA');
    if (m === 2) return ev(i, 'Boulder');
    if (m === 3) return ev(i, null);
    return ev(i, 'Fort Collins');
  },
);

/** A repository with BOTH the full path and the light path, counting heavy work. */
function lightRepo(all: CanonicalEventSummary[]) {
  const listEvents = vi.fn(async (f?: EventListFilters) => {
    const o = f?.offset ?? 0;
    return all.slice(o, o + (f?.limit ?? all.length));
  });
  const listEventLocations = vi.fn(
    async (_f?: EventListFilters): Promise<EventLocationRow[]> =>
      all.map((e) => ({
        id: e.id,
        city: e.city ?? null,
        region: e.region ?? null,
        lat: e.lat ?? null,
        lng: e.lng ?? null,
      })),
  );
  const getEventsByIds = vi.fn(async (ids: string[]) => {
    const byId = new Map(all.map((e) => [e.id, e] as const));
    return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  });
  const repo: NearListRepository = {
    listEvents,
    listEventLocations,
    getEventsByIds,
  };
  return { repo, listEvents, listEventLocations, getEventsByIds };
}

describe('near search light scan (listEventLocations + getEventsByIds)', () => {
  beforeEach(() => clearNearScanCache());

  it('returns the same ids, order, total and pages as the full-batch scan', async () => {
    const { repo, listEvents } = lightRepo(catalog);
    const expected = await listAllEventsWithinRadius(
      { listEvents },
      {},
      HOME,
      RADIUS,
    );
    listEvents.mockClear();
    const seen: string[] = [];
    let total = -1;
    for (let offset = 0; ; offset += 50) {
      const p = await searchCatalogPage(
        repo,
        { limit: 50, offset },
        { home: HOME, radiusMiles: RADIUS },
        { cacheTtlMs: 0 },
      );
      expect(p.nearApplied).toBe(true);
      expect(p.events.length).toBeLessThanOrEqual(50);
      seen.push(...p.events.map((e) => e.id));
      total = p.totalCount;
      if (!p.hasMore) break;
    }
    expect(total).toBe(expected.length);
    expect(seen).toEqual(expected.map((e) => e.id));
    // The heavy listing path was never used.
    expect(listEvents).not.toHaveBeenCalled();
  });

  it('hydrates ONLY the requested page of ids and scans locations once per request', async () => {
    const { repo, listEventLocations, getEventsByIds } = lightRepo(catalog);
    const p = await searchCatalogPage(
      repo,
      { limit: 50, offset: 100 },
      { home: HOME, radiusMiles: RADIUS },
      { cacheTtlMs: 0 },
    );
    expect(listEventLocations).toHaveBeenCalledTimes(1);
    expect(getEventsByIds).toHaveBeenCalledTimes(1);
    expect(getEventsByIds.mock.calls[0][0]).toHaveLength(50);
    expect(p.events).toHaveLength(50);
    expect(p.hasMore).toBe(true);
  });

  it('forwards the shared filters to the scan and never passes limit/offset', async () => {
    const { repo, listEventLocations } = lightRepo(catalog);
    await searchCatalogPage(
      repo,
      {
        maxPrice: 40,
        includeUnknownPrice: false,
        sortBy: 'price_asc',
        fromDate: '2030-01-01',
        limit: 50,
        offset: 50,
      },
      { home: HOME, radiusMiles: RADIUS },
      { cacheTtlMs: 0 },
    );
    expect(listEventLocations).toHaveBeenCalledWith(
      expect.objectContaining({
        maxPrice: 40,
        includeUnknownPrice: false,
        sortBy: 'price_asc',
        fromDate: '2030-01-01',
        limit: undefined,
        offset: undefined,
      }),
    );
  });

  it('excludes unknown locations and dedupes ids; venue coordinates beat the city', async () => {
    const rows: EventLocationRow[] = [
      { id: 'a', city: 'Denver', region: 'CO', lat: null, lng: null },
      { id: 'a', city: 'Denver', region: 'CO', lat: null, lng: null }, // duplicate
      { id: 'b', city: 'Atlantis', region: 'ZZ', lat: null, lng: null }, // unknown
      { id: 'c', city: 'Nowhere', region: 'ZZ', lat: 47.6, lng: -122.3 }, // coord wins: out
      { id: 'd', city: 'Nowhere', region: 'ZZ', lat: 39.74, lng: -104.99 }, // coord: in
    ];
    const repo: NearListRepository = {
      listEvents: vi.fn(),
      listEventLocations: async () => rows,
      getEventsByIds: async (ids) =>
        ids.map((id) => ({ id }) as unknown as CanonicalEventSummary),
    };
    const p = await searchCatalogPage(
      repo,
      { limit: 50, offset: 0 },
      { home: HOME, radiusMiles: RADIUS },
      { cacheTtlMs: 0 },
    );
    expect(p.events.map((e) => e.id)).toEqual(['a', 'd']);
    expect(p.totalCount).toBe(2);
    expect(p.hasMore).toBe(false);
  });

  it('memoises only the id list: Load More pages re-use the scan but hydrate their own ids', async () => {
    const { repo, listEventLocations, getEventsByIds } = lightRepo(catalog);
    const scope = { home: HOME, radiusMiles: RADIUS };
    const opts = { cacheTtlMs: 60_000 };
    const p1 = await searchCatalogPage(
      repo,
      { limit: 50, offset: 0 },
      scope,
      opts,
    );
    const p2 = await searchCatalogPage(
      repo,
      { limit: 50, offset: 50 },
      scope,
      opts,
    );
    expect(listEventLocations).toHaveBeenCalledTimes(1);
    expect(getEventsByIds).toHaveBeenCalledTimes(2);
    expect(p2.totalCount).toBe(p1.totalCount);
    expect(p2.events[0].id).not.toBe(p1.events[0].id);
  });

  it('falls back to the full scan when the repository has no light methods', async () => {
    const listEvents = vi.fn(async (f?: EventListFilters) => {
      const o = f?.offset ?? 0;
      return catalog.slice(o, o + (f?.limit ?? catalog.length));
    });
    const p = await searchCatalogPage(
      { listEvents },
      { limit: 50, offset: 0 },
      { home: HOME, radiusMiles: RADIUS },
      { cacheTtlMs: 0 },
    );
    expect(listEvents).toHaveBeenCalled();
    expect(p.totalCount).toBe(
      catalog.filter((e) => ['Denver', 'Boulder'].includes(e.city ?? ''))
        .length,
    );
  });
});
