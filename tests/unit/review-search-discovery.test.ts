import { describe, expect, it, vi } from 'vitest';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';

vi.mock('@/lib/recommendation/service', () => ({
  getPersonalizedDiscoverData: vi.fn(),
}));

import { getDiscoverHomeData } from '@/lib/discover/home-data';
import {
  isIsoDate,
  isValidTimeZone,
  resolveCatalogFromDate,
} from '@/lib/discover/dates';

describe('resolveCatalogFromDate (startDate / Tonight leakage)', () => {
  const today = '2026-11-24';

  it('clamps an explicit startDate of today and still drops started shows', () => {
    expect(resolveCatalogFromDate({ startDate: today, today })).toEqual({
      fromDate: today,
      excludePastShowtimes: true,
    });
  });

  it('never lets a past startDate re-admit past shows', () => {
    expect(resolveCatalogFromDate({ startDate: '2026-01-01', today })).toEqual({
      fromDate: today,
      excludePastShowtimes: true,
    });
  });

  it('keeps a future startDate and defaults to today', () => {
    expect(resolveCatalogFromDate({ startDate: '2026-12-05', today })).toEqual({
      fromDate: '2026-12-05',
      excludePastShowtimes: true,
    });
    expect(resolveCatalogFromDate({ today })).toEqual({
      fromDate: today,
      excludePastShowtimes: true,
    });
  });

  it('only includePast=true opts out', () => {
    expect(
      resolveCatalogFromDate({
        startDate: '2026-01-01',
        today,
        includePast: true,
      }),
    ).toEqual({ fromDate: '2026-01-01', excludePastShowtimes: false });
  });
});

describe('param validators', () => {
  it('accepts real dates and rejects malformed ones', () => {
    expect(isIsoDate('2026-11-24')).toBe(true);
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(isIsoDate('11/24/2026')).toBe(false);
    expect(isIsoDate('abc')).toBe(false);
  });
  it('validates timezones', () => {
    expect(isValidTimeZone('America/Denver')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

function ev(id: string, o: Partial<CanonicalEventSummary> = {}) {
  return {
    id,
    title: id,
    venueName: 'Room',
    city: 'Denver',
    localStartDate: '2026-11-27',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    artists: [],
    ...o,
  } as CanonicalEventSummary;
}

describe('home row duplicate rule', () => {
  const NOW = new Date('2026-11-23T18:00:00Z');
  // Real-shaped overlap: weekend shows are also inside the next-7-days window
  // and in Denver; free shows are inside all of them.
  const weekendShows = [
    ev('w1', { localStartDate: '2026-11-27' }),
    ev('w2', { localStartDate: '2026-11-28' }),
  ];
  const midweek = [
    ev('m1', { localStartDate: '2026-11-25' }),
    ev('m2', { localStartDate: '2026-11-26' }),
  ];
  const far = [ev('f1', { localStartDate: '2027-01-20' })];
  const free = [ev('w1', { localStartDate: '2026-11-27' })];

  const repo = {
    countEvents: vi.fn(async () => 5),
    listEvents: vi.fn(async (f?: Record<string, unknown>) => {
      if (f?.freeOnly) return free;
      if (f?.maxPrice !== undefined) return [];
      if (f?.fromDate === '2026-11-27' && f?.toDate === '2026-11-29')
        return weekendShows;
      if (f?.toDate === '2026-11-30' && f?.fromDate === '2026-11-23')
        return [...weekendShows, ...midweek];
      if (typeof f?.fromDate === 'string' && f.fromDate >= '2026-12-23')
        return far;
      return [...weekendShows, ...midweek, ...far];
    }),
  };

  it('lists a show in at most one time/city row, but free overlap is allowed', async () => {
    const data = await getDiscoverHomeData({ catalogRepo: repo, now: NOW });
    const idsIn = (rowId: string) =>
      (data.rows.find((r) => r.id === rowId)?.events ?? []).map((e) =>
        'event' in e ? e.event.id : e.id,
      );
    const claiming = data.rows
      .filter(
        (r) =>
          r.id === 'weekend' ||
          r.id === 'next-7-days' ||
          r.id === 'plan-ahead' ||
          r.id.startsWith('city-'),
      )
      .flatMap((r) => r.events.map((e) => ('event' in e ? e.event.id : e.id)));
    expect(new Set(claiming).size).toBe(claiming.length);
    expect(idsIn('weekend')).toEqual(expect.arrayContaining(['w1', 'w2']));
    expect(idsIn('next-7-days')).not.toContain('w1');
    expect(idsIn('free')).toContain('w1'); // intentional overlap
  });
});
