import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CrawlContext, RawIngest } from '@/lib/domain/source';
import type {
  VenueHttpClient,
  VenueHttpResponse,
} from '@/lib/sources/venue/http-client';
import {
  Z2EntertainmentAdapter,
  Z2_DEFAULT_CALENDAR_URL,
} from '@/lib/sources/venue/z2-entertainment/adapter';
import {
  Z2_ENTERTAINMENT_CONFIG,
  Z2_ENTERTAINMENT_SOURCE_ID,
} from '@/lib/sources/venue/source-registry';

describe('Z2EntertainmentAdapter', () => {
  const fixturePath = path.resolve(
    process.cwd(),
    'tests/fixtures/z2-events-response.html',
  );
  const fixtureHtml = fs.readFileSync(fixturePath, 'utf-8');

  function createMockHttpClient(
    responses:
      Record<string, Partial<VenueHttpResponse>> | Partial<VenueHttpResponse>,
  ): VenueHttpClient {
    const getFn = vi.fn().mockImplementation((url: string) => {
      let resp: Partial<VenueHttpResponse> | undefined;
      if ('body' in responses || 'status' in responses) {
        resp = responses as Partial<VenueHttpResponse>;
      } else {
        resp = (responses as Record<string, Partial<VenueHttpResponse>>)[url];
      }

      return Promise.resolve({
        url,
        status: resp?.status ?? 200,
        body: resp?.body ?? fixtureHtml,
        contentType: resp?.contentType ?? 'text/html; charset=UTF-8',
        fetchedAt: resp?.fetchedAt ?? '2026-11-20T00:00:00.000Z',
      });
    });

    return { get: getFn } as unknown as VenueHttpClient;
  }

  const defaultContext: CrawlContext = {
    sourceId: Z2_ENTERTAINMENT_SOURCE_ID,
    sourceType: 'venue',
    acquisitionMethod: 'html_http',
    targetUrl: Z2_DEFAULT_CALENDAR_URL,
    crawlStartedAt: '2026-11-20T00:00:00.000Z',
  };

  it('conforms to IVenueSourceAdapter contract and metadata', () => {
    const adapter = new Z2EntertainmentAdapter(Z2_ENTERTAINMENT_CONFIG);
    expect(adapter.id).toBe(Z2_ENTERTAINMENT_SOURCE_ID);
    expect(adapter.name).toBe('Z2 Entertainment Adapter');
    expect(adapter.sourceType).toBe('venue');
    expect(adapter.acquisitionMethod).toBe('html_http');
    expect(adapter.parserVersion).toBe('1.0.0');
  });

  it('initializes with default settings when no config is passed', () => {
    const adapter = new Z2EntertainmentAdapter();
    expect(adapter.id).toBe(Z2_ENTERTAINMENT_SOURCE_ID);
    expect(adapter.name).toBe('Z2 Entertainment Adapter');
    expect(adapter.sourceType).toBe('venue');
  });

  it('fetches raw HTML and calculates SHA-256 contentHash in fetch()', async () => {
    const mockHttpClient = createMockHttpClient({ body: fixtureHtml });
    const adapter = new Z2EntertainmentAdapter(Z2_ENTERTAINMENT_CONFIG, {
      httpClient: mockHttpClient,
    });

    const rawIngests = await adapter.fetch(defaultContext);

    expect(rawIngests).toHaveLength(1);
    const ingest = rawIngests[0];
    expect(ingest.sourceId).toBe(Z2_ENTERTAINMENT_SOURCE_ID);
    expect(ingest.sourceUrl).toBe(Z2_DEFAULT_CALENDAR_URL);
    expect(ingest.httpStatus).toBe(200);
    expect(ingest.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ingest.rawContent).toBe(fixtureHtml);
    expect(mockHttpClient.get).toHaveBeenCalledWith(Z2_DEFAULT_CALENDAR_URL);
  });

  it('parses raw ingests into valid EventCandidates via parse()', async () => {
    const adapter = new Z2EntertainmentAdapter(Z2_ENTERTAINMENT_CONFIG);
    const mockRawIngests: RawIngest[] = [
      {
        id: 'c2222222-2222-2222-2222-222222222222',
        sourceId: Z2_ENTERTAINMENT_SOURCE_ID,
        sourceUrl: Z2_DEFAULT_CALENDAR_URL,
        acquisitionMethod: 'html_http',
        fetchedAt: '2026-11-20T00:00:00.000Z',
        contentHash: 'mock-hash-123',
        contentType: 'text/html; charset=UTF-8',
        rawContent: fixtureHtml,
        httpStatus: 200,
        parserVersion: '1.0.0',
      },
    ];

    const candidates = await adapter.parse(mockRawIngests);
    expect(candidates).toHaveLength(6);
    expect(candidates[0].rawIngestId).toBe(
      'c2222222-2222-2222-2222-222222222222',
    );
    expect(candidates[0].sourceId).toBe(Z2_ENTERTAINMENT_SOURCE_ID);

    // Verify all 3 primary venues are present in parsed results
    const venues = new Set(candidates.map((c) => c.venueName));
    expect(venues.has('Boulder Theater')).toBe(true);
    expect(venues.has('Fox Theatre')).toBe(true);
    expect(venues.has('Aggie Theatre')).toBe(true);
  });

  it('runs complete fetch and parse lifecycle through crawl()', async () => {
    const mockHttpClient = createMockHttpClient({ body: fixtureHtml });
    const adapter = new Z2EntertainmentAdapter(Z2_ENTERTAINMENT_CONFIG, {
      httpClient: mockHttpClient,
    });

    const result = await adapter.crawl(defaultContext);

    expect(result.rawIngests).toHaveLength(1);
    expect(result.candidates).toHaveLength(6);
    expect(result.candidates[0].venueName).toBe('Boulder Theater');
  });

  it('supports multi-page pagination when maxPages > 1 and next page link is present', async () => {
    const page2Html = `
      <!DOCTYPE html>
      <html><body><div class="events-list">
        <article class="c-event-card" data-event-id="501007">
          <h2 class="c-event-card__title">String Cheese Incident</h2>
          <div class="c-event-card__venue">Boulder Theater</div>
          <div class="c-event-card__date">Sat, Jan 23, 2027</div>
          <div class="c-event-card__time">Show: 8:00 PM</div>
          <div class="c-event-card__price">$50.00</div>
          <a class="c-event-card__tickets" href="https://www.axs.com/events/501007/sci-tickets">Tickets</a>
        </article>
      </div></body></html>
    `;

    const mockHttpClient = createMockHttpClient({
      'https://z2ent.com/events': { body: fixtureHtml },
      'https://z2ent.com/events?page=2': { body: page2Html },
    });

    const adapter = new Z2EntertainmentAdapter(Z2_ENTERTAINMENT_CONFIG, {
      httpClient: mockHttpClient,
      maxPages: 2,
    });

    const result = await adapter.crawl(defaultContext);

    expect(result.rawIngests).toHaveLength(2);
    expect(mockHttpClient.get).toHaveBeenCalledWith('https://z2ent.com/events');
    expect(mockHttpClient.get).toHaveBeenCalledWith(
      'https://z2ent.com/events?page=2',
    );

    // 6 from page 1 + 1 from page 2 = 7 total unique candidates
    expect(result.candidates).toHaveLength(7);
    const sciEvent = result.candidates.find((c) =>
      c.title.includes('String Cheese Incident'),
    );
    expect(sciEvent).toBeDefined();
    expect(sciEvent?.venueName).toBe('Boulder Theater');
  });

  it('deduplicates events appearing on multiple pages during pagination', async () => {
    // Page 2 contains one duplicate show and one new show
    const page2HtmlWithDuplicate = `
      <!DOCTYPE html>
      <html><body><div class="events-list">
        <article class="c-event-card" data-event-id="501001">
          <h2 class="c-event-card__title">The Motet</h2>
          <div class="c-event-card__venue">Boulder Theater</div>
          <div class="c-event-card__date">Fri, Nov 20, 2026</div>
          <a class="c-event-card__tickets" href="https://www.axs.com/events/501001/the-motet-tickets">Tickets</a>
        </article>
        <article class="c-event-card" data-event-id="501008">
          <h2 class="c-event-card__title">Elephant Revival</h2>
          <div class="c-event-card__venue">Chautauqua Auditorium</div>
          <div class="c-event-card__date">Sun, Aug 01, 2027</div>
          <div class="c-event-card__time">Show: 7:00 PM</div>
          <a class="c-event-card__tickets" href="https://www.axs.com/events/501008/elephant-revival">Tickets</a>
        </article>
      </div></body></html>
    `;

    const mockHttpClient = createMockHttpClient({
      'https://z2ent.com/events': { body: fixtureHtml },
      'https://z2ent.com/events?page=2': { body: page2HtmlWithDuplicate },
    });

    const adapter = new Z2EntertainmentAdapter(Z2_ENTERTAINMENT_CONFIG, {
      httpClient: mockHttpClient,
      maxPages: 2,
    });

    const result = await adapter.crawl(defaultContext);

    // 6 from page 1 + 1 unique new from page 2 (Elephant Revival) = 7 total (The Motet deduplicated)
    expect(result.candidates).toHaveLength(7);
  });

  it('handles empty ingests safely without throwing', async () => {
    const adapter = new Z2EntertainmentAdapter(Z2_ENTERTAINMENT_CONFIG);
    const candidates = await adapter.parse([]);
    expect(candidates).toEqual([]);
  });
});
