import { describe, expect, it, vi } from 'vitest';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';

vi.mock('@/lib/recommendation/service', () => ({
  getPersonalizedDiscoverData: vi.fn(),
}));

import { getDiscoverHomeData } from '@/lib/discover/home-data';
import { getPersonalizedDiscoverData } from '@/lib/recommendation/service';

function ev(
  id: string,
  overrides: Partial<CanonicalEventSummary> = {},
): CanonicalEventSummary {
  return {
    id,
    title: `Show ${id}`,
    venueName: 'Room A',
    city: 'Denver',
    localStartDate: '2026-12-01',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    artists: [{ name: `Artist ${id}`, billingPosition: 'headliner' }],
    ...overrides,
  };
}

const NOW = new Date('2026-11-23T18:00:00Z');

function repo(
  listEvents: (f: Record<string, unknown>) => CanonicalEventSummary[],
) {
  return {
    listEvents: vi.fn(async (f?: Record<string, unknown>) =>
      listEvents(f ?? {}),
    ),
    countEvents: vi.fn(async () => 42),
  };
}

describe('getDiscoverHomeData', () => {
  it('omits rows with no events and never invents a just-announced row', async () => {
    const data = await getDiscoverHomeData({
      catalogRepo: repo(() => []),
      now: NOW,
    });
    expect(data.rows).toEqual([]);
    expect(data.totalUpcoming).toBe(42);
  });

  it('drops cancelled shows from every row', async () => {
    const data = await getDiscoverHomeData({
      catalogRepo: repo(() => [ev('ok'), ev('gone', { status: 'cancelled' })]),
      now: NOW,
    });
    const ids = data.rows.flatMap((r) =>
      r.events.map((e) => ('event' in e ? e.event.id : e.id)),
    );
    expect(ids).toContain('ok');
    expect(ids).not.toContain('gone');
  });

  it('shows the under-$30 row only with enough verified prices', async () => {
    const priced = (n: number) =>
      repo((f) =>
        f.maxPrice === 30
          ? Array.from({ length: n }, (_, i) => ev(`p${i}`, { minPrice: 20 }))
          : [],
      );

    const few = await getDiscoverHomeData({ catalogRepo: priced(3), now: NOW });
    expect(few.rows.find((r) => r.id === 'under-30')).toBeUndefined();

    const enough = await getDiscoverHomeData({
      catalogRepo: priced(4),
      now: NOW,
    });
    expect(enough.rows.find((r) => r.id === 'under-30')?.events).toHaveLength(
      4,
    );
  });

  it('does not count unknown-price or $0 events as under-$30', async () => {
    const data = await getDiscoverHomeData({
      catalogRepo: repo((f) =>
        f.maxPrice === 30
          ? [
              ev('a', { minPrice: null }),
              ev('b', { minPrice: 0 }),
              ev('c', { minPrice: 10 }),
              ev('d', { minPrice: 10 }),
              ev('e', { minPrice: 10 }),
              ev('f', { minPrice: 10 }),
            ]
          : [],
      ),
      now: NOW,
    });
    const ids = data.rows
      .find((r) => r.id === 'under-30')
      ?.events.map((e) => ('event' in e ? e.event.id : e.id));
    expect(ids).toEqual(['c', 'd', 'e', 'f']);
  });

  it('falls back silently when personalization throws', async () => {
    vi.mocked(getPersonalizedDiscoverData).mockRejectedValueOnce(
      new Error('boom'),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = await getDiscoverHomeData({
      catalogRepo: repo(() => [ev('x')]),
      userId: 'u1',
      now: NOW,
    });
    expect(data.rows.find((r) => r.id === 'picked')).toBeUndefined();
    expect(data.rows.length).toBeGreaterThan(0);
    spy.mockRestore();
  });
});
