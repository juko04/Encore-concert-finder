import { describe, expect, it } from 'vitest';
import {
  listAllEventsWithinRadius,
  listEventsNearHome,
  type NearListRepository,
} from '@/lib/location/near-search';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { EventListFilters } from '@/lib/repositories/interfaces';

const DENVER = { lat: 39.7392, lng: -104.9903 };

function ev(i: number, city: string | null, region = 'CO') {
  return { id: `e${i}`, city, region } as unknown as CanonicalEventSummary;
}

/** In-memory repo honouring limit/offset, recording calls. */
function repoOf(all: CanonicalEventSummary[]) {
  const calls: Array<{ limit?: number; offset?: number }> = [];
  const repo: NearListRepository = {
    async listEvents(f?: EventListFilters) {
      calls.push({ limit: f?.limit, offset: f?.offset });
      const o = f?.offset ?? 0;
      return all.slice(o, o + (f?.limit ?? all.length));
    },
  };
  return { repo, calls };
}

// 1200 far-away shows first, then 30 Denver shows beyond index 500, plus unknown locations.
const catalog: CanonicalEventSummary[] = [
  ...Array.from({ length: 1200 }, (_, i) => ev(i, 'Seattle', 'WA')),
  ...Array.from({ length: 30 }, (_, i) => ev(1200 + i, 'Denver')),
  ev(1230, null),
  ev(1231, 'Nowhereville', 'ZZ'),
];

describe('near search over the full catalog', () => {
  it('finds qualifying events beyond the first 500 and counts them all', async () => {
    const { repo } = repoOf(catalog);
    const r = await listEventsNearHome(repo, {}, DENVER, 25, {
      limit: 20,
      offset: 0,
    });
    expect(r.totalCount).toBe(30);
    expect(r.events.map((e) => e.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `e${1200 + i}`),
    );
    expect(r.hasMore).toBe(true);
  });

  it('pages with offset (Load More) and reports the end', async () => {
    const { repo } = repoOf(catalog);
    const p2 = await listEventsNearHome(repo, {}, DENVER, 25, {
      limit: 20,
      offset: 20,
    });
    expect(p2.events).toHaveLength(10);
    expect(p2.events[0].id).toBe('e1220');
    expect(p2.hasMore).toBe(false);
  });

  it('excludes unknown locations and walks every batch', async () => {
    const { repo, calls } = repoOf(catalog);
    const all = await listAllEventsWithinRadius(repo, {}, DENVER, 25);
    expect(all.some((e) => e.id === 'e1230' || e.id === 'e1231')).toBe(false);
    expect(calls.map((c) => c.offset)).toEqual([0, 500, 1000]);
  });

  it('preserves filters passed to the repository', async () => {
    const seen: EventListFilters[] = [];
    const repo: NearListRepository = {
      async listEvents(f) {
        seen.push(f!);
        return [];
      },
    };
    await listEventsNearHome(
      repo,
      { maxPrice: 40, includeUnknownPrice: false, sortBy: 'price_asc' },
      DENVER,
      25,
      { limit: 50, offset: 0 },
    );
    expect(seen[0]).toMatchObject({
      maxPrice: 40,
      includeUnknownPrice: false,
      sortBy: 'price_asc',
    });
  });

  it('stopAfter exits early with the first matches in order', async () => {
    const { repo, calls } = repoOf(catalog);
    const some = await listAllEventsWithinRadius(repo, {}, DENVER, 25, 500, 5);
    expect(some.map((e) => e.id)).toEqual([
      'e1200',
      'e1201',
      'e1202',
      'e1203',
      'e1204',
    ]);
    expect(calls).toHaveLength(3);
  });

  it('handles an empty catalog and exact batch multiples', async () => {
    const empty = await listEventsNearHome(repoOf([]).repo, {}, DENVER, 25, {
      limit: 50,
      offset: 0,
    });
    expect(empty).toEqual({ events: [], totalCount: 0, hasMore: false });
    const exact = Array.from({ length: 10 }, (_, i) => ev(i, 'Denver'));
    const r = await listAllEventsWithinRadius(
      repoOf(exact).repo,
      {},
      DENVER,
      25,
      5,
    );
    expect(r).toHaveLength(10);
  });
});
