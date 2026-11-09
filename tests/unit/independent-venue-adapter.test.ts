import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  IndependentVenueAdapter,
  LARIMER_LOUNGE_CONFIG,
  LOST_LAKE_CONFIG,
  GLOBE_HALL_CONFIG,
} from '@/lib/sources/venue';
import type { VenueHttpClient, VenueHttpResponse } from '@/lib/sources/venue';

describe('IndependentVenueAdapter', () => {
  const lostLakeHtml = fs.readFileSync(
    path.resolve(
      process.cwd(),
      'tests/fixtures/lost-lake-events-response.html',
    ),
    'utf-8',
  );

  function createMockHttpClient(
    response: Partial<VenueHttpResponse>,
  ): VenueHttpClient {
    return {
      get: vi.fn().mockResolvedValue({
        url: response.url ?? LOST_LAKE_CONFIG.calendarUrl,
        status: 200,
        body: response.body ?? lostLakeHtml,
        contentType: 'text/html; charset=UTF-8',
        fetchedAt: response.fetchedAt ?? '2026-11-07T20:00:00.000Z',
      }),
    } as unknown as VenueHttpClient;
  }

  it('initializes with custom venue configurations', () => {
    const larimerAdapter = new IndependentVenueAdapter(LARIMER_LOUNGE_CONFIG);
    expect(larimerAdapter.id).toBe('larimer-lounge-adapter');
    expect(larimerAdapter.name).toBe('Larimer Lounge Adapter');

    const lostLakeAdapter = new IndependentVenueAdapter(LOST_LAKE_CONFIG);
    expect(lostLakeAdapter.id).toBe('lost-lake-lounge-adapter');
    expect(lostLakeAdapter.name).toBe('Lost Lake Lounge Adapter');

    const globeAdapter = new IndependentVenueAdapter(GLOBE_HALL_CONFIG);
    expect(globeAdapter.id).toBe('globe-hall-adapter');
    expect(globeAdapter.name).toBe('Globe Hall Adapter');
  });

  it('fetches raw calendar HTML and produces content-hashed RawIngest', async () => {
    const mockClient = createMockHttpClient({ body: lostLakeHtml });
    const adapter = new IndependentVenueAdapter(LOST_LAKE_CONFIG, {
      httpClient: mockClient,
    });

    const ingests = await adapter.fetch({
      sourceId: LOST_LAKE_CONFIG.id!,
      sourceType: 'venue',
      acquisitionMethod: 'html_http',
      targetUrl: LOST_LAKE_CONFIG.calendarUrl,
      crawlStartedAt: '2026-11-07T20:00:00.000Z',
    });

    expect(ingests).toHaveLength(1);
    const ingest = ingests[0];
    expect(ingest.sourceId).toBe(LOST_LAKE_CONFIG.id);
    expect(ingest.sourceUrl).toBe(LOST_LAKE_CONFIG.calendarUrl);
    expect(ingest.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ingest.httpStatus).toBe(200);
    expect(ingest.rawContent).toBe(lostLakeHtml);
    expect(mockClient.get).toHaveBeenCalledWith(LOST_LAKE_CONFIG.calendarUrl);
  });

  it('parses raw ingests into valid EventCandidates via parse()', async () => {
    const adapter = new IndependentVenueAdapter(LOST_LAKE_CONFIG);
    const mockIngest = {
      sourceId: LOST_LAKE_CONFIG.id!,
      sourceUrl: LOST_LAKE_CONFIG.calendarUrl,
      acquisitionMethod: 'html_http' as const,
      fetchedAt: '2026-11-07T20:00:00.000Z',
      contentHash: 'mock-hash',
      contentType: 'text/html; charset=UTF-8',
      rawContent: lostLakeHtml,
      httpStatus: 200,
      parserVersion: '1.0.0',
    };

    const candidates = await adapter.parse([mockIngest]);
    expect(candidates).toHaveLength(35);
    expect(candidates[0].venueName).toBe('Lost Lake Lounge');
  });

  it('runs complete fetch and parse lifecycle through crawl()', async () => {
    const mockClient = createMockHttpClient({ body: lostLakeHtml });
    const adapter = new IndependentVenueAdapter(LOST_LAKE_CONFIG, {
      httpClient: mockClient,
    });

    const result = await adapter.crawl({
      sourceId: LOST_LAKE_CONFIG.id!,
      sourceType: 'venue',
      acquisitionMethod: 'html_http',
      targetUrl: LOST_LAKE_CONFIG.calendarUrl,
      crawlStartedAt: '2026-11-07T20:00:00.000Z',
    });

    expect(result.rawIngests).toHaveLength(1);
    expect(result.candidates).toHaveLength(35);
    expect(result.candidates[0].title).toBe(
      'Capture This w/ Public Figure, Skiimo + All Things Considered',
    );
  });

  it('safely handles empty raw ingests without throwing', async () => {
    const adapter = new IndependentVenueAdapter(LOST_LAKE_CONFIG);
    const candidates = await adapter.parse([
      {
        sourceId: LOST_LAKE_CONFIG.id!,
        sourceUrl: LOST_LAKE_CONFIG.calendarUrl,
        acquisitionMethod: 'html_http' as const,
        fetchedAt: '2026-11-07T20:00:00.000Z',
        contentHash: 'empty-hash',
        contentType: 'text/html',
        rawContent: '',
        httpStatus: 200,
        parserVersion: '1.0.0',
      },
    ]);

    expect(candidates).toEqual([]);
  });
});
