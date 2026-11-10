import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  VelvetElkAdapter,
  VELVET_ELK_CONFIG,
  RootsMusicProjectAdapter,
  ROOTS_MUSIC_PROJECT_CONFIG,
  VenueHttpClient,
} from '@/lib/sources/venue';

describe('Boulder Independent Venues Adapters', () => {
  const velvetHtml = fs.readFileSync(
    path.resolve(
      process.cwd(),
      'tests/fixtures/velvet-elk-events-response.html',
    ),
    'utf-8',
  );

  const velvetSingleEventHtml = fs.readFileSync(
    path.resolve(
      process.cwd(),
      'tests/fixtures/velvet-elk-single-event-response.html',
    ),
    'utf-8',
  );

  const rootsHtml = fs.readFileSync(
    path.resolve(
      process.cwd(),
      'tests/fixtures/roots-music-project-events-response.html',
    ),
    'utf-8',
  );

  describe('VelvetElkAdapter', () => {
    it('initializes with correct properties and metadata', () => {
      const adapter = new VelvetElkAdapter(VELVET_ELK_CONFIG);
      expect(adapter.id).toBe('velvet-elk-lounge-adapter');
      expect(adapter.name).toBe('Velvet Elk Lounge Adapter');
      expect(adapter.sourceType).toBe('venue');
      expect(adapter.acquisitionMethod).toBe('html_http');
      expect(adapter.parserVersion).toBe('1.0.0');
    });

    it('fetches calendar HTML and produces RawIngest record', async () => {
      const mockHttpClient = {
        get: vi.fn().mockResolvedValue({
          url: VELVET_ELK_CONFIG.calendarUrl,
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: velvetHtml,
          fetchedAt: '2026-11-09T20:00:00.000Z',
        }),
      } as unknown as VenueHttpClient;

      const adapter = new VelvetElkAdapter(VELVET_ELK_CONFIG, {
        httpClient: mockHttpClient,
        enrichEventDetails: false,
      });

      const rawIngests = await adapter.fetch({
        sourceId: VELVET_ELK_CONFIG.id!,
        sourceType: 'venue',
        acquisitionMethod: 'html_http',
        targetUrl: VELVET_ELK_CONFIG.calendarUrl,
        crawlStartedAt: '2026-11-09T20:00:00.000Z',
      });

      expect(rawIngests).toHaveLength(1);
      const ingest = rawIngests[0];
      expect(ingest.sourceId).toBe(VELVET_ELK_CONFIG.id);
      expect(ingest.sourceUrl).toBe(VELVET_ELK_CONFIG.calendarUrl);
      expect(ingest.httpStatus).toBe(200);
      expect(ingest.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(ingest.rawContent).toBe(velvetHtml);
    });

    it('fetches calendar and event detail subpages when detail enrichment is enabled', async () => {
      const galentinesDetailUrl =
        'https://www.velvetelklounge.com/event/november-13-the-galentine-with-abernathy/';

      const mockHttpClient = {
        get: vi.fn().mockImplementation((url: string) => {
          if (url === galentinesDetailUrl) {
            return Promise.resolve({
              url: galentinesDetailUrl,
              status: 200,
              contentType: 'text/html; charset=utf-8',
              body: velvetSingleEventHtml,
              fetchedAt: '2026-11-09T20:01:00.000Z',
            });
          }
          if (url === VELVET_ELK_CONFIG.calendarUrl) {
            return Promise.resolve({
              url: VELVET_ELK_CONFIG.calendarUrl,
              status: 200,
              contentType: 'text/html; charset=utf-8',
              body: velvetHtml,
              fetchedAt: '2026-11-09T20:00:00.000Z',
            });
          }
          // Other detail pages return 404 to test graceful fallback
          return Promise.resolve({
            url,
            status: 404,
            contentType: 'text/html',
            body: 'Not Found',
            fetchedAt: '2026-11-09T20:02:00.000Z',
          });
        }),
      } as unknown as VenueHttpClient;

      const adapter = new VelvetElkAdapter(VELVET_ELK_CONFIG, {
        httpClient: mockHttpClient,
        enrichEventDetails: true,
        maxDetailPages: 6,
      });

      const rawIngests = await adapter.fetch({
        sourceId: VELVET_ELK_CONFIG.id!,
        sourceType: 'venue',
        acquisitionMethod: 'html_http',
        targetUrl: VELVET_ELK_CONFIG.calendarUrl,
        crawlStartedAt: '2026-11-09T20:00:00.000Z',
      });

      // Calendar listing + 1 successful detail page
      expect(rawIngests).toHaveLength(2);
      expect(rawIngests[0].sourceUrl).toBe(VELVET_ELK_CONFIG.calendarUrl);
      expect(rawIngests[1].sourceUrl).toBe(galentinesDetailUrl);
      expect(rawIngests[1].rawContent).toBe(velvetSingleEventHtml);
    });

    it('prevents follow-up network requests when a detail page attempts an unsafe redirect', async () => {
      const redirectingDetailUrl =
        'https://www.velvetelklounge.com/event/redirect-test/';
      const unsafeDestinationUrl = 'https://evil.com/phishing-detail';
      const validDetailUrl =
        'https://www.velvetelklounge.com/event/valid-show/';

      const mockCalendarHtmlWithRedirect = `
        <ul>
          <li class="card">
            <h2 class="card__heading">Redirecting Event</h2>
            <a class="card__btn" href="/event/redirect-test/">Details</a>
          </li>
          <li class="card">
            <h2 class="card__heading">Valid Event</h2>
            <a class="card__btn" href="/event/valid-show/">Details</a>
          </li>
        </ul>
      `;

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation((input: RequestInfo | URL) => {
          const urlStr = typeof input === 'string' ? input : input.toString();

          if (urlStr === VELVET_ELK_CONFIG.calendarUrl) {
            return Promise.resolve(
              new Response(mockCalendarHtmlWithRedirect, {
                status: 200,
                headers: { 'content-type': 'text/html' },
              }),
            );
          }

          if (urlStr === redirectingDetailUrl) {
            // Returns an HTTP 302 redirect pointing to an unapproved external destination
            return Promise.resolve(
              new Response(null, {
                status: 302,
                headers: {
                  location: unsafeDestinationUrl,
                },
              }),
            );
          }

          if (urlStr === unsafeDestinationUrl) {
            // An unsafe redirect follow-up request would hit this endpoint
            return Promise.resolve(
              new Response(
                '<article class="content"><h1>Malicious Event</h1></article>',
                {
                  status: 200,
                  headers: { 'content-type': 'text/html' },
                },
              ),
            );
          }

          if (urlStr === validDetailUrl) {
            return Promise.resolve(
              new Response(velvetSingleEventHtml, {
                status: 200,
                headers: { 'content-type': 'text/html' },
              }),
            );
          }

          return Promise.resolve(new Response('Not Found', { status: 404 }));
        });

      const httpClient = new VenueHttpClient({ maxRetries: 0 });
      const adapter = new VelvetElkAdapter(VELVET_ELK_CONFIG, {
        httpClient,
        enrichEventDetails: true,
      });

      const rawIngests = await adapter.fetch({
        sourceId: VELVET_ELK_CONFIG.id!,
        sourceType: 'venue',
        acquisitionMethod: 'html_http',
        targetUrl: VELVET_ELK_CONFIG.calendarUrl,
        crawlStartedAt: '2026-11-09T20:00:00.000Z',
      });

      // 1. Verifies that the unsafe redirect destination was NEVER requested over the network!
      expect(fetchSpy).not.toHaveBeenCalledWith(
        unsafeDestinationUrl,
        expect.anything(),
      );

      // 2. Verifies that calendar listing + valid detail page were ingested
      expect(rawIngests).toHaveLength(2);
      expect(rawIngests[0].sourceUrl).toBe(VELVET_ELK_CONFIG.calendarUrl);
      expect(rawIngests[1].sourceUrl).toBe(validDetailUrl);
      expect(rawIngests[1].rawContent).toBe(velvetSingleEventHtml);

      // 3. Ensure the unsafe external URL was never stored
      const externalIngest = rawIngests.find((i) =>
        i.sourceUrl.includes('evil.com'),
      );
      expect(externalIngest).toBeUndefined();

      fetchSpy.mockRestore();
    });

    it('enriches calendar candidates with exact show time and Etix ticket link while preserving listing fallback', async () => {
      const galentinesDetailUrl =
        'https://www.velvetelklounge.com/event/november-13-the-galentine-with-abernathy/';

      const adapter = new VelvetElkAdapter(VELVET_ELK_CONFIG);
      const candidates = await adapter.parse([
        {
          id: 'listing-raw-id',
          sourceId: VELVET_ELK_CONFIG.id!,
          sourceUrl: VELVET_ELK_CONFIG.calendarUrl,
          acquisitionMethod: 'html_http',
          fetchedAt: '2026-11-09T20:00:00.000Z',
          contentHash: 'hash-listing',
          contentType: 'text/html',
          rawContent: velvetHtml,
          httpStatus: 200,
          parserVersion: '1.0.0',
        },
        {
          id: 'detail-raw-id',
          sourceId: VELVET_ELK_CONFIG.id!,
          sourceUrl: galentinesDetailUrl,
          acquisitionMethod: 'html_http',
          fetchedAt: '2026-11-09T20:01:00.000Z',
          contentHash: 'hash-detail',
          contentType: 'text/html',
          rawContent: velvetSingleEventHtml,
          httpStatus: 200,
          parserVersion: '1.0.0',
        },
      ]);

      // Exactly 6 unique candidates returned (no duplicates!)
      expect(candidates).toHaveLength(6);

      // The Galentines event was enriched from the detail page
      const galentines = candidates.find((c) =>
        c.title.includes('The Galentines'),
      );
      expect(galentines).toBeDefined();
      expect(galentines?.startTimePrecision).toBe('instant');
      expect(galentines?.startsAt).toBe('2026-11-14T03:00:00.000Z');
      expect(galentines?.ticketUrl).toBe(
        'https://www.etix.com/ticket/p/96771462/the-galentines-with-abernathy-boulder-velvet-elk-lounge',
      );
      expect(galentines?.provenance.rawIngestId).toBe('detail-raw-id');
      expect(galentines?.provenance.sourceUrl).toBe(galentinesDetailUrl);

      // Other events without detail pages retain listing card fallback
      const peachRat = candidates.find((c) => c.title === 'Peach Rat');
      expect(peachRat).toBeDefined();
      expect(peachRat?.startTimePrecision).toBe('date_only');
      expect(peachRat?.startsAt).toBeUndefined();
      expect(peachRat?.ticketUrl).toBe(
        'https://www.velvetelklounge.com/event/november-15-peach-rat/',
      );
      expect(peachRat?.provenance.rawIngestId).toBe('listing-raw-id');
    });

    it('parses raw ingests into EventCandidate objects', async () => {
      const adapter = new VelvetElkAdapter(VELVET_ELK_CONFIG);
      const candidates = await adapter.parse([
        {
          sourceId: VELVET_ELK_CONFIG.id!,
          sourceUrl: VELVET_ELK_CONFIG.calendarUrl,
          acquisitionMethod: 'html_http',
          fetchedAt: '2026-11-09T20:00:00.000Z',
          contentHash: 'mock-hash',
          contentType: 'text/html',
          rawContent: velvetHtml,
          httpStatus: 200,
          parserVersion: '1.0.0',
        },
      ]);

      expect(candidates).toHaveLength(6);
      expect(candidates[1].title).toBe('The Galentines with Abernathy');
    });

    it('executes crawl combining fetch and parse', async () => {
      const mockHttpClient = {
        get: vi.fn().mockResolvedValue({
          url: VELVET_ELK_CONFIG.calendarUrl,
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: velvetHtml,
          fetchedAt: '2026-11-09T20:00:00.000Z',
        }),
      } as unknown as VenueHttpClient;

      const adapter = new VelvetElkAdapter(VELVET_ELK_CONFIG, {
        httpClient: mockHttpClient,
        enrichEventDetails: false,
      });

      const result = await adapter.crawl({
        sourceId: VELVET_ELK_CONFIG.id!,
        sourceType: 'venue',
        acquisitionMethod: 'html_http',
        targetUrl: VELVET_ELK_CONFIG.calendarUrl,
        crawlStartedAt: '2026-11-09T20:00:00.000Z',
      });

      expect(result.rawIngests).toHaveLength(1);
      expect(result.candidates).toHaveLength(6);
    });
  });

  describe('RootsMusicProjectAdapter', () => {
    it('initializes with correct properties and metadata', () => {
      const adapter = new RootsMusicProjectAdapter(ROOTS_MUSIC_PROJECT_CONFIG);
      expect(adapter.id).toBe('roots-music-project-adapter');
      expect(adapter.name).toBe('Roots Music Project Adapter');
      expect(adapter.sourceType).toBe('venue');
      expect(adapter.acquisitionMethod).toBe('html_http');
      expect(adapter.parserVersion).toBe('1.0.0');
    });

    it('fetches calendar HTML and produces RawIngest record', async () => {
      const mockHttpClient = {
        get: vi.fn().mockResolvedValue({
          url: ROOTS_MUSIC_PROJECT_CONFIG.calendarUrl,
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: rootsHtml,
          fetchedAt: '2026-11-09T20:00:00.000Z',
        }),
      } as unknown as VenueHttpClient;

      const adapter = new RootsMusicProjectAdapter(ROOTS_MUSIC_PROJECT_CONFIG, {
        httpClient: mockHttpClient,
      });

      const rawIngests = await adapter.fetch({
        sourceId: ROOTS_MUSIC_PROJECT_CONFIG.id!,
        sourceType: 'venue',
        acquisitionMethod: 'html_http',
        targetUrl: ROOTS_MUSIC_PROJECT_CONFIG.calendarUrl,
        crawlStartedAt: '2026-11-09T20:00:00.000Z',
      });

      expect(rawIngests).toHaveLength(1);
      const ingest = rawIngests[0];
      expect(ingest.sourceId).toBe(ROOTS_MUSIC_PROJECT_CONFIG.id);
      expect(ingest.httpStatus).toBe(200);
      expect(ingest.contentHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('parses raw ingests into EventCandidate objects', async () => {
      const adapter = new RootsMusicProjectAdapter(ROOTS_MUSIC_PROJECT_CONFIG);
      const candidates = await adapter.parse([
        {
          sourceId: ROOTS_MUSIC_PROJECT_CONFIG.id!,
          sourceUrl: ROOTS_MUSIC_PROJECT_CONFIG.calendarUrl,
          acquisitionMethod: 'html_http',
          fetchedAt: '2026-11-09T20:00:00.000Z',
          contentHash: 'mock-hash',
          contentType: 'text/html',
          rawContent: rootsHtml,
          httpStatus: 200,
          parserVersion: '1.0.0',
        },
      ]);

      expect(candidates).toHaveLength(12);
    });

    it('executes crawl combining fetch and parse', async () => {
      const mockHttpClient = {
        get: vi.fn().mockResolvedValue({
          url: ROOTS_MUSIC_PROJECT_CONFIG.calendarUrl,
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: rootsHtml,
          fetchedAt: '2026-11-09T20:00:00.000Z',
        }),
      } as unknown as VenueHttpClient;

      const adapter = new RootsMusicProjectAdapter(ROOTS_MUSIC_PROJECT_CONFIG, {
        httpClient: mockHttpClient,
      });

      const result = await adapter.crawl({
        sourceId: ROOTS_MUSIC_PROJECT_CONFIG.id!,
        sourceType: 'venue',
        acquisitionMethod: 'html_http',
        targetUrl: ROOTS_MUSIC_PROJECT_CONFIG.calendarUrl,
        crawlStartedAt: '2026-11-09T20:00:00.000Z',
      });

      expect(result.rawIngests).toHaveLength(1);
      expect(result.candidates).toHaveLength(12);
    });
  });
});
