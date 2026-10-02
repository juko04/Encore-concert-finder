import { describe, expect, it } from 'vitest';
import { FakeVenueSourceAdapter } from '../fixtures/fake-source-adapter';
import type { CrawlContext } from '@/lib/domain/source';

describe('EventSourceAdapter Contract', () => {
  const fakeAdapter = new FakeVenueSourceAdapter();

  const mockContext: CrawlContext = {
    sourceId: 'venue-red-rocks',
    sourceType: 'venue',
    acquisitionMethod: 'structured_json',
    targetUrl: 'https://example-venue.com/events',
    crawlStartedAt: '2026-10-02T13:00:00Z',
  };

  it('implements required interface properties with stable adapter ID and acquisitionMethod', () => {
    expect(fakeAdapter.id).toBe('fake-venue-adapter');
    expect(fakeAdapter.name).toBe('Fake Venue Source Adapter');
    expect(fakeAdapter.sourceType).toBe('venue');
    expect(fakeAdapter.acquisitionMethod).toBe('structured_json');
    expect(fakeAdapter.parserVersion).toBe('1.1.0');
  });

  it('fetches multiple raw ingest records without performing live network calls', async () => {
    const rawIngests = await fakeAdapter.fetch(mockContext);

    expect(Array.isArray(rawIngests)).toBe(true);
    expect(rawIngests).toHaveLength(2);

    const firstPage = rawIngests[0];
    expect(firstPage.id).toBe('raw_fake-venue-adapter_page_1');
    expect(firstPage.sourceId).toBe('venue-red-rocks');
    expect(firstPage.sourceUrl).toBe('https://example-venue.com/events?page=1');
    expect(firstPage.acquisitionMethod).toBe('structured_json');
    expect(firstPage.fetchedAt).toBe('2026-10-02T13:00:00Z');
    expect(firstPage.httpStatus).toBe(200);
    expect(firstPage.contentType).toBe('application/json');
    expect(firstPage.parserVersion).toBe('1.1.0');
    expect(firstPage.contentHash).toBeDefined();
    expect(typeof firstPage.rawContent).toBe('string');

    const secondPage = rawIngests[1];
    expect(secondPage.id).toBe('raw_fake-venue-adapter_page_2');
    expect(secondPage.sourceUrl).toBe(
      'https://example-venue.com/events?page=2',
    );
  });

  it('parses multiple raw ingests into normalized EventCandidate contracts with provenance', async () => {
    const rawIngests = await fakeAdapter.fetch(mockContext);
    const candidates = await fakeAdapter.parse(rawIngests);

    expect(candidates).toHaveLength(2);

    // Single concert candidate validation (Page 1)
    const concert = candidates[0];
    expect(concert.title).toBe('The Mountain Echoes Live');
    expect(concert.artistNames).toContain('The Mountain Echoes');
    expect(concert.artistNames).toContain('River Pines');
    expect(concert.venueName).toBe('Red Rock Amphitheatre');
    expect(concert.city).toBe('Morrison');
    expect(concert.state).toBe('CO');
    expect(concert.timezone).toBe('America/Denver');
    expect(concert.startsAt).toBe('2026-10-15T19:30:00-06:00');
    expect(concert.price).toEqual({
      min: 45.0,
      max: 85.0,
      currency: 'USD',
    });
    expect(concert.isFestival).toBe(false);
    expect(concert.performances).toHaveLength(2);
    expect(concert.performances?.[0].billingPosition).toBe('headliner');
    expect(concert.performances?.[1].billingPosition).toBe('support');

    // Provenance validation with acquisitionMethod and rawIngestId
    expect(concert.provenance.sourceId).toBe('venue-red-rocks');
    expect(concert.provenance.sourceType).toBe('venue');
    expect(concert.provenance.acquisitionMethod).toBe('structured_json');
    expect(concert.provenance.sourceEventId).toBe('evt-101');
    expect(concert.provenance.rawIngestId).toBe(
      'raw_fake-venue-adapter_page_1',
    );
    expect(concert.provenance.parserVersion).toBe('1.1.0');
    expect(concert.provenance.confidence).toBeGreaterThan(0.9);

    // Multi-day residency candidate validation (Page 2)
    const multiDay = candidates[1];
    expect(multiDay.title).toBe('Solaris Two-Night Residency');
    expect(multiDay.startsAt).toBe('2026-10-24T19:00:00-06:00');
    expect(multiDay.endsAt).toBe('2026-10-25T23:00:00-06:00');
    expect(multiDay.provenance.rawIngestId).toBe(
      'raw_fake-venue-adapter_page_2',
    );
  });

  it('runs complete crawl pipeline via adapter returning rawIngests and candidates', async () => {
    const result = await fakeAdapter.crawl(mockContext);

    expect(result.rawIngests).toHaveLength(2);
    expect(result.rawIngests[0].httpStatus).toBe(200);
    expect(result.candidates).toHaveLength(2);
  });
});
