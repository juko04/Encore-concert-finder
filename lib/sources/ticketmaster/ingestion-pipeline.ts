import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { EventCandidate } from '@/lib/domain/event-candidate';
import type { RawIngest, Source } from '@/lib/domain/source';
import { CanonicalizationCoordinator } from '@/lib/entity-resolution/canonicalization-coordinator';
import type {
  ICatalogRepository,
  IEventCandidateRepository,
  IRawIngestRepository,
  ISourceRepository,
} from '@/lib/repositories/interfaces';
import { TicketmasterDiscoveryAdapter } from './adapter';
import { ensureTicketmasterSource } from './source-registry';
import type { TicketmasterEventQueryParams } from './types';

export interface TicketmasterIngestionOptions {
  sourceRepo: ISourceRepository;
  rawIngestRepo: IRawIngestRepository;
  candidateRepo: IEventCandidateRepository;
  catalogRepo: ICatalogRepository;
  adapter?: TicketmasterDiscoveryAdapter;
  queryParams?: TicketmasterEventQueryParams;
  useFixture?: boolean;
  fixtureJson?: string;
  persist?: boolean;
  reprocess?: boolean;
}

export interface TicketmasterIngestionResult {
  source: Source;
  rawIngestsFetched: number;
  rawIngestsPersisted: number;
  rawIngestsReused: number;
  candidatesParsed: number;
  candidatesPersisted: number;
  candidatesReused: number;
  canonicalEventsCreated: number;
  canonicalEventsMatched: number;
  candidatesNeedsReview: number;
  candidatesRejected: number;
  reviewReasons: Record<string, number>;
  persistedEventIds: string[];
  candidates: EventCandidate[];
}

/**
 * Runs controlled Ticketmaster ingestion and canonicalization pipeline.
 * Supports both safe dry-run in-memory preview and atomic database persistence.
 */
export async function runTicketmasterIngestion(
  options: TicketmasterIngestionOptions,
): Promise<TicketmasterIngestionResult> {
  const adapter = options.adapter ?? new TicketmasterDiscoveryAdapter();
  const source = await ensureTicketmasterSource(options.sourceRepo);

  const persist = Boolean(options.persist);
  const useFixture = Boolean(options.useFixture);

  let rawIngests: RawIngest[] = [];

  if (useFixture) {
    let rawJson = options.fixtureJson;
    if (!rawJson) {
      const fixturePath = path.resolve(
        process.cwd(),
        'tests/fixtures/ticketmaster-events-response.json',
      );
      rawJson = fs.readFileSync(fixturePath, 'utf-8');
    }

    const contentHash = crypto
      .createHash('sha256')
      .update(rawJson)
      .digest('hex');

    const stateCode = options.queryParams?.stateCode ?? 'CO';

    rawIngests = [
      {
        id: crypto.randomUUID(),
        sourceId: source.id,
        sourceUrl: `https://app.ticketmaster.com/discovery/v2/events.json?classificationName=Music&stateCode=${stateCode}`,
        acquisitionMethod: 'api',
        fetchedAt: new Date().toISOString(),
        contentHash,
        contentType: 'application/json',
        rawContent: rawJson,
        httpStatus: 200,
        parserVersion: adapter.parserVersion,
      },
    ];
  } else {
    rawIngests = await adapter.fetch({
      sourceId: source.id,
      sourceType: adapter.sourceType,
      acquisitionMethod: adapter.acquisitionMethod,
      targetUrl: 'https://app.ticketmaster.com/discovery/v2/events.json',
      crawlStartedAt: new Date().toISOString(),
      metadata: (options.queryParams ?? {}) as Record<string, unknown>,
    });
  }

  // 1. Dry-run mode: parse in memory without writing to database
  if (!persist) {
    const parsedCandidates = await adapter.parse(rawIngests);
    const reviewReasons: Record<string, number> = {};

    for (const cand of parsedCandidates) {
      if (!cand.venueName || cand.venueName.toLowerCase() === 'unknown venue') {
        reviewReasons['missing_venue_identity'] =
          (reviewReasons['missing_venue_identity'] || 0) + 1;
      }
      if (!cand.city) {
        reviewReasons['missing_venue_locality'] =
          (reviewReasons['missing_venue_locality'] || 0) + 1;
      }
      if (!cand.artistNames || cand.artistNames.length === 0) {
        reviewReasons['missing_artist_identity'] =
          (reviewReasons['missing_artist_identity'] || 0) + 1;
      }
    }

    return {
      source,
      rawIngestsFetched: rawIngests.length,
      rawIngestsPersisted: 0,
      rawIngestsReused: 0,
      candidatesParsed: parsedCandidates.length,
      candidatesPersisted: 0,
      candidatesReused: 0,
      canonicalEventsCreated: 0,
      canonicalEventsMatched: 0,
      candidatesNeedsReview: Object.values(reviewReasons).reduce(
        (a, b) => a + b,
        0,
      ),
      candidatesRejected: 0,
      reviewReasons,
      persistedEventIds: [],
      candidates: parsedCandidates,
    };
  }

  // 2. Database persistence mode
  let rawIngestsPersisted = 0;
  let rawIngestsReused = 0;
  const persistedRawIngests: Array<RawIngest & { id: string }> = [];

  for (const raw of rawIngests) {
    const existing = await options.rawIngestRepo.getBySourceUrlAndContentHash(
      source.id,
      raw.sourceUrl,
      raw.contentHash,
    );

    if (existing) {
      rawIngestsReused++;
      persistedRawIngests.push(existing);
    } else {
      const saved = await options.rawIngestRepo.create({
        sourceId: source.id,
        sourceUrl: raw.sourceUrl,
        acquisitionMethod: raw.acquisitionMethod,
        fetchedAt: raw.fetchedAt,
        contentHash: raw.contentHash,
        contentType: raw.contentType,
        rawContent: raw.rawContent,
        externalStorageRef: raw.externalStorageRef,
        httpStatus: raw.httpStatus,
        parserVersion: raw.parserVersion,
      });
      rawIngestsPersisted++;
      persistedRawIngests.push(saved);
    }
  }

  // Parse candidates using the actually persisted raw ingest rows so IDs match
  const candidates = await adapter.parse(persistedRawIngests);

  const persistedCandidates: Array<
    EventCandidate & { id: string; rawIngestId: string; sourceId: string }
  > = [];

  for (const candidate of candidates) {
    const savedCand = await options.candidateRepo.create(
      candidate as EventCandidate & { rawIngestId: string; sourceId: string },
    );
    persistedCandidates.push(savedCand);
  }

  // Canonicalize candidates
  const coordinator = new CanonicalizationCoordinator(options.catalogRepo);
  let canonicalEventsCreated = 0;
  let canonicalEventsMatched = 0;
  let candidatesNeedsReview = 0;
  let candidatesRejected = 0;
  let candidatesReused = 0;
  const reviewReasons: Record<string, number> = {};
  const persistedEventIds: string[] = [];

  for (const cand of persistedCandidates) {
    // Check if candidate observation was already resolved in a prior run
    if (!options.reprocess) {
      const existingRes = await options.catalogRepo.findResolutionByCandidateId(
        cand.id,
      );
      if (existingRes) {
        candidatesReused++;
        if (
          existingRes.status === 'created' ||
          existingRes.status === 'matched'
        ) {
          canonicalEventsMatched++;
          if (existingRes.eventId) persistedEventIds.push(existingRes.eventId);
        } else if (existingRes.status === 'needs_review') {
          candidatesNeedsReview++;
          const reasonsList = Array.isArray(existingRes.reasons)
            ? (existingRes.reasons as string[])
            : Object.keys(existingRes.reasons);
          for (const r of reasonsList) {
            reviewReasons[r] = (reviewReasons[r] || 0) + 1;
          }
        } else if (existingRes.status === 'rejected') {
          candidatesRejected++;
        }
        continue;
      }
    }

    const outcome = await coordinator.canonicalize(cand);

    if (outcome.status === 'created') {
      canonicalEventsCreated++;
      if (outcome.eventId) persistedEventIds.push(outcome.eventId);
    } else if (outcome.status === 'matched') {
      canonicalEventsMatched++;
      if (outcome.eventId) persistedEventIds.push(outcome.eventId);
    } else if (outcome.status === 'needs_review') {
      candidatesNeedsReview++;
      const reasonsList = Array.isArray(outcome.reasons)
        ? (outcome.reasons as string[])
        : Object.keys(outcome.reasons);
      for (const r of reasonsList) {
        reviewReasons[r] = (reviewReasons[r] || 0) + 1;
      }
    } else if (outcome.status === 'rejected') {
      candidatesRejected++;
    }
  }

  await options.sourceRepo.recordSuccess(source.id);

  return {
    source,
    rawIngestsFetched: rawIngests.length,
    rawIngestsPersisted,
    rawIngestsReused,
    candidatesParsed: candidates.length,
    candidatesPersisted: persistedCandidates.length,
    candidatesReused,
    canonicalEventsCreated,
    canonicalEventsMatched,
    candidatesNeedsReview,
    candidatesRejected,
    reviewReasons,
    persistedEventIds,
    candidates,
  };
}
