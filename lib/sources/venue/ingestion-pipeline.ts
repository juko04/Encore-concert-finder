import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { EventCandidate } from '@/lib/domain/event-candidate';
import type { EventSourceAdapter, RawIngest } from '@/lib/domain/source';
import { CanonicalizationCoordinator } from '@/lib/entity-resolution/canonicalization-coordinator';
import type { ISourceRepository } from '@/lib/repositories/interfaces';
import { CervantesVenueAdapter } from './cervantes/adapter';
import { IndependentVenueAdapter } from './independent-venue-group/adapter';
import { VelvetElkAdapter } from './velvet-elk/adapter';
import { RootsMusicProjectAdapter } from './roots-music-project/adapter';
import {
  ensureVenueSource,
  CERVANTES_CONFIG,
  VELVET_ELK_CONFIG,
  ROOTS_MUSIC_PROJECT_CONFIG,
} from './source-registry';
import type {
  VenueIngestionOptions,
  VenueIngestionResult,
  VenueSourceConfig,
} from './types';

export interface RunVenuePipelineOptions extends VenueIngestionOptions {
  config?: VenueSourceConfig;
  adapter?: EventSourceAdapter;
}

function resolveDefaultFixturePath(slug: string): string {
  switch (slug) {
    case 'larimer-lounge':
      return path.resolve(
        process.cwd(),
        'tests/fixtures/larimer-lounge-events-response.html',
      );
    case 'lost-lake-lounge':
      return path.resolve(
        process.cwd(),
        'tests/fixtures/lost-lake-events-response.html',
      );
    case 'globe-hall':
      return path.resolve(
        process.cwd(),
        'tests/fixtures/globe-hall-events-response.html',
      );
    case 'velvet-elk-lounge':
      return path.resolve(
        process.cwd(),
        'tests/fixtures/velvet-elk-events-response.html',
      );
    case 'roots-music-project':
      return path.resolve(
        process.cwd(),
        'tests/fixtures/roots-music-project-events-response.html',
      );
    case 'cervantes-masterpiece':
    default:
      return path.resolve(
        process.cwd(),
        'tests/fixtures/cervantes-events-response.html',
      );
  }
}

/**
 * Runs controlled venue ingestion and canonicalization pipeline.
 * Supports safe dry-run preview, fixture replay, and atomic PostgreSQL persistence.
 */
export async function runVenueIngestion(
  options: RunVenuePipelineOptions,
): Promise<VenueIngestionResult> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const config = options.config ?? CERVANTES_CONFIG;
  const adapter =
    options.adapter ??
    (config.slug === CERVANTES_CONFIG.slug
      ? new CervantesVenueAdapter()
      : config.slug === VELVET_ELK_CONFIG.slug
        ? new VelvetElkAdapter(config)
        : config.slug === ROOTS_MUSIC_PROJECT_CONFIG.slug
          ? new RootsMusicProjectAdapter(config)
          : new IndependentVenueAdapter(config));
  const source = await ensureVenueSource(options.sourceRepo, config);

  // Link in-memory catalog repo with sourceRepo if supported
  if (
    'sourceRepo' in options.catalogRepo &&
    !(options.catalogRepo as { sourceRepo?: unknown }).sourceRepo
  ) {
    (options.catalogRepo as { sourceRepo?: ISourceRepository }).sourceRepo =
      options.sourceRepo;
  }

  const persist = Boolean(options.persist);
  const useFixture = Boolean(options.useFixture);
  const targetUrl = options.targetUrl ?? config.calendarUrl;

  let rawIngests: RawIngest[] = [];

  if (useFixture) {
    let rawHtml = options.fixtureHtml;
    if (!rawHtml) {
      const fixturePath =
        options.fixturePath ?? resolveDefaultFixturePath(config.slug);
      rawHtml = fs.readFileSync(fixturePath, 'utf-8');
    }

    const contentHash = crypto
      .createHash('sha256')
      .update(rawHtml)
      .digest('hex');

    rawIngests = [
      {
        sourceId: source.id,
        sourceUrl: targetUrl,
        acquisitionMethod: 'html_http',
        fetchedAt: startedAt,
        contentHash,
        contentType: 'text/html; charset=UTF-8',
        rawContent: rawHtml,
        httpStatus: 200,
        parserVersion: adapter.parserVersion,
      },
    ];
  } else {
    rawIngests = await adapter.fetch({
      sourceId: source.id,
      sourceType: 'venue',
      acquisitionMethod: 'html_http',
      targetUrl,
      crawlStartedAt: startedAt,
    });
  }

  // 1. Dry-run mode: parse candidates and simulate canonicalization in-memory without DB writes
  if (!persist) {
    const parsedCandidates = await adapter.parse(rawIngests);
    const coordinator = new CanonicalizationCoordinator(options.catalogRepo);

    let canonicalEventsCreated = 0;
    let canonicalEventsMatched = 0;
    let candidatesNeedsReview = 0;
    let candidatesRejected = 0;
    const reviewReasons: Record<string, number> = {};
    const persistedEventIds: string[] = [];

    const simRawIngestId = rawIngests[0]?.id ?? crypto.randomUUID();

    for (const cand of parsedCandidates) {
      // Validate minimum required fields
      if (!cand.venueName || cand.venueName.toLowerCase() === 'unknown venue') {
        candidatesNeedsReview++;
        reviewReasons['missing_venue_identity'] =
          (reviewReasons['missing_venue_identity'] || 0) + 1;
        continue;
      }
      if (!cand.city) {
        candidatesNeedsReview++;
        reviewReasons['missing_venue_locality'] =
          (reviewReasons['missing_venue_locality'] || 0) + 1;
        continue;
      }
      if (!cand.localStartDate) {
        candidatesNeedsReview++;
        reviewReasons['missing_event_date'] =
          (reviewReasons['missing_event_date'] || 0) + 1;
        continue;
      }

      const simCandidate = {
        ...cand,
        id: cand.id ?? crypto.randomUUID(),
        rawIngestId: simRawIngestId,
        sourceId: source.id,
      };

      try {
        const outcome = await coordinator.canonicalize(simCandidate);
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
      } catch {
        candidatesNeedsReview++;
        reviewReasons['canonicalization_exception'] =
          (reviewReasons['canonicalization_exception'] ?? 0) + 1;
      }
    }

    const completedAt = new Date().toISOString();
    return {
      source,
      rawIngestsFetched: rawIngests.length,
      rawIngestsPersisted: 0,
      rawIngestsReused: 0,
      candidatesParsed: parsedCandidates.length,
      candidatesPersisted: 0,
      candidatesReused: 0,
      candidatesSkipped: 0,
      canonicalEventsCreated,
      canonicalEventsMatched,
      candidatesNeedsReview,
      candidatesRejected,
      reviewReasons,
      persistedEventIds,
      candidates: parsedCandidates,
      startedAt,
      completedAt,
      durationMs: Math.max(1, Date.now() - startMs),
    };
  }

  // 2. Database persistence mode
  try {
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

    // Parse candidates using persisted raw ingests so rawIngestId is assigned
    const candidates = await adapter.parse(persistedRawIngests);

    // Fetch existing candidates for these raw ingests to prevent duplicate observation rows
    const existingCandidatesByRaw = new Map<
      string,
      Array<
        EventCandidate & { id: string; rawIngestId: string; sourceId: string }
      >
    >();
    for (const raw of persistedRawIngests) {
      const existingList = await options.candidateRepo.getByRawIngestId(raw.id);
      existingCandidatesByRaw.set(raw.id, existingList);
    }

    const persistedCandidates: Array<
      EventCandidate & { id: string; rawIngestId: string; sourceId: string }
    > = [];
    let candidatesPersisted = 0;
    let candidatesReused = 0;

    for (const candidate of candidates) {
      const rawIngestId = candidate.rawIngestId || persistedRawIngests[0]?.id;
      const existingForRaw = rawIngestId
        ? (existingCandidatesByRaw.get(rawIngestId) ?? [])
        : [];

      const existingCand = existingForRaw.find(
        (c) =>
          (candidate.provenance.sourceEventId &&
            c.provenance?.sourceEventId ===
              candidate.provenance.sourceEventId) ||
          (c.title === candidate.title &&
            c.localStartDate === candidate.localStartDate &&
            c.venueName === candidate.venueName),
      );

      if (existingCand) {
        candidatesReused++;
        persistedCandidates.push(existingCand);
      } else {
        const savedCand = await options.candidateRepo.create({
          ...candidate,
          rawIngestId: rawIngestId || '',
          sourceId: source.id,
        });
        candidatesPersisted++;
        persistedCandidates.push(savedCand);
      }
    }

    // Canonicalize candidates
    const coordinator = new CanonicalizationCoordinator(options.catalogRepo);
    let canonicalEventsCreated = 0;
    let canonicalEventsMatched = 0;
    let candidatesNeedsReview = 0;
    let candidatesRejected = 0;
    let candidatesSkipped = 0;
    const reviewReasons: Record<string, number> = {};
    const persistedEventIds: string[] = [];

    for (const cand of persistedCandidates) {
      if (!options.reprocess) {
        const existingRes =
          await options.catalogRepo.findResolutionByCandidateId(cand.id);
        if (existingRes) {
          candidatesSkipped++;
          if (existingRes.eventId) {
            persistedEventIds.push(existingRes.eventId);
          }
          if (existingRes.status === 'needs_review') {
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

    const completedAt = new Date().toISOString();
    return {
      source,
      rawIngestsFetched: rawIngests.length,
      rawIngestsPersisted,
      rawIngestsReused,
      candidatesParsed: candidates.length,
      candidatesPersisted,
      candidatesReused,
      candidatesSkipped,
      canonicalEventsCreated,
      canonicalEventsMatched,
      candidatesNeedsReview,
      candidatesRejected,
      reviewReasons,
      persistedEventIds,
      candidates,
      startedAt,
      completedAt,
      durationMs: Math.max(1, Date.now() - startMs),
    };
  } catch (err) {
    await options.sourceRepo.recordFailure(source.id).catch(() => {});
    throw err;
  }
}
