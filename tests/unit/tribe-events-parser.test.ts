import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CrawlContext } from '@/lib/domain/source';
import {
  BOHEMIAN_LIVE_MUSIC_API_URL,
  BOHEMIAN_LIVE_MUSIC_CONFIG,
  TEN_MILE_MUSIC_HALL_API_URL,
  TEN_MILE_MUSIC_HALL_CONFIG,
  TribeEventsAdapter,
  decodeHtmlText,
  extractTribeGenres,
  parseBilling,
  parseTribeEvents,
  type TribeEvent,
  type VenueHttpClient,
} from '@/lib/sources/venue';

const fixture = (name: string) =>
  fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures', name), 'utf-8');
const bohemian = fixture('bohemian-live-music-events-response.json');
const tenMile = fixture('ten-mile-music-hall-events-response.json');

const baseCtx = {
  sourceId: 'src',
  sourceUrl: 'https://example.org/wp-json/tribe/events/v1/events',
  fetchedAt: '2026-11-25T12:00:00.000Z',
  contentHash: 'hash',
  parserVersion: '1.0.0',
};
const bohemianCtx = {
  ...baseCtx,
  defaultVenueConfig: BOHEMIAN_LIVE_MUSIC_CONFIG,
  useConfigVenueFallback: false,
};
const tenMileCtx = {
  ...baseCtx,
  defaultVenueConfig: TEN_MILE_MUSIC_HALL_CONFIG,
};

function find<T extends { title: string }>(list: T[], prefix: string): T {
  const hit = list.find((c) => c.title.startsWith(prefix));
  if (!hit) throw new Error(`not found: ${prefix}`);
  return hit;
}

describe('parseBilling', () => {
  it('splits headliner and supports only on explicit markers', () => {
    expect(
      parseBilling('Sunsquabi with Chris Karns, Dark City Agent').artists.map(
        (a) => [a.name, a.billingPosition],
      ),
    ).toEqual([
      ['Sunsquabi', 'headliner'],
      ['Chris Karns', 'support'],
      ['Dark City Agent', 'support'],
    ]);
    expect(
      parseBilling('Mouse Powell w/ Special Guest Amp Melo').artists.map(
        (a) => a.name,
      ),
    ).toEqual(['Mouse Powell', 'Amp Melo']);
    expect(parseBilling('Simon & Garfunkel Tribute').artists).toHaveLength(1);
  });

  it('strips status prefixes/suffixes and tour subtitles', () => {
    const r = parseBilling('*RESCHEDULED* The Band – Reflections Tour 2027');
    expect(r.isRescheduled).toBe(true);
    expect(r.artists[0].name).toBe('The Band');
    const sold = parseBilling('Jkyl & Hyde with Klo – SOLD OUT');
    expect(sold.isSoldOutInTitle).toBe(true);
    expect(sold.cleanTitle).toBe('Jkyl & Hyde with Klo');
    expect(parseBilling('CANCELLED - Foo Fighters').isCancelled).toBe(true);
    expect(parseBilling('An Evening with Firefall').artists[0].name).toBe(
      'Firefall',
    );
  });
});

describe('decodeHtmlText', () => {
  it('decodes entities', () => {
    expect(decodeHtmlText('Washington&#8217;s &amp; Co')).toBe(
      'Washington’s & Co',
    );
    expect(decodeHtmlText(undefined)).toBe('');
  });
});

describe('parseTribeEvents (Bohemian Live Music: Washington’s + The Armory)', () => {
  const list = parseTribeEvents(bohemian, bohemianCtx);

  it('parses every event with its own venue and city', () => {
    expect(list).toHaveLength(10);
    const venues = new Set(list.map((c) => c.venueName));
    expect(venues).toEqual(new Set(['Washington’s', 'The Armory']));
    expect(find(list, 'An Evening with Firefall').venueName).toBe('The Armory');
    for (const c of list) {
      expect(c.city).toBe('Fort Collins');
      expect(c.state).toBe('CO');
      expect(c.timezone).toBe('America/Denver');
    }
  });

  it('computes instant start times in the event timezone (MST and MDT-free winter)', () => {
    const big = find(list, 'Big Richard');
    expect(big.localStartDate).toBe('2026-12-05');
    expect(big.startTimePrecision).toBe('instant');
    expect(big.startsAt).toBe('2026-12-06T02:00:00.000Z'); // 7 pm MST
  });

  it('uses listed prices, treats ranges as min/max, and never zero for unknown', () => {
    const big = find(list, 'Big Richard');
    expect(big.price).toMatchObject({
      min: 18.96,
      max: 24.11,
      currency: 'USD',
    });
    expect(big.price?.isFree).toBe(false);
    expect(find(list, 'Pokey').price).toMatchObject({ min: 29.25, max: 29.25 });
  });

  it('flags sold-out from the site cost text', () => {
    expect(find(list, 'FATHER JOHN').inventoryStatus).toBe('sold_out');
    expect(find(list, 'Big Richard').inventoryStatus).toBe('unknown');
  });

  it('carries only the genre the site states, exactly as written', () => {
    expect(find(list, 'FATHER JOHN').rawPayload?.genres).toEqual([
      'Alternative/Indie Rock',
    ]);
    expect(find(list, 'Big Richard').rawPayload?.genres).toEqual(['Americana']);
  });

  it('splits headliner/support and strips tour/anniversary suffixes', () => {
    expect(find(list, 'Cursive').artistNames).toEqual(['Cursive']);
    expect(find(list, 'Drag the River').artistNames).toEqual([
      'Drag the River',
    ]);
    expect(find(list, 'The Lone Bellow').artistNames).toEqual([
      'The Lone Bellow',
    ]);
    const kcsu = find(list, 'KCSU');
    expect(kcsu.artists?.[0]).toMatchObject({
      name: 'KCSU SubZer0',
      billingPosition: 'headliner',
    });
    expect(
      kcsu.artists?.slice(1).every((a) => a.billingPosition === 'support'),
    ).toBe(true);
    expect(kcsu.rawPayload?.isRescheduled).toBe(true);
    expect(kcsu.title.startsWith('RESCHEDULED')).toBe(false);
  });

  it('keeps https images and uses the event page as ticket link when none is given', () => {
    const big = find(list, 'Big Richard');
    expect(
      (big.rawPayload?.images as { eventImageUrl: string }).eventImageUrl,
    ).toMatch(/^https:\/\//);
    expect(big.ticketUrl).toBe(big.provenance.sourceUrl);
    expect(big.provenance.sourceEventId).toMatch(/^bohemian-live-music:\d+$/);
  });
});

describe('parseTribeEvents (10 Mile Music Hall)', () => {
  const list = parseTribeEvents(tenMile, tenMileCtx);

  it('parses the Frisco calendar', () => {
    expect(list).toHaveLength(7);
    for (const c of list) {
      expect(c.venueName).toBe('10 Mile Music Hall');
      expect(c.city).toBe('Frisco');
    }
  });

  it('marks FREE only when the cost says free and leaves other empty costs unknown', () => {
    const open = find(list, 'OPEN DECKS');
    expect(open.price).toEqual({
      isFree: true,
      min: 0,
      max: 0,
      currency: 'USD',
    });
    expect(open.eventKind).toBe('free_event');
    expect(find(list, 'Railroad Earth').price).toBeUndefined();
    expect(find(list, 'Other Brothers').price).toMatchObject({
      min: 15,
      max: 15,
    });
  });

  it('handles sold-out titles, external ticket links and missing genres', () => {
    const jkyl = find(list, 'Jkyl');
    expect(jkyl.title).toBe('Jkyl & Hyde with Klo');
    expect(jkyl.inventoryStatus).toBe('sold_out');
    expect(jkyl.ticketUrl).toBe('https://tixr.com/e/211796');
    expect(jkyl.artistNames).toEqual(['Jkyl & Hyde', 'Klo']);
    for (const c of list) expect(c.rawPayload?.genres).toBeUndefined();
  });

  it('ignores website values that are not absolute http(s) URLs', () => {
    const latin = find(list, 'LATIN PARTY');
    expect(latin.ticketUrl).toBe(latin.provenance.sourceUrl);
  });
});

describe('parseTribeEvents edge cases', () => {
  const ev = (over: Partial<TribeEvent>): string =>
    JSON.stringify({
      events: [
        {
          id: 1,
          url: 'https://example.org/event/x/',
          title: 'Some Band',
          status: 'publish',
          all_day: false,
          start_date: '2027-06-01 20:00:00',
          timezone: 'America/Denver',
          cost: '',
          cost_details: { values: [] },
          website: '',
          venue: { venue: 'Room', city: 'Frisco', stateprovince: 'CO' },
          ...over,
        },
      ],
    });

  it('returns nothing for empty, invalid or event-less payloads', () => {
    expect(parseTribeEvents('', tenMileCtx)).toEqual([]);
    expect(parseTribeEvents('not json', tenMileCtx)).toEqual([]);
    expect(parseTribeEvents('{"events":[]}', tenMileCtx)).toEqual([]);
    expect(parseTribeEvents('{"code":"rest_no_route"}', tenMileCtx)).toEqual(
      [],
    );
  });

  it('skips closure notices, hidden and virtual listings', () => {
    expect(
      parseTribeEvents(ev({ title: 'Closed for Private Event' }), tenMileCtx),
    ).toEqual([]);
    expect(
      parseTribeEvents(ev({ hide_from_listings: true }), tenMileCtx),
    ).toEqual([]);
    expect(parseTribeEvents(ev({ is_virtual: true }), tenMileCtx)).toEqual([]);
  });

  it('uses date_only for all-day events and honors DST (MDT)', () => {
    const [allDay] = parseTribeEvents(ev({ all_day: true }), tenMileCtx);
    expect(allDay.startTimePrecision).toBe('date_only');
    expect(allDay.startsAt).toBeUndefined();
    const [summer] = parseTribeEvents(ev({}), tenMileCtx);
    expect(summer.startsAt).toBe('2027-06-02T02:00:00.000Z'); // 8 pm MDT
  });

  it('does not invent a venue for multi-venue calendars without fallback', () => {
    expect(parseTribeEvents(ev({ venue: [] }), bohemianCtx)).toEqual([]);
    const [c] = parseTribeEvents(ev({ venue: [] }), tenMileCtx);
    expect(c.venueName).toBe('10 Mile Music Hall');
  });

  it('keeps non-https images out of the candidate', () => {
    const [c] = parseTribeEvents(
      ev({ image: { url: 'http://example.org/a.jpg' } }),
      tenMileCtx,
    );
    expect(c.rawPayload?.images).toBeUndefined();
  });

  it('reads Genre custom fields only', () => {
    expect(
      extractTribeGenres({
        id: 1,
        custom_fields: {
          a: { label: 'Genre', value: 'Funk ' },
          b: { label: 'Door', value: 'Side' },
        },
      }),
    ).toEqual(['Funk']);
    expect(extractTribeGenres({ id: 1, custom_fields: [] })).toEqual([]);
  });
});

describe('TribeEventsAdapter', () => {
  const crawlCtx: CrawlContext = {
    sourceId: 'src',
    sourceType: 'venue',
    acquisitionMethod: 'html_http',
    targetUrl: TEN_MILE_MUSIC_HALL_CONFIG.calendarUrl,
    crawlStartedAt: '2026-11-25T12:00:00.000Z',
  };
  const resp = (url: string, body: string) => ({
    url,
    status: 200,
    contentType: 'application/json',
    body,
    fetchedAt: '2026-11-25T12:00:00.000Z',
  });

  it('requests the Tribe API with per_page and start_date and parses events', async () => {
    const get = vi.fn((url: string) => Promise.resolve(resp(url, tenMile)));
    const adapter = new TribeEventsAdapter(TEN_MILE_MUSIC_HALL_CONFIG, {
      apiUrl: TEN_MILE_MUSIC_HALL_API_URL,
      httpClient: { get } as unknown as VenueHttpClient,
      startDate: '2026-11-25',
    });
    const { rawIngests, candidates } = await adapter.crawl(crawlCtx);
    expect(get).toHaveBeenCalledTimes(1);
    const url = new URL(get.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe(TEN_MILE_MUSIC_HALL_API_URL);
    expect(url.searchParams.get('per_page')).toBe('50');
    expect(url.searchParams.get('start_date')).toBe('2026-11-25');
    expect(rawIngests).toHaveLength(1);
    expect(candidates).toHaveLength(7);
  });

  it('follows same-host pagination only, bounded by maxPages, and dedupes', async () => {
    const page1 = JSON.stringify({
      ...JSON.parse(bohemian),
      next_rest_url:
        'https://bohemianlivemusic.org/wp-json/tribe/events/v1/events?page=2',
    });
    const page2 = JSON.stringify({
      ...JSON.parse(bohemian),
      next_rest_url: 'https://evil.example.com/wp-json/next',
    });
    const get = vi
      .fn()
      .mockImplementationOnce((u: string) => Promise.resolve(resp(u, page1)))
      .mockImplementationOnce((u: string) => Promise.resolve(resp(u, page2)));
    const adapter = new TribeEventsAdapter(BOHEMIAN_LIVE_MUSIC_CONFIG, {
      apiUrl: BOHEMIAN_LIVE_MUSIC_API_URL,
      httpClient: { get } as unknown as VenueHttpClient,
      useConfigVenueFallback: false,
      requestDelayMs: 0,
    });
    const { rawIngests, candidates } = await adapter.crawl(crawlCtx);
    expect(get).toHaveBeenCalledTimes(2);
    expect(rawIngests).toHaveLength(2);
    expect(candidates).toHaveLength(10); // duplicates across pages collapse
  });

  it('surfaces HTTP failures', async () => {
    const adapter = new TribeEventsAdapter(TEN_MILE_MUSIC_HALL_CONFIG, {
      apiUrl: TEN_MILE_MUSIC_HALL_API_URL,
      httpClient: {
        get: vi.fn().mockRejectedValue(new Error('status 503')),
      } as unknown as VenueHttpClient,
    });
    await expect(adapter.fetch(crawlCtx)).rejects.toThrow('503');
  });
});
