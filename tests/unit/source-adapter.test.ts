import { describe, expect, it } from 'vitest';
import { FakeVenueSourceAdapter } from '../fixtures/fake-source-adapter';
import type { CrawlContext } from '@/lib/domain/source';

describe('EventSourceAdapter Contract', () => {
  const fakeAdapter = new FakeVenueSourceAdapter();

  const mockContext: CrawlContext = {
    sourceId: 'venue-red-rocks',
    sourceType: 'venue',
    targetUrl: 'https://example-venue.com/events',
    crawlStartedAt: '2026-10-02T13:00:00Z',
  };

  it('implements required interface properties', () => {
    expect(fakeAdapter.name).toBe('fake-venue-adapter');
    expect(fakeAdapter.sourceType).toBe('venue');
    expect(fakeAdapter.parserVersion).toBe('1.0.0');
  });

  it('fetches raw ingest data without performing live network calls', async () => {
    const raw = await fakeAdapter.fetchRaw(mockContext);

    expect(raw.sourceId).toBe('venue-red-rocks');
    expect(raw.sourceUrl).toBe('https://example-venue.com/events');
    expect(raw.fetchedAt).toBe('2026-10-02T13:00:00Z');
    expect(raw.httpStatus).toBe(200);
    expect(raw.contentType).toBe('application/json');
    expect(raw.parserVersion).toBe('1.0.0');
    expect(raw.contentHash).toBeDefined();
    expect(typeof raw.rawContent).toBe('string');
  });

  it('parses raw ingests into normalized EventCandidate contracts', async () => {
    const raw = await fakeAdapter.fetchRaw(mockContext);
    const candidates = await fakeAdapter.parseCandidates(raw);

    expect(candidates).toHaveLength(2);

    // Single concert candidate validation
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

    // Provenance validation
    expect(concert.provenance.sourceId).toBe('venue-red-rocks');
    expect(concert.provenance.sourceType).toBe('venue');
    expect(concert.provenance.sourceEventId).toBe('evt-101');
    expect(concert.provenance.parserVersion).toBe('1.0.0');
    expect(concert.provenance.confidence).toBeGreaterThan(0.9);
  });

  it('correctly models festival candidates as first-class entities', async () => {
    const raw = await fakeAdapter.fetchRaw(mockContext);
    const candidates = await fakeAdapter.parseCandidates(raw);

    const festival = candidates[1];
    expect(festival.title).toBe('Front Range Sound Festival');
    expect(festival.isFestival).toBe(true);
    expect(festival.festivalDetails).toBeDefined();
    expect(festival.festivalDetails?.daysCount).toBe(2);
    expect(festival.festivalDetails?.lineupByDay?.['2026-10-24']).toEqual([
      'Luna Wave',
      'Solaris',
    ]);
    expect(festival.performances).toHaveLength(3);
    expect(festival.performances?.[0].stage).toBe('Main Stage');
  });

  it('runs complete crawl pipeline via adapter', async () => {
    const result = await fakeAdapter.crawl(mockContext);

    expect(result.raw).toBeDefined();
    expect(result.raw.httpStatus).toBe(200);
    expect(result.candidates).toHaveLength(2);
  });
});
