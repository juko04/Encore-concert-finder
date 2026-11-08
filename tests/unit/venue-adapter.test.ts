import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RawIngest } from '@/lib/domain/source';
import { CervantesVenueAdapter } from '@/lib/sources/venue/cervantes/adapter';
import { VenueHttpClient } from '@/lib/sources/venue/http-client';

describe('CervantesVenueAdapter', () => {
  const fixturePath = path.resolve(
    process.cwd(),
    'tests/fixtures/cervantes-events-response.html',
  );
  const fixtureHtml = fs.readFileSync(fixturePath, 'utf-8');

  it('conforms to EventSourceAdapter contract with venue sourceType', () => {
    const adapter = new CervantesVenueAdapter();
    expect(adapter.id).toBe('cervantes-venue-adapter');
    expect(adapter.name).toBe("Cervantes' Masterpiece Ballroom Adapter");
    expect(adapter.sourceType).toBe('venue');
    expect(adapter.acquisitionMethod).toBe('html_http');
    expect(adapter.parserVersion).toBe('1.0.0');
  });

  it('fetches raw HTML and calculates SHA-256 contentHash in fetch()', async () => {
    const mockHttpClient = new VenueHttpClient({ maxRetries: 0 });
    vi.spyOn(mockHttpClient, 'get').mockResolvedValueOnce({
      url: 'https://cervantesmasterpiece.com/events/',
      status: 200,
      contentType: 'text/html; charset=UTF-8',
      body: fixtureHtml,
      fetchedAt: '2026-11-08T00:00:00.000Z',
    });

    const adapter = new CervantesVenueAdapter({ httpClient: mockHttpClient });
    const rawIngests = await adapter.fetch({
      sourceId: 'b0000000-0000-0000-0000-000000000004',
      sourceType: 'venue',
      acquisitionMethod: 'html_http',
      targetUrl: 'https://cervantesmasterpiece.com/events/',
      crawlStartedAt: '2026-11-08T00:00:00.000Z',
    });

    expect(rawIngests).toHaveLength(1);
    expect(rawIngests[0].sourceId).toBe('b0000000-0000-0000-0000-000000000004');
    expect(rawIngests[0].httpStatus).toBe(200);
    expect(rawIngests[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rawIngests[0].rawContent).toBe(fixtureHtml);
  });

  it('parses raw ingests into valid EventCandidates via parse()', async () => {
    const adapter = new CervantesVenueAdapter();
    const mockRawIngests: RawIngest[] = [
      {
        id: 'c1111111-1111-1111-1111-111111111111',
        sourceId: 'b0000000-0000-0000-0000-000000000004',
        sourceUrl: 'https://cervantesmasterpiece.com/events/',
        acquisitionMethod: 'html_http',
        fetchedAt: '2026-11-08T00:00:00.000Z',
        contentHash: 'hash123',
        contentType: 'text/html; charset=UTF-8',
        rawContent: fixtureHtml,
        httpStatus: 200,
        parserVersion: '1.0.0',
      },
    ];

    const candidates = await adapter.parse(mockRawIngests);
    expect(candidates).toHaveLength(103);
    expect(candidates[0].rawIngestId).toBe(
      'c1111111-1111-1111-1111-111111111111',
    );
  });

  it('runs complete fetch and parse lifecycle through crawl()', async () => {
    const mockHttpClient = new VenueHttpClient({ maxRetries: 0 });
    vi.spyOn(mockHttpClient, 'get').mockResolvedValueOnce({
      url: 'https://cervantesmasterpiece.com/events/',
      status: 200,
      contentType: 'text/html; charset=UTF-8',
      body: fixtureHtml,
      fetchedAt: '2026-11-08T00:00:00.000Z',
    });

    const adapter = new CervantesVenueAdapter({ httpClient: mockHttpClient });
    const result = await adapter.crawl({
      sourceId: 'b0000000-0000-0000-0000-000000000004',
      sourceType: 'venue',
      acquisitionMethod: 'html_http',
      targetUrl: 'https://cervantesmasterpiece.com/events/',
      crawlStartedAt: '2026-11-08T00:00:00.000Z',
    });

    expect(result.rawIngests).toHaveLength(1);
    expect(result.candidates).toHaveLength(103);
  });
});
