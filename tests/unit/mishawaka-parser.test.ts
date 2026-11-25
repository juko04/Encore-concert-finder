import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CrawlContext } from '@/lib/domain/source';
import {
  MISHAWAKA_CONFIG,
  MISHAWAKA_LIST_URL,
  MishawakaAdapter,
  extractHiddenVenueIds,
  isMishawakaNonMusicTitle,
  parseMishawakaEvents,
  type VenueHttpClient,
} from '@/lib/sources/venue';

const html = fs.readFileSync(
  path.resolve(process.cwd(), 'tests/fixtures/mishawaka-events-response.html'),
  'utf-8',
);

const ctx = {
  sourceId: 'src-mish',
  sourceUrl: MISHAWAKA_LIST_URL,
  fetchedAt: '2026-11-25T12:00:00.000Z',
  contentHash: 'hash',
  parserVersion: '1.0.0',
  defaultVenueConfig: MISHAWAKA_CONFIG,
};

function byTitle(title: string) {
  const c = parseMishawakaEvents(html, ctx).find((e) =>
    e.title.startsWith(title),
  );
  if (!c) throw new Error(`candidate not found: ${title}`);
  return c;
}

describe('parseMishawakaEvents', () => {
  const candidates = parseMishawakaEvents(html, ctx);

  it('parses only public music shows at the amphitheatre', () => {
    expect(candidates.map((c) => c.title)).toEqual([
      'Hand Turkey',
      "Switchman Sleepin' NYE Celebration",
      "Graham Good & the Painters x What's the Reason for this Podcast",
      'Dead Panic – A Tribute to the Grateful Dead & Widespread Panic',
      'Dermot Kennedy: The Weight of the Woods Tour',
    ]);
    for (const c of candidates) {
      expect(c.venueName).toBe('Mishawaka Amphitheatre');
      expect(c.city).toBe('Bellvue');
      expect(c.state).toBe('CO');
      expect(c.timezone).toBe('America/Denver');
    }
  });

  it('skips events the calendar page itself hides (offsite "Presents" listings)', () => {
    expect(extractHiddenVenueIds(html).has('22767')).toBe(true);
    expect(
      candidates.some((c) => /OBC Wine Project|Mouse Powell/.test(c.title)),
    ).toBe(false);
  });

  it('skips dinners, family experiences and markets that are not concerts', () => {
    expect(isMishawakaNonMusicTitle('Ugly Sweater Murder Mystery')).toBe(true);
    expect(isMishawakaNonMusicTitle('Santa Claus Live at the Mishawaka')).toBe(
      true,
    );
    expect(isMishawakaNonMusicTitle('Murder Mystery Dinner Band')).toBe(true);
    expect(isMishawakaNonMusicTitle('Railroad Earth')).toBe(false);
    expect(candidates.some((c) => /murder mystery|santa/i.test(c.title))).toBe(
      false,
    );
  });

  it('computes local date, instant start and DST-correct UTC (America/Denver)', () => {
    const nye = byTitle("Switchman Sleepin'");
    expect(nye.localStartDate).toBe('2026-12-31');
    expect(nye.startTimePrecision).toBe('instant');
    expect(nye.startsAt).toBe('2027-01-01T03:00:00.000Z'); // 8 pm MST
    const dermot = byTitle('Dermot Kennedy');
    expect(dermot.localStartDate).toBe('2027-09-03');
    expect(dermot.startsAt).toBe('2027-09-04T01:30:00.000Z'); // 7:30 pm MDT
  });

  it('separates the performer from stage, tour and event-type suffixes', () => {
    expect(byTitle('Hand Turkey').artistNames).toEqual(['Hand Turkey']);
    expect(byTitle("Switchman Sleepin'").artistNames).toEqual([
      "Switchman Sleepin'",
    ]);
    expect(byTitle('Dead Panic').artistNames).toEqual(['Dead Panic']);
    const dermot = byTitle('Dermot Kennedy');
    expect(dermot.artistNames).toEqual(['Dermot Kennedy']);
    expect(dermot.artists?.[0].billingPosition).toBe('headliner');
    expect(byTitle('Hand Turkey').rawPayload?.stage).toBe('INDOOR STAGE');
  });

  it('marks free only when the listing says free; otherwise leaves price unknown', () => {
    const free = byTitle('Hand Turkey');
    expect(free.price).toEqual({
      isFree: true,
      min: 0,
      max: 0,
      currency: 'USD',
    });
    expect(free.eventKind).toBe('free_event');
    expect(byTitle('Dead Panic').price).toBeUndefined();
  });

  it('detects sold-out and rescheduled status, never invents genres', () => {
    const dermot = byTitle('Dermot Kennedy');
    expect(dermot.inventoryStatus).toBe('sold_out');
    expect(dermot.rawPayload?.isSoldOut).toBe(true);
    expect(dermot.rawPayload?.isRescheduled).toBe(true);
    expect(byTitle('Dead Panic').inventoryStatus).toBe('unknown');
    for (const c of candidates) expect(c.rawPayload?.genres).toBeUndefined();
  });

  it('carries etix ticket links, stable ids and https event images', () => {
    const c = byTitle('Dead Panic');
    expect(c.ticketUrl).toMatch(/^https:\/\/www\.etix\.com\/ticket\/p\/\d+/);
    expect(c.provenance.sourceEventId).toMatch(/^etix-\d+$/);
    const images = c.rawPayload?.images as { eventImageUrl?: string };
    expect(images.eventImageUrl).toMatch(/^https:\/\//);
  });

  it('returns no candidates for empty or event-less pages', () => {
    expect(parseMishawakaEvents('', ctx)).toEqual([]);
    expect(
      parseMishawakaEvents('<html><body><p>No events</p></body></html>', ctx),
    ).toEqual([]);
  });

  it('skips closure notices and cancelled prefixes are flagged', () => {
    const page = `<div class="generalView"><span class='rhp-events-list-separator-month d-flex'><span>March 2027</span></span>
      <div class="col-12 eventWrapper rhpSingleEvent rhp-event__single-event--list">
        <div id="eventDate">Sat, Mar 06, 2027</div>
        <h2 class="rhp-event__title--list">Closed for Private Event</h2></div>
      <div class="col-12 eventWrapper rhpSingleEvent rhp-event__single-event--list">
        <div id="eventDate">Sun, Mar 07, 2027</div>
        <span class="rhp-event__time-text--list">7 pm</span>
        <h2 class="rhp-event__title--list">CANCELED: Some Band</h2></div></div>`;
    const out = parseMishawakaEvents(page, ctx);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Some Band');
    expect(out[0].inventoryStatus).toBe('cancelled');
    expect(out[0].localStartDate).toBe('2027-03-07');
  });

  it('falls back to date_only when no show time is listed', () => {
    const page = `<div class="rhp-event__single-event--list rhpSingleEvent">
        <div id="eventDate">Sun, Mar 07, 2027</div>
        <h2 class="rhp-event__title--list">Some Band</h2></div>`;
    const [c] = parseMishawakaEvents(page, ctx);
    expect(c.startTimePrecision).toBe('date_only');
    expect(c.startsAt).toBeUndefined();
  });
});

describe('MishawakaAdapter', () => {
  const crawlCtx: CrawlContext = {
    sourceId: 'src-mish',
    sourceType: 'venue',
    acquisitionMethod: 'html_http',
    targetUrl: MISHAWAKA_CONFIG.calendarUrl,
    crawlStartedAt: '2026-11-25T12:00:00.000Z',
  };

  it('fetches the list view (not the JS grid) and parses candidates', async () => {
    const get = vi.fn().mockResolvedValue({
      url: MISHAWAKA_LIST_URL,
      status: 200,
      contentType: 'text/html',
      body: html,
      fetchedAt: '2026-11-25T12:00:00.000Z',
    });
    const adapter = new MishawakaAdapter(MISHAWAKA_CONFIG, {
      httpClient: { get } as unknown as VenueHttpClient,
    });
    const { rawIngests, candidates } = await adapter.crawl(crawlCtx);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(MISHAWAKA_LIST_URL);
    expect(rawIngests).toHaveLength(1);
    expect(rawIngests[0].contentHash).toHaveLength(64);
    expect(candidates).toHaveLength(5);
  });

  it('surfaces fetch failures instead of returning an empty result', async () => {
    const adapter = new MishawakaAdapter(MISHAWAKA_CONFIG, {
      httpClient: {
        get: vi.fn().mockRejectedValue(new Error('status 503')),
      } as unknown as VenueHttpClient,
    });
    await expect(adapter.fetch(crawlCtx)).rejects.toThrow('503');
  });
});
