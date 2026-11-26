import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { matchListing, titleOverlap } from '@/lib/sources/seatgeek/matcher';
import {
  runMarketPriceSync,
  type MarketPriceStore,
} from '@/lib/sources/seatgeek/pipeline';
import { SeatGeekAuthError } from '@/lib/sources/seatgeek/client';
import type {
  CatalogEventForMatch,
  MarketListing,
} from '@/lib/sources/seatgeek/types';

// Synthetic places only; the matcher knows no real geography.
const HALL = { lat: 41.0, lng: -95.0 };
const NEARBY_SAME_NAME = { lat: 41.3, lng: -95.0 }; // ~21 mi
const FAR_SAME_NAME = { lat: 45.0, lng: -95.0 }; // ~276 mi

function event(
  over: Partial<CatalogEventForMatch> & { id: string },
): CatalogEventForMatch {
  return {
    name: 'Fixture Artist Alpha',
    eventKind: 'concert',
    localStartDate: '2031-03-14',
    localEndDate: '2031-03-14',
    startsAt: '2031-03-15T01:00:00.000Z',
    hasListedPrice: false,
    festivalGroupId: null,
    festivalGroupPrimary: false,
    venue: { name: 'Synthetic Ballroom', aliases: [], region: 'ZZ', ...HALL },
    artistNames: ['Fixture Artist Alpha'],
    ...over,
  };
}

function listing(over: Partial<MarketListing> = {}): MarketListing {
  return {
    marketplaceEventId: 'sg-1',
    title: 'Fixture Artist Alpha',
    url: 'https://seatgeek.com/fixture',
    isFestival: false,
    localDate: '2031-03-14',
    startsAtUtc: '2031-03-15T01:00:00.000Z',
    performers: ['Fixture Artist Alpha'],
    venue: {
      name: 'Synthetic Ballroom',
      city: 'Fixture City',
      state: 'ZZ',
      country: 'US',
      ...HALL,
    },
    lowestPrice: 48,
    averagePrice: 72,
    highestPrice: 210,
    listingCount: 120,
    currency: 'USD',
    ...over,
  };
}

describe('matcher: one show at the venue that day', () => {
  it('matches on a shared performer', () => {
    expect(matchListing(listing(), [event({ id: 'e1' })])).toMatchObject({
      kind: 'matched',
      eventId: 'e1',
      method: 'venue_date_performer',
    });
  });

  it('matches on title overlap when performers differ in form', () => {
    const outcome = matchListing(
      listing({
        title: 'An Evening with Fixture Artist Alpha',
        performers: ['F.A.A.'],
      }),
      [event({ id: 'e1' })],
    );
    expect(outcome).toMatchObject({
      kind: 'matched',
      method: 'venue_date_title',
    });
  });

  it('refuses a different act at the same venue and date', () => {
    const outcome = matchListing(
      listing({ title: 'Somebody Else', performers: ['Somebody Else'] }),
      [event({ id: 'e1' })],
    );
    expect(outcome).toMatchObject({
      kind: 'unmatched',
      reason: 'performer_mismatch',
    });
  });

  it('refuses a different date', () => {
    expect(
      matchListing(listing({ localDate: '2031-03-15' }), [event({ id: 'e1' })]),
    ).toMatchObject({ kind: 'unmatched', reason: 'no_event_at_venue_on_date' });
  });
});

describe('matcher: venue identity', () => {
  it('accepts the same coordinates under a different venue name', () => {
    const outcome = matchListing(
      listing({ venue: { ...listing().venue, name: 'Totally Renamed Hall' } }),
      [event({ id: 'e1' })],
    );
    expect(outcome.kind).toBe('matched');
  });

  it('accepts a venue alias', () => {
    const outcome = matchListing(
      listing({
        venue: {
          ...listing().venue,
          name: 'The Ballroom at Fixture',
          lat: null,
          lng: null,
        },
      }),
      [
        event({
          id: 'e1',
          venue: {
            ...event({ id: 'x' }).venue,
            aliases: ['Ballroom at Fixture'],
          },
        }),
      ],
    );
    expect(outcome.kind).toBe('matched');
  });

  it('accepts the same name nearby but not the same name far away', () => {
    const near = matchListing(
      listing({ venue: { ...listing().venue, ...NEARBY_SAME_NAME } }),
      [event({ id: 'e1' })],
    );
    const far = matchListing(
      listing({ venue: { ...listing().venue, ...FAR_SAME_NAME } }),
      [event({ id: 'e1' })],
    );
    expect(near.kind).toBe('matched');
    expect(far).toMatchObject({ kind: 'unmatched' });
  });

  it('needs the same state when a name matches without coordinates', () => {
    const noCoords = { lat: null, lng: null };
    const other = matchListing(
      listing({ venue: { ...listing().venue, ...noCoords, state: 'YY' } }),
      [event({ id: 'e1' })],
    );
    const same = matchListing(
      listing({ venue: { ...listing().venue, ...noCoords } }),
      [event({ id: 'e1' })],
    );
    expect(other.kind).toBe('unmatched');
    expect(same.kind).toBe('matched');
  });
});

describe('matcher: early and late shows', () => {
  const early = event({ id: 'early', startsAt: '2031-03-14T23:00:00.000Z' });
  const late = event({ id: 'late', startsAt: '2031-03-15T03:30:00.000Z' });

  it('picks the show whose start is within 90 minutes', () => {
    const outcome = matchListing(
      listing({ startsAtUtc: '2031-03-15T03:00:00.000Z' }),
      [early, late],
    );
    expect(outcome).toMatchObject({
      kind: 'matched',
      eventId: 'late',
      method: 'venue_date_time_performer',
    });
  });

  it('is ambiguous without a time', () => {
    expect(
      matchListing(listing({ startsAtUtc: null }), [early, late]),
    ).toMatchObject({
      kind: 'ambiguous',
      candidateIds: ['early', 'late'],
    });
  });

  it('is ambiguous when both starts are within tolerance', () => {
    const close = event({ id: 'close', startsAt: '2031-03-15T01:30:00.000Z' });
    expect(matchListing(listing(), [event({ id: 'e1' }), close])).toMatchObject(
      {
        kind: 'ambiguous',
        reason: 'several_shows_same_time',
      },
    );
  });
});

describe('matcher: festivals', () => {
  const primary = event({
    id: 'fest-primary',
    name: 'Fixture Fest 2031',
    eventKind: 'festival',
    localStartDate: '2031-06-20',
    localEndDate: '2031-06-22',
    festivalGroupId: 'g1',
    festivalGroupPrimary: true,
    venue: {
      name: 'Synthetic Fairgrounds',
      aliases: [],
      region: 'ZZ',
      lat: 41.05,
      lng: -95.05,
    },
    artistNames: [],
  });
  const day2 = {
    ...primary,
    id: 'fest-day-2',
    localStartDate: '2031-06-21',
    festivalGroupPrimary: false,
  };
  const pass = listing({
    title: 'Fixture Fest 2031 - 3 Day Pass',
    isFestival: true,
    localDate: '2031-06-20',
    performers: ['Fixture Fest'],
    venue: {
      ...listing().venue,
      name: 'Synthetic Fairgrounds',
      lat: 41.05,
      lng: -95.05,
    },
  });

  it('attaches a pass to the group primary', () => {
    expect(matchListing(pass, [primary, day2])).toMatchObject({
      kind: 'matched',
      eventId: 'fest-primary',
      method: 'festival_dates_name',
    });
  });

  it('attaches a day ticket sold as a concert to the group primary', () => {
    const dayTicket = {
      ...pass,
      isFestival: false,
      title: 'Fixture Fest 2031 Saturday',
      localDate: '2031-06-21',
    };
    expect(matchListing(dayTicket, [primary, day2])).toMatchObject({
      kind: 'matched',
      eventId: 'fest-primary',
    });
  });

  it('refuses a pass whose dates or name do not fit', () => {
    expect(
      matchListing({ ...pass, localDate: '2031-06-25' }, [primary]).kind,
    ).toBe('unmatched');
    expect(
      matchListing({ ...pass, title: 'Other Weekend 2031 Pass' }, [primary])
        .kind,
    ).toBe('unmatched');
  });

  it('ignores year and pass words when comparing names', () => {
    expect(
      titleOverlap('Fixture Fest 2031 - 3 Day Pass', 'Fixture Fest 2031'),
    ).toBe(1);
    expect(titleOverlap('VIP Weekend Pass', 'Fixture Fest')).toBe(0);
  });
});

describe('matcher: skips', () => {
  it('skips parking, TBD dates and empty listings', () => {
    const e = [event({ id: 'e1' })];
    expect(
      matchListing(listing({ title: 'PARKING: Fixture Artist Alpha' }), e),
    ).toMatchObject({
      kind: 'skipped',
      reason: 'not_admission',
    });
    expect(matchListing(listing({ localDate: null }), e)).toMatchObject({
      reason: 'date_tbd',
    });
    expect(
      matchListing(listing({ listingCount: 0, lowestPrice: null }), e),
    ).toMatchObject({
      reason: 'no_listings',
    });
  });
});

const FIXTURE = fs.readFileSync(
  path.resolve(__dirname, '../fixtures/seatgeek/events-page.json'),
  'utf-8',
);

function fakeStore(catalog: CatalogEventForMatch[]) {
  const store = {
    loadCatalogEvents: vi.fn().mockResolvedValue(catalog),
    saveRawIngest: vi.fn().mockResolvedValue('raw-1'),
    insertObservations: vi.fn(async (rows: unknown[]) => rows.length),
  };
  return store satisfies MarketPriceStore;
}

const fixtureCatalog = [
  event({ id: 'alpha' }),
  event({
    id: 'beta',
    name: 'Fixture Artist Beta',
    localStartDate: '2031-04-01',
    artistNames: ['Fixture Artist Beta'],
  }),
  event({
    id: 'priced',
    name: 'Someone Priced',
    localStartDate: '2031-03-20',
    artistNames: ['Someone Priced'],
    hasListedPrice: true,
  }),
  event({
    id: 'fest',
    name: 'Fixture Fest 2031',
    eventKind: 'festival',
    localStartDate: '2031-06-20',
    localEndDate: '2031-06-22',
    festivalGroupId: 'g1',
    festivalGroupPrimary: true,
    venue: {
      name: 'Synthetic Fairgrounds',
      aliases: [],
      region: 'ZZ',
      lat: 41.05,
      lng: -95.05,
    },
    artistNames: [],
  }),
];

const pageFetcher = (body: string) => ({
  fetchEventsPage: vi.fn().mockResolvedValue({
    sourceUrl: 'https://api.seatgeek.com/2/events?venue.state=ZZ&page=1',
    status: 200,
    body,
  }),
});

const baseOptions = {
  sourceId: 'source-1',
  states: ['zz'],
  fromDate: '2031-01-01',
  toDate: '2031-12-31',
  now: () => new Date('2031-01-01T12:00:00Z'),
};

describe('market price sync pipeline', () => {
  it('dry run writes nothing and reports coverage', async () => {
    const store = fakeStore(fixtureCatalog);
    const report = await runMarketPriceSync({
      ...baseOptions,
      fetcher: pageFetcher(FIXTURE),
      store,
    });
    expect(store.saveRawIngest).not.toHaveBeenCalled();
    expect(store.insertObservations).not.toHaveBeenCalled();
    expect(report.mode).toBe('dry_run');
    expect(report.states).toEqual(['ZZ']);
    expect(report.listingsFetched).toBe(6);
    expect(report.matched).toBe(2);
    expect(report.matchedByMethod).toEqual({
      venue_date_performer: 1,
      festival_dates_name: 1,
    });
    expect(report.skipped).toEqual({
      not_admission: 1,
      no_listings: 1,
      date_tbd: 1,
    });
    expect(report.unmatched).toEqual({ no_event_at_venue_on_date: 1 });
    // alpha, beta, fest are unpriced in ZZ; alpha and fest gained a price.
    expect(report.coverage).toMatchObject({
      upcomingUnpriced: 3,
      unpricedGained: 2,
      percent: 66.7,
      festivalsUnpriced: 1,
      festivalsGained: 1,
    });
    expect(report.coverage.topVenues[0]).toEqual({
      venueName: 'Synthetic Ballroom',
      unpriced: 2,
      gained: 1,
    });
  });

  it('write mode stores the page, then appends observations pointing at it', async () => {
    const store = fakeStore(fixtureCatalog);
    const report = await runMarketPriceSync({
      ...baseOptions,
      fetcher: pageFetcher(FIXTURE),
      store,
      write: true,
    });
    expect(store.saveRawIngest).toHaveBeenCalledTimes(1);
    const saved = store.saveRawIngest.mock.calls[0][0];
    expect(saved.sourceUrl).not.toContain('client_id');
    expect(saved.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const rows = store.insertObservations.mock.calls[0][0] as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.rawIngestId).toBe('raw-1');
      expect(row.sourceId).toBe('source-1');
      expect(row.observedAt).toBe('2031-01-01T12:00:00.000Z');
    }
    expect(rows.find((r) => r.eventId === 'alpha')).toMatchObject({
      lowestPrice: 48,
      currency: 'USD',
      marketplaceEventId: '7000001',
    });
    expect(report.observationsInserted).toBe(2);
  });

  it('drops all listings that collide on one ordinary show', async () => {
    const body = JSON.parse(FIXTURE);
    body.events.push({ ...body.events[0], id: 7000099 });
    const report = await runMarketPriceSync({
      ...baseOptions,
      fetcher: pageFetcher(JSON.stringify(body)),
      store: fakeStore(fixtureCatalog),
    });
    expect(report.collisions).toBe(2);
    expect(report.ambiguous.several_listings_one_event).toBe(1);
    expect(report.matched).toBe(1); // only the festival remains
  });

  it('keeps the cheapest pass when several match one festival', async () => {
    const body = JSON.parse(FIXTURE);
    const cheaper = {
      ...body.events[2],
      id: 7000098,
      title: 'Fixture Fest 2031 - Saturday Pass',
    };
    cheaper.stats = { ...cheaper.stats, lowest_price: 95 };
    body.events.push(cheaper);
    const store = fakeStore(fixtureCatalog);
    await runMarketPriceSync({
      ...baseOptions,
      fetcher: pageFetcher(JSON.stringify(body)),
      store,
      write: true,
    });
    const rows = store.insertObservations.mock.calls[0][0] as Array<
      Record<string, unknown>
    >;
    expect(rows.find((r) => r.eventId === 'fest')).toMatchObject({
      lowestPrice: 95,
      marketplaceEventId: '7000098',
    });
  });

  it('stops with auth_failed and touches nothing when the key is rejected', async () => {
    const store = fakeStore(fixtureCatalog);
    const report = await runMarketPriceSync({
      ...baseOptions,
      fetcher: {
        fetchEventsPage: vi.fn().mockRejectedValue(new SeatGeekAuthError(401)),
      },
      store,
      write: true,
    });
    expect(report.status).toBe('auth_failed');
    expect(store.loadCatalogEvents).not.toHaveBeenCalled();
    expect(store.insertObservations).not.toHaveBeenCalled();
  });

  it('requires at least one state (no default region)', async () => {
    await expect(
      runMarketPriceSync({
        ...baseOptions,
        states: [],
        fetcher: pageFetcher(FIXTURE),
        store: fakeStore([]),
      }),
    ).rejects.toThrow(/state/);
  });
});
