import { describe, expect, it } from 'vitest';
import {
  buildVenueParseContext,
  buildVenueProvenance,
  buildVenueRawIngest,
  dedupeBy,
} from '@/lib/sources/venue/adapter-helpers';
import { sha256Hex } from '@/lib/utils/content-hash';

describe('venue adapter helpers', () => {
  it('sha256Hex matches a known digest', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('buildVenueRawIngest hashes the body and copies response metadata', () => {
    const ingest = buildVenueRawIngest({
      context: { sourceId: 's1' } as never,
      sourceUrl: 'https://v.test/events',
      response: {
        url: 'https://v.test/events',
        status: 200,
        contentType: 'text/html',
        body: 'abc',
        fetchedAt: '2026-01-01T00:00:00.000Z',
      },
      acquisitionMethod: 'html_http',
      parserVersion: '1.0.0',
    });
    expect(ingest).toEqual({
      sourceId: 's1',
      sourceUrl: 'https://v.test/events',
      acquisitionMethod: 'html_http',
      fetchedAt: '2026-01-01T00:00:00.000Z',
      contentHash: sha256Hex('abc'),
      contentType: 'text/html',
      rawContent: 'abc',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });
  });

  it('buildVenueParseContext falls back to the adapter parser version', () => {
    const base = {
      id: 'r1',
      sourceId: 's1',
      sourceUrl: 'u',
      fetchedAt: 'f',
      contentHash: 'h',
      acquisitionMethod: 'html_http' as const,
      contentType: 'text/html',
      httpStatus: 200,
    };
    expect(
      buildVenueParseContext({ ...base, parserVersion: '' }, '9.9.9'),
    ).toEqual({
      sourceId: 's1',
      rawIngestId: 'r1',
      sourceUrl: 'u',
      fetchedAt: 'f',
      contentHash: 'h',
      parserVersion: '9.9.9',
    });
    expect(
      buildVenueParseContext({ ...base, parserVersion: '2.0.0' }, '9.9.9')
        .parserVersion,
    ).toBe('2.0.0');
  });

  it('dedupeBy keeps the first occurrence in order', () => {
    expect(
      dedupeBy(
        [
          { k: 'a', v: 1 },
          { k: 'b', v: 2 },
          { k: 'a', v: 3 },
        ],
        (x) => x.k,
      ),
    ).toEqual([
      { k: 'a', v: 1 },
      { k: 'b', v: 2 },
    ]);
  });

  it('buildVenueProvenance preserves context fields and applies defaults', () => {
    const full = buildVenueProvenance(
      {
        sourceId: 's1',
        rawIngestId: 'r1',
        fetchedAt: 'f',
        contentHash: 'h',
        parserVersion: '2.0.0',
      },
      { sourceUrl: 'u', sourceEventId: 'e1', confidence: 0.95 },
    );
    expect(full).toEqual({
      sourceId: 's1',
      sourceType: 'venue',
      acquisitionMethod: 'html_http',
      sourceUrl: 'u',
      sourceEventId: 'e1',
      rawIngestId: 'r1',
      fetchedAt: 'f',
      contentHash: 'h',
      parserVersion: '2.0.0',
      confidence: 0.95,
    });
    const bare = buildVenueProvenance(
      { sourceId: 's1' },
      { sourceUrl: 'u', confidence: 0.98 },
    );
    expect(bare.contentHash).toBe('');
    expect(bare.parserVersion).toBe('1.0.0');
    expect(Number.isNaN(Date.parse(bare.fetchedAt))).toBe(false);
  });
});
