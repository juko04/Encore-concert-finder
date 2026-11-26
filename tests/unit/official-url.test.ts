import { describe, expect, it } from 'vitest';
import {
  eventPageUrlFromProvenance,
  publicPageUrl,
} from '@/lib/events/official-url';
import { evaluateFieldMerge } from '@/lib/entity-resolution/field-merge';
import type { Event } from '@/lib/domain/catalog';
import type { EventCandidate } from '@/lib/domain/event-candidate';

const PAGE = 'https://www.velvetelklounge.com/event/november-27-dj-kelly-kix/';

function provenance(sourceType: string, sourceUrl: string) {
  return {
    sourceId: 's1',
    sourceType,
    acquisitionMethod: 'crawl',
    sourceUrl,
    fetchedAt: '2026-11-26T00:00:00Z',
    contentHash: 'h',
    parserVersion: '1.0.0',
    confidence: 0.9,
  } as unknown as EventCandidate['provenance'];
}

function candidate(sourceType: string, sourceUrl: string): EventCandidate {
  return {
    title: 'DJ Kelly Kix',
    artistNames: ['DJ Kelly Kix'],
    venueName: 'Velvet Elk Lounge',
    localStartDate: '2026-11-27',
    confidence: 0.9,
    provenance: provenance(sourceType, sourceUrl),
  };
}

const current = {
  id: 'e1',
  name: 'DJ Kelly Kix',
  localStartDate: '2026-11-27',
  officialUrl: null,
} as unknown as Event;

describe('eventPageUrlFromProvenance', () => {
  it('uses the page from a venue or promoter site', () => {
    expect(
      eventPageUrlFromProvenance({ sourceType: 'venue', sourceUrl: PAGE }),
    ).toBe(PAGE);
    expect(
      eventPageUrlFromProvenance({ sourceType: 'promoter', sourceUrl: PAGE }),
    ).toBe(PAGE);
  });

  it('ignores aggregator/ticketing sources and API urls', () => {
    expect(
      eventPageUrlFromProvenance({
        sourceType: 'aggregator',
        sourceUrl: 'https://www.ticketmaster.com/event/123',
      }),
    ).toBeNull();
    expect(
      eventPageUrlFromProvenance({
        sourceType: 'venue',
        sourceUrl: 'https://app.ticketmaster.com/discovery/v2/events.json',
      }),
    ).toBeNull();
    expect(publicPageUrl('https://x.com/e?apikey=abc')).toBeNull();
    expect(publicPageUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('field merge: official_url', () => {
  it('fills an empty official_url from a venue page, with evidence', () => {
    const out = evaluateFieldMerge(current, candidate('venue', PAGE));
    expect(out.updates.officialUrl).toBe(PAGE);
    expect(out.evidences.some((e) => e.fieldName === 'official_url')).toBe(
      true,
    );
  });

  it('never replaces an existing official_url', () => {
    const out = evaluateFieldMerge(
      { ...current, officialUrl: 'https://z2ent.com/events/detail/x' } as Event,
      candidate('venue', PAGE),
    );
    expect(out.updates.officialUrl).toBeUndefined();
  });

  it('does not take a page from an aggregator', () => {
    const out = evaluateFieldMerge(
      current,
      candidate('aggregator', 'https://www.ticketmaster.com/event/123'),
    );
    expect(out.updates.officialUrl).toBeUndefined();
  });
});
