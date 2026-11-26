import { describe, expect, it } from 'vitest';
import {
  NON_EVENT_REASON,
  isNonPublicEventTitle,
} from '@/lib/sources/non-events';
import { CanonicalizationCoordinator } from '@/lib/entity-resolution/canonicalization-coordinator';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';
import type { EventCandidate } from '@/lib/domain/event-candidate';

describe('isNonPublicEventTitle', () => {
  it.each([
    'Closed for Private Event',
    'CLOSED FOR PRIVATE EVENT',
    'Closed',
    'Closed for Holiday',
    'Closed today',
    'Venue closed for a private buyout',
    'Private Event',
    'Private Party - 21+',
    'Private Rental',
    'Buyout',
    'Venue Rental Available',
    'Holiday Hours',
    'Hours of Operation',
    'No Show Tonight',
    'Dark Night',
  ])('flags "%s" as not a public event', (title) => {
    expect(isNonPublicEventTitle(title)).toBe(true);
  });

  it.each([
    'Closed Casket Activities',
    'Closed Circuit',
    'Private Eyes (Hall & Oates Tribute)',
    'Private Party Band',
    'No Show Ponies',
    'The Dark Side of the Moon Live',
    'Buyout Brothers',
    'Hours of Darkness',
    'Phish',
    'Nickelback: Everything Under The Sun Tour',
    '',
    null,
    undefined,
  ])('keeps "%s"', (title) => {
    expect(isNonPublicEventTitle(title as string)).toBe(false);
  });
});

describe('coordinator rejects non-public listings', () => {
  const candidate = (
    title: string,
  ): EventCandidate & {
    rawIngestId: string;
    sourceId: string;
  } =>
    ({
      id: 'c0000000-0000-0000-0000-000000000001',
      rawIngestId: 'c0000000-0000-0000-0000-000000000002',
      sourceId: 'c0000000-0000-0000-0000-000000000003',
      title,
      artistNames: [title],
      artists: [{ name: title }],
      venueName: 'Boulder Theater',
      city: 'Boulder',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2040-12-03',
      startTimePrecision: 'date_only',
      confidence: 0.9,
      provenance: {
        sourceId: 'c0000000-0000-0000-0000-000000000003',
        sourceType: 'venue',
        acquisitionMethod: 'html_http',
        sourceUrl: 'https://example.invalid/e',
        contentHash: 'h',
        fetchedAt: '2026-11-25T00:00:00Z',
        confidence: 0.9,
        parserVersion: '1.0.0',
      },
    }) as unknown as EventCandidate & { rawIngestId: string; sourceId: string };

  it('persists a rejected resolution and creates no event or artist', async () => {
    const repo = new MemoryCatalogRepository();
    const out = await new CanonicalizationCoordinator(repo).canonicalize(
      candidate('Closed for Private Event'),
    );
    expect(out.status).toBe('rejected');
    expect(out.eventId).toBeNull();
    expect(out.reasons).toEqual([NON_EVENT_REASON]);
    expect(await repo.listEvents({ fromDate: '2040-01-01' })).toHaveLength(0);
    const res = await repo.findResolutionByCandidateId(
      'c0000000-0000-0000-0000-000000000001',
    );
    expect(res?.status).toBe('rejected');
  });

  it('still creates a real show with a similar-looking name', async () => {
    const repo = new MemoryCatalogRepository();
    const out = await new CanonicalizationCoordinator(repo).canonicalize(
      candidate('Closed Casket Activities'),
    );
    expect(out.status).toBe('created');
  });
});
