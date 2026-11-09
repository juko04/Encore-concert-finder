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
