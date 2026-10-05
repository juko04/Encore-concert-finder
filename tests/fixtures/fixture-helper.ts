import type { EventCandidate } from '@/lib/domain/event-candidate';
import type { RawIngest } from '@/lib/domain/source';
import fixtureData from './phase-1-fixtures.json';

export function getFixtureCandidate(
  key: keyof typeof fixtureData | string,
  subKey?: string,
): EventCandidate & { rawIngestId: string; sourceId: string } {
  let item: any = (fixtureData as any)[key];
  if (subKey && item) {
    item = item[subKey];
  }

  if (!item) {
    throw new Error(`Fixture not found: ${key}${subKey ? '.' + subKey : ''}`);
  }

  const rawIngestId = `raw_${item.sourceId}_${item.sourceEventId}`;

  return {
    id: `cand_${item.sourceEventId}`,
    rawIngestId,
    sourceId: item.sourceId,
    sourceEventId: item.sourceEventId,
    provenance: {
      sourceId: item.sourceId,
      sourceType: 'venue',
      acquisitionMethod: 'structured_json',
      sourceUrl: item.ticketUrl ?? 'https://venue.example.com',
      sourceEventId: item.sourceEventId,
      rawIngestId,
      fetchedAt: new Date().toISOString(),
      contentHash: `hash_${item.sourceEventId}`,
      parserVersion: '1.0.0',
      confidence: 0.95,
    },
    title: item.title,
    artistNames: item.artists,
    venueName: item.venue,
    city: item.city,
    state: item.state,
    timezone: item.timezone,
    localStartDate: item.localStartDate,
    startsAt: item.startsAt ?? undefined,
    startTimePrecision: item.startTimePrecision,
    ticketUrl: item.ticketUrl ?? undefined,
    price: item.price ?? undefined,
    confidence: 0.95,
    verificationStatus: 'unverified',
    rawPayload: item.status ? { status: item.status } : undefined,
  };
}

export function createRawIngestForCandidate(
  candidate: EventCandidate & { rawIngestId: string; sourceId: string },
): RawIngest & { id: string } {
  return {
    id: candidate.rawIngestId,
    sourceId: candidate.sourceId,
    sourceUrl: candidate.provenance.sourceUrl,
    acquisitionMethod: candidate.provenance.acquisitionMethod,
    fetchedAt: candidate.provenance.fetchedAt,
    contentHash: candidate.provenance.contentHash,
    contentType: 'application/json',
    rawContent: JSON.stringify(candidate),
    httpStatus: 200,
    parserVersion: candidate.provenance.parserVersion,
  };
}
