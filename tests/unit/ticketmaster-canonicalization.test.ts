import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import type { EventCandidate } from '@/lib/domain/event-candidate';
import type { RawIngest } from '@/lib/domain/source';
import { CanonicalizationCoordinator } from '@/lib/entity-resolution/canonicalization-coordinator';
import {
  MemoryCatalogRepository,
  MemoryEventCandidateRepository,
  MemoryRawIngestRepository,
  MemorySourceRepository,
} from '@/lib/repositories/memory-repositories';
import {
  TicketmasterDiscoveryAdapter,
  ensureTicketmasterSource,
  runTicketmasterIngestion,
  TICKETMASTER_DEFAULT_SOURCE_ID,
  TICKETMASTER_SOURCE_SLUG,
} from '@/lib/sources/ticketmaster';
import { formatPricePreview } from '../../scripts/ingest-ticketmaster';
import type { CanonicalizationPayload } from '@/lib/repositories/interfaces';

describe('Phase 2 PR 2: Ticketmaster Canonicalization Integration', () => {
  function setupTestRepositories() {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();
    const adapter = new TicketmasterDiscoveryAdapter();

    return { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo, adapter };
  }

  // Requirement 1: New Ticketmaster fixture → raw ingest → candidate → canonical event
  it('1. ingests deterministic fixture through raw ingest and candidate to canonical event', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo, adapter } =
      setupTestRepositories();

    const result = await runTicketmasterIngestion({
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      adapter,
      useFixture: true,
      persist: true,
    });

    expect(result.rawIngestsPersisted).toBe(1);
    expect(result.candidatesPersisted).toBe(6);
    expect(result.canonicalEventsCreated).toBe(5);
    expect(result.candidatesNeedsReview).toBe(1);
    expect(result.reviewReasons['missing_venue_locality']).toBe(1);
    expect(result.persistedEventIds.length).toBe(5);

    // Verify canonical events exist in catalog
    const listedEvents = await catalogRepo.listEvents();
    expect(listedEvents.length).toBe(5);
  });

  // Requirement 2: Correct source registry lookup or registration
  it('2. registers Ticketmaster source deterministically and reuses existing row on repeat lookup', async () => {
    const { sourceRepo } = setupTestRepositories();

    // 1. Fresh database: no sources exist
    const freshSource = await ensureTicketmasterSource(sourceRepo);
    expect(freshSource.id).toBe(TICKETMASTER_DEFAULT_SOURCE_ID);
    expect(freshSource.slug).toBe(TICKETMASTER_SOURCE_SLUG);
    expect(freshSource.sourceType).toBe('ticketing');
    expect(freshSource.acquisitionMethod).toBe('api');

    // 2. Repeat lookup: returns identical source
    const reLookup = await ensureTicketmasterSource(sourceRepo);
    expect(reLookup.id).toBe(freshSource.id);

    // 3. Collision avoidance if default ID is taken by a different slug
    const sourceRepo2 = new MemorySourceRepository();
    await sourceRepo2.upsert({
      id: TICKETMASTER_DEFAULT_SOURCE_ID,
      slug: 'unrelated-slug',
      name: 'Unrelated Source',
      sourceType: 'venue',
      acquisitionMethod: 'rss',
      reliabilityScore: 0.8,
      active: true,
      parserVersion: '1.0.0',
      consecutiveFailures: 0,
    });

    const safeSource = await ensureTicketmasterSource(sourceRepo2);
    expect(safeSource.slug).toBe(TICKETMASTER_SOURCE_SLUG);
    expect(safeSource.id).not.toBe(TICKETMASTER_DEFAULT_SOURCE_ID);
  });

  // Requirement 3: Correct raw-ingest foreign keys
  it('3. associates persisted raw ingests with the correct registered source ID', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo, adapter } =
      setupTestRepositories();

    const result = await runTicketmasterIngestion({
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      adapter,
      useFixture: true,
      persist: true,
    });

    const ingests = await rawIngestRepo.listBySource(result.source.id);
    expect(ingests.length).toBe(1);
    expect(ingests[0].sourceId).toBe(result.source.id);
  });

  // Requirement 4: Consistent candidate and nested provenance IDs
  it('4. ensures candidate rawIngestId and provenance.rawIngestId match the actual database ID', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo, adapter } =
      setupTestRepositories();

    const result = await runTicketmasterIngestion({
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      adapter,
      useFixture: true,
      persist: true,
    });

    const ingests = await rawIngestRepo.listBySource(result.source.id);
    const persistedRawId = ingests[0].id;

    const candidates = await candidateRepo.getByRawIngestId(persistedRawId);
    expect(candidates.length).toBe(6);

    for (const cand of candidates) {
      expect(cand.rawIngestId).toBe(persistedRawId);
      expect(cand.provenance.rawIngestId).toBe(persistedRawId);
      expect(cand.sourceId).toBe(result.source.id);
      expect(cand.provenance.sourceId).toBe(result.source.id);
    }
  });

  // Requirement 5: Reprocessing identical provider data
  it('5. reprocessing identical provider data is 100% idempotent with zero duplicate events', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo, adapter } =
      setupTestRepositories();

    // First ingestion run
    const run1 = await runTicketmasterIngestion({
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      adapter,
      useFixture: true,
      persist: true,
    });
    expect(run1.canonicalEventsCreated).toBe(5);
    const resolutionsRun1 = await catalogRepo.countResolutions();
    const evidenceRun1 = await catalogRepo.countFieldEvidence();
    expect(resolutionsRun1).toBe(6); // 5 created + 1 needs_review
    expect(evidenceRun1).toBeGreaterThan(0);

    // Second ingestion run with identical data (ordinary replay)
    const run2 = await runTicketmasterIngestion({
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      adapter,
      useFixture: true,
      persist: true,
    });

    expect(run2.rawIngestsPersisted).toBe(0);
    expect(run2.rawIngestsReused).toBe(1);
    expect(run2.candidatesReused).toBe(6);
    expect(run2.canonicalEventsCreated).toBe(0);
    expect(run2.canonicalEventsMatched).toBe(5);

    // Verify candidate resolutions and field evidence counts did NOT inflate on replay
    const resolutionsRun2 = await catalogRepo.countResolutions();
    const evidenceRun2 = await catalogRepo.countFieldEvidence();
    expect(resolutionsRun2).toBe(resolutionsRun1);
    expect(evidenceRun2).toBe(evidenceRun1);

    // Catalog count must remain exactly 5
    const events = await catalogRepo.listEvents();
    expect(events.length).toBe(5);
  });

  // Requirement 5b: Replay with explicit --reprocess override deliberately re-evaluates candidates
  it('5b. replay with explicit --reprocess override deliberately re-evaluates candidates through canonicalization coordinator', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo, adapter } =
      setupTestRepositories();

    // Initial run
    await runTicketmasterIngestion({
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      adapter,
      useFixture: true,
      persist: true,
    });

    // Run with reprocess: true
    const reprocessRun = await runTicketmasterIngestion({
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      adapter,
      useFixture: true,
      persist: true,
      reprocess: true,
    });

    expect(reprocessRun.rawIngestsPersisted).toBe(0);
    expect(reprocessRun.rawIngestsReused).toBe(1);
    expect(reprocessRun.candidatesReused).toBe(0); // Deliberately did not skip candidates
    expect(reprocessRun.canonicalEventsCreated).toBe(0);
    expect(reprocessRun.canonicalEventsMatched).toBe(5);

    const events = await catalogRepo.listEvents();
    expect(events.length).toBe(5);
  });

  // Requirement 6: A changed provider observation updating an existing event
  it('6. updates existing canonical event when provider updates event date/time or status', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo } =
      setupTestRepositories();
    const source = await ensureTicketmasterSource(sourceRepo);
    const coordinator = new CanonicalizationCoordinator(catalogRepo);

    // Initial event candidate
    const rawIngest: RawIngest & { id: string } = await rawIngestRepo.create({
      sourceId: source.id,
      sourceUrl: 'https://example.com/api',
      acquisitionMethod: 'api',
      fetchedAt: '2026-10-01T12:00:00Z',
      contentHash: 'hash-init',
      contentType: 'application/json',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });

    const candidate1 = await candidateRepo.create({
      rawIngestId: rawIngest.id,
      sourceId: source.id,
      sourceEventId: 'TM-EVT-UPDATE-1',
      title: 'Vampire Weekend',
      artistNames: ['Vampire Weekend'],
      venueName: 'Red Rocks Amphitheatre',
      city: 'Morrison',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2026-10-20',
      startsAt: '2026-10-21T02:00:00Z',
      startTimePrecision: 'instant',
      confidence: 0.9,
      provenance: {
        sourceId: source.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://example.com/api',
        sourceEventId: 'TM-EVT-UPDATE-1',
        rawIngestId: rawIngest.id,
        fetchedAt: '2026-10-01T12:00:00Z',
        contentHash: 'hash-init',
        parserVersion: '1.0.0',
        confidence: 0.9,
      },
    });

    const initResult = await coordinator.canonicalize(candidate1);
    expect(initResult.status).toBe('created');
    const eventId = initResult.eventId!;

    // Provider later reschedules event to October 25 (new observation in subsequent raw ingest)
    const rawIngest2 = await rawIngestRepo.create({
      sourceId: source.id,
      sourceUrl: 'https://example.com/api',
      acquisitionMethod: 'api',
      fetchedAt: '2026-10-05T12:00:00Z',
      contentHash: 'hash-update',
      contentType: 'application/json',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });

    const candidate2 = await candidateRepo.create({
      rawIngestId: rawIngest2.id,
      sourceId: source.id,
      sourceEventId: 'TM-EVT-UPDATE-1',
      title: 'Vampire Weekend - Rescheduled',
      artistNames: ['Vampire Weekend'],
      venueName: 'Red Rocks Amphitheatre',
      city: 'Morrison',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2026-10-25',
      startsAt: '2026-10-26T02:00:00Z',
      startTimePrecision: 'instant',
      confidence: 0.95,
      rawPayload: { isRescheduled: true },
      provenance: {
        sourceId: source.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://example.com/api',
        sourceEventId: 'TM-EVT-UPDATE-1',
        rawIngestId: rawIngest2.id,
        fetchedAt: '2026-10-05T12:00:00Z',
        contentHash: 'hash-update',
        parserVersion: '1.0.0',
        confidence: 0.95,
      },
    });

    const updateResult = await coordinator.canonicalize(candidate2);
    expect(updateResult.status).toBe('matched');
    expect(updateResult.eventId).toBe(eventId);

    const updatedEvent = await catalogRepo.getEventById(eventId);
    expect(updatedEvent?.localStartDate).toBe('2026-10-25');
    expect(updatedEvent?.startsAt).toBe('2026-10-26T02:00:00Z');
  });

  // Requirement 7: Multiple external observations referring to the same concert
  it('7. matches multiple external observations referring to the same concert via ticket URL', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo } =
      setupTestRepositories();
    const sourceA = await sourceRepo.upsert({
      id: crypto.randomUUID(),
      slug: 'source-a',
      name: 'Source A',
      sourceType: 'ticketing',
      acquisitionMethod: 'api',
      reliabilityScore: 0.9,
      active: true,
      parserVersion: '1.0.0',
      consecutiveFailures: 0,
    });
    const sourceB = await sourceRepo.upsert({
      id: crypto.randomUUID(),
      slug: 'source-b',
      name: 'Source B',
      sourceType: 'venue',
      acquisitionMethod: 'structured_json',
      reliabilityScore: 0.85,
      active: true,
      parserVersion: '1.0.0',
      consecutiveFailures: 0,
    });

    const coordinator = new CanonicalizationCoordinator(catalogRepo);

    const rawA = await rawIngestRepo.create({
      sourceId: sourceA.id,
      sourceUrl: 'https://source-a.com',
      acquisitionMethod: 'api',
      fetchedAt: new Date().toISOString(),
      contentHash: 'hash-a',
      contentType: 'application/json',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });

    const candA = await candidateRepo.create({
      rawIngestId: rawA.id,
      sourceId: sourceA.id,
      sourceEventId: 'EVT-A-1',
      title: 'Leon Bridges',
      artistNames: ['Leon Bridges'],
      venueName: 'Mission Ballroom',
      city: 'Denver',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2026-11-01',
      startsAt: '2026-11-02T02:00:00Z',
      ticketUrl: 'https://tickets.com/events/leon-bridges?utm_source=a',
      confidence: 0.9,
      provenance: {
        sourceId: sourceA.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://source-a.com',
        sourceEventId: 'EVT-A-1',
        rawIngestId: rawA.id,
        fetchedAt: new Date().toISOString(),
        contentHash: 'hash-a',
        parserVersion: '1.0.0',
        confidence: 0.9,
      },
    });

    const resA = await coordinator.canonicalize(candA);
    expect(resA.status).toBe('created');

    // Observation from Source B with stripped ticket URL
    const rawB = await rawIngestRepo.create({
      sourceId: sourceB.id,
      sourceUrl: 'https://source-b.com',
      acquisitionMethod: 'structured_json',
      fetchedAt: new Date().toISOString(),
      contentHash: 'hash-b',
      contentType: 'application/json',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });

    const candB = await candidateRepo.create({
      rawIngestId: rawB.id,
      sourceId: sourceB.id,
      sourceEventId: 'EVT-B-1',
      title: 'Leon Bridges Live',
      artistNames: ['Leon Bridges'],
      venueName: 'Mission Ballroom',
      city: 'Denver',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2026-11-01',
      startsAt: '2026-11-02T02:00:00Z',
      ticketUrl: 'https://tickets.com/events/leon-bridges',
      confidence: 0.85,
      provenance: {
        sourceId: sourceB.id,
        sourceType: 'venue',
        acquisitionMethod: 'structured_json',
        sourceUrl: 'https://source-b.com',
        sourceEventId: 'EVT-B-1',
        rawIngestId: rawB.id,
        fetchedAt: new Date().toISOString(),
        contentHash: 'hash-b',
        parserVersion: '1.0.0',
        confidence: 0.85,
      },
    });

    const resB = await coordinator.canonicalize(candB);
    expect(resB.status).toBe('matched');
    expect(resB.eventId).toBe(resA.eventId);
  });

  // Requirement 8: Distinct concerts that must not be merged
  it('8. prevents merging distinct concerts on different dates or different artists at the same venue', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo } =
      setupTestRepositories();
    const source = await ensureTicketmasterSource(sourceRepo);
    const coordinator = new CanonicalizationCoordinator(catalogRepo);

    const raw = await rawIngestRepo.create({
      sourceId: source.id,
      sourceUrl: 'https://example.com',
      acquisitionMethod: 'api',
      fetchedAt: new Date().toISOString(),
      contentHash: 'hash-dist',
      contentType: 'application/json',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });

    // Night 1
    const night1 = await candidateRepo.create({
      rawIngestId: raw.id,
      sourceId: source.id,
      sourceEventId: 'PHISH-N1',
      title: 'Phish - Night 1',
      artistNames: ['Phish'],
      artists: [
        {
          name: 'Phish',
          billingPosition: 'headliner',
          externalIds: [
            { provider: 'ticketmaster', externalId: 'tm_attraction_phish' },
          ],
        },
      ],
      venueName: 'Dick’s Sporting Goods Park',
      city: 'Commerce City',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2026-09-04',
      startsAt: '2026-09-05T01:30:00Z',
      confidence: 0.9,
      provenance: {
        sourceId: source.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://example.com',
        sourceEventId: 'PHISH-N1',
        rawIngestId: raw.id,
        fetchedAt: new Date().toISOString(),
        contentHash: 'hash-dist',
        parserVersion: '1.0.0',
        confidence: 0.9,
      },
    });

    // Night 2 (consecutive night)
    const night2 = await candidateRepo.create({
      rawIngestId: raw.id,
      sourceId: source.id,
      sourceEventId: 'PHISH-N2',
      title: 'Phish - Night 2',
      artistNames: ['Phish'],
      artists: [
        {
          name: 'Phish',
          billingPosition: 'headliner',
          externalIds: [
            { provider: 'ticketmaster', externalId: 'tm_attraction_phish' },
          ],
        },
      ],
      venueName: 'Dick’s Sporting Goods Park',
      city: 'Commerce City',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2026-09-05',
      startsAt: '2026-09-06T01:30:00Z',
      confidence: 0.9,
      provenance: {
        sourceId: source.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://example.com',
        sourceEventId: 'PHISH-N2',
        rawIngestId: raw.id,
        fetchedAt: new Date().toISOString(),
        contentHash: 'hash-dist',
        parserVersion: '1.0.0',
        confidence: 0.9,
      },
    });

    const res1 = await coordinator.canonicalize(night1);
    const res2 = await coordinator.canonicalize(night2);

    expect(res1.status).toBe('created');
    expect(res2.status).toBe('created');
    expect(res1.eventId).not.toBe(res2.eventId);
  });

  // Requirement 9: Missing venue name or city routing to needs_review
  it('9. routes candidates with missing venue name or missing city to needs_review', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo } =
      setupTestRepositories();
    const source = await ensureTicketmasterSource(sourceRepo);
    const coordinator = new CanonicalizationCoordinator(catalogRepo);

    const raw = await rawIngestRepo.create({
      sourceId: source.id,
      sourceUrl: 'https://example.com',
      acquisitionMethod: 'api',
      fetchedAt: new Date().toISOString(),
      contentHash: 'hash-missing-loc',
      contentType: 'application/json',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });

    // Case A: Missing city
    const candMissingCity = await candidateRepo.create({
      rawIngestId: raw.id,
      sourceId: source.id,
      sourceEventId: 'NO-CITY-1',
      title: 'Show Without City',
      artistNames: ['Local Band'],
      venueName: 'Unknown Mountain Spot',
      city: undefined,
      timezone: 'America/Denver',
      localStartDate: '2026-10-30',
      confidence: 0.8,
      provenance: {
        sourceId: source.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://example.com',
        sourceEventId: 'NO-CITY-1',
        rawIngestId: raw.id,
        fetchedAt: new Date().toISOString(),
        contentHash: 'hash-missing-loc',
        parserVersion: '1.0.0',
        confidence: 0.8,
      },
    });

    const resCity = await coordinator.canonicalize(candMissingCity);
    expect(resCity.status).toBe('needs_review');
    expect(resCity.reasons).toContain('missing_venue_locality');

    // Case B: Missing / placeholder venue name
    const candMissingVenue = await candidateRepo.create({
      rawIngestId: raw.id,
      sourceId: source.id,
      sourceEventId: 'NO-VENUE-1',
      title: 'Show Without Venue',
      artistNames: ['Local Band'],
      venueName: 'Unknown Venue',
      city: 'Denver',
      timezone: 'America/Denver',
      localStartDate: '2026-10-30',
      confidence: 0.8,
      provenance: {
        sourceId: source.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://example.com',
        sourceEventId: 'NO-VENUE-1',
        rawIngestId: raw.id,
        fetchedAt: new Date().toISOString(),
        contentHash: 'hash-missing-loc',
        parserVersion: '1.0.0',
        confidence: 0.8,
      },
    });

    const resVenue = await coordinator.canonicalize(candMissingVenue);
    expect(resVenue.status).toBe('needs_review');
    expect(resVenue.reasons).toContain('missing_venue_identity');
  });

  // Requirement 10: Missing artist identity routing to needs_review
  it('10. routes candidates with missing artist identity to needs_review', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo } =
      setupTestRepositories();
    const source = await ensureTicketmasterSource(sourceRepo);
    const coordinator = new CanonicalizationCoordinator(catalogRepo);

    const raw = await rawIngestRepo.create({
      sourceId: source.id,
      sourceUrl: 'https://example.com',
      acquisitionMethod: 'api',
      fetchedAt: new Date().toISOString(),
      contentHash: 'hash-missing-art',
      contentType: 'application/json',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });

    const candNoArtist = await candidateRepo.create({
      rawIngestId: raw.id,
      sourceId: source.id,
      sourceEventId: 'NO-ART-1',
      title: 'Mystery Concert',
      artistNames: [],
      venueName: 'Gothic Theatre',
      city: 'Englewood',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2026-11-05',
      confidence: 0.8,
      provenance: {
        sourceId: source.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://example.com',
        sourceEventId: 'NO-ART-1',
        rawIngestId: raw.id,
        fetchedAt: new Date().toISOString(),
        contentHash: 'hash-missing-art',
        parserVersion: '1.0.0',
        confidence: 0.8,
      },
    });

    const res = await coordinator.canonicalize(candNoArtist);
    expect(res.status).toBe('needs_review');
    expect(res.reasons).toContain('missing_artist_identity');
  });

  // Requirement 11: Missing timezone without fabricated values
  it('11. routes candidates with missing or invalid timezone to needs_review without defaulting to Denver', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo } =
      setupTestRepositories();
    const source = await ensureTicketmasterSource(sourceRepo);
    const coordinator = new CanonicalizationCoordinator(catalogRepo);

    const raw = await rawIngestRepo.create({
      sourceId: source.id,
      sourceUrl: 'https://example.com',
      acquisitionMethod: 'api',
      fetchedAt: new Date().toISOString(),
      contentHash: 'hash-no-tz',
      contentType: 'application/json',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });

    const candNoTz = await candidateRepo.create({
      rawIngestId: raw.id,
      sourceId: source.id,
      sourceEventId: 'NO-TZ-1',
      title: 'Artist At Brand New Venue',
      artistNames: ['Touring Artist'],
      venueName: 'Brand New Untracked Club',
      city: 'Austin',
      state: 'TX',
      timezone: undefined,
      localStartDate: '2026-11-10',
      confidence: 0.8,
      provenance: {
        sourceId: source.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://example.com',
        sourceEventId: 'NO-TZ-1',
        rawIngestId: raw.id,
        fetchedAt: new Date().toISOString(),
        contentHash: 'hash-no-tz',
        parserVersion: '1.0.0',
        confidence: 0.8,
      },
    });

    const res = await coordinator.canonicalize(candNoTz);
    expect(res.status).toBe('needs_review');
    expect(res.reasons).toContain('missing_or_invalid_timezone');
  });

  // Requirement 12: Date-only precision preservation
  it('12. preserves date_only precision with null starts_at without guessing a start time', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo } =
      setupTestRepositories();
    const source = await ensureTicketmasterSource(sourceRepo);
    const coordinator = new CanonicalizationCoordinator(catalogRepo);

    const raw = await rawIngestRepo.create({
      sourceId: source.id,
      sourceUrl: 'https://example.com',
      acquisitionMethod: 'api',
      fetchedAt: new Date().toISOString(),
      contentHash: 'hash-date-only',
      contentType: 'application/json',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });

    const candDateOnly = await candidateRepo.create({
      rawIngestId: raw.id,
      sourceId: source.id,
      sourceEventId: 'DATE-ONLY-1',
      title: 'Wilco - Summer Tour',
      artistNames: ['Wilco'],
      venueName: 'Red Rocks Amphitheatre',
      city: 'Morrison',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2027-06-20',
      startsAt: undefined,
      startTimePrecision: 'date_only',
      confidence: 0.9,
      provenance: {
        sourceId: source.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://example.com',
        sourceEventId: 'DATE-ONLY-1',
        rawIngestId: raw.id,
        fetchedAt: new Date().toISOString(),
        contentHash: 'hash-date-only',
        parserVersion: '1.0.0',
        confidence: 0.9,
      },
    });

    const res = await coordinator.canonicalize(candDateOnly);
    expect(res.status).toBe('created');

    const canonical = await catalogRepo.getEventById(res.eventId!);
    expect(canonical?.startTimePrecision).toBe('date_only');
    expect(canonical?.startsAt).toBeNull();
    expect(canonical?.localStartDate).toBe('2027-06-20');
  });

  // Requirement 13: Missing currency preservation
  it('13. preserves missing price currency as null without defaulting to USD', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo } =
      setupTestRepositories();
    const source = await ensureTicketmasterSource(sourceRepo);
    const coordinator = new CanonicalizationCoordinator(catalogRepo);

    const raw = await rawIngestRepo.create({
      sourceId: source.id,
      sourceUrl: 'https://example.com',
      acquisitionMethod: 'api',
      fetchedAt: new Date().toISOString(),
      contentHash: 'hash-no-curr',
      contentType: 'application/json',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });

    const candNoCurr = await candidateRepo.create({
      rawIngestId: raw.id,
      sourceId: source.id,
      sourceEventId: 'NO-CURR-1',
      title: 'International Pop-up',
      artistNames: ['Foreign Artist'],
      venueName: 'Bluebird Theater',
      city: 'Denver',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2026-11-15',
      ticketUrl: 'https://tickets.com/intl-show',
      price: { min: 40, max: 60, currency: undefined },
      confidence: 0.9,
      provenance: {
        sourceId: source.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://example.com',
        sourceEventId: 'NO-CURR-1',
        rawIngestId: raw.id,
        fetchedAt: new Date().toISOString(),
        contentHash: 'hash-no-curr',
        parserVersion: '1.0.0',
        confidence: 0.9,
      },
    });

    const res = await coordinator.canonicalize(candNoCurr);
    expect(res.status).toBe('created');

    const canonical = await catalogRepo.getEventById(res.eventId!);
    expect(canonical?.ticketLinks.length).toBe(1);
    expect(canonical?.ticketLinks[0].currency).toBeNull();
  });

  // Requirement 14: Cancellations and rescheduling
  it('14. correctly merges cancellation status without deleting the canonical event', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo } =
      setupTestRepositories();
    const source = await ensureTicketmasterSource(sourceRepo);
    const coordinator = new CanonicalizationCoordinator(catalogRepo);

    const raw = await rawIngestRepo.create({
      sourceId: source.id,
      sourceUrl: 'https://example.com',
      acquisitionMethod: 'api',
      fetchedAt: new Date().toISOString(),
      contentHash: 'hash-cancel',
      contentType: 'application/json',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });

    // 1. Initial scheduled event
    const candScheduled = await candidateRepo.create({
      rawIngestId: raw.id,
      sourceId: source.id,
      sourceEventId: 'CANCEL-TEST-1',
      title: 'Future Islands',
      artistNames: ['Future Islands'],
      venueName: 'Ogden Theatre',
      city: 'Denver',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2026-12-01',
      startsAt: '2026-12-02T03:00:00Z',
      confidence: 0.9,
      provenance: {
        sourceId: source.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://example.com',
        sourceEventId: 'CANCEL-TEST-1',
        rawIngestId: raw.id,
        fetchedAt: new Date().toISOString(),
        contentHash: 'hash-cancel',
        parserVersion: '1.0.0',
        confidence: 0.9,
      },
    });

    const res1 = await coordinator.canonicalize(candScheduled);
    expect(res1.status).toBe('created');

    // 2. Cancellation update from provider in subsequent raw ingest
    const rawCancelled = await rawIngestRepo.create({
      sourceId: source.id,
      sourceUrl: 'https://example.com/cancelled',
      acquisitionMethod: 'api',
      fetchedAt: new Date().toISOString(),
      contentHash: 'hash-cancel-2',
      contentType: 'application/json',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });

    const candCancelled = await candidateRepo.create({
      rawIngestId: rawCancelled.id,
      sourceId: source.id,
      sourceEventId: 'CANCEL-TEST-1',
      title: 'Future Islands - CANCELLED',
      artistNames: ['Future Islands'],
      venueName: 'Ogden Theatre',
      city: 'Denver',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2026-12-01',
      startsAt: '2026-12-02T03:00:00Z',
      confidence: 0.95,
      rawPayload: { status: 'cancelled' },
      provenance: {
        sourceId: source.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://example.com',
        sourceEventId: 'CANCEL-TEST-1',
        rawIngestId: rawCancelled.id,
        fetchedAt: new Date().toISOString(),
        contentHash: 'hash-cancel-2',
        parserVersion: '1.0.0',
        confidence: 0.95,
      },
    });

    const res2 = await coordinator.canonicalize(candCancelled);
    expect(res2.status).toBe('matched');
    expect(res2.eventId).toBe(res1.eventId);

    const canonical = await catalogRepo.getEventById(res1.eventId!);
    expect(canonical?.status).toBe('cancelled');
  });

  // Requirement 15: Multiple artists on a single concert
  it('15. correctly persists multiple artists with headliner and support billing orders', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo } =
      setupTestRepositories();
    const source = await ensureTicketmasterSource(sourceRepo);
    const coordinator = new CanonicalizationCoordinator(catalogRepo);

    const raw = await rawIngestRepo.create({
      sourceId: source.id,
      sourceUrl: 'https://example.com',
      acquisitionMethod: 'api',
      fetchedAt: new Date().toISOString(),
      contentHash: 'hash-multi-act',
      contentType: 'application/json',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });

    const candMulti = await candidateRepo.create({
      rawIngestId: raw.id,
      sourceId: source.id,
      sourceEventId: 'MULTI-ACT-1',
      title: 'Big Thief with Japanese Breakfast and Lucy Dacus',
      artistNames: ['Big Thief', 'Japanese Breakfast', 'Lucy Dacus'],
      artists: [
        { name: 'Big Thief', billingPosition: 'headliner', sortOrder: 0 },
        {
          name: 'Japanese Breakfast',
          billingPosition: 'support',
          sortOrder: 1,
        },
        { name: 'Lucy Dacus', billingPosition: 'support', sortOrder: 2 },
      ],
      venueName: 'Red Rocks Amphitheatre',
      city: 'Morrison',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2026-09-18',
      startsAt: '2026-09-19T01:00:00Z',
      confidence: 0.95,
      provenance: {
        sourceId: source.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://example.com',
        sourceEventId: 'MULTI-ACT-1',
        rawIngestId: raw.id,
        fetchedAt: new Date().toISOString(),
        contentHash: 'hash-multi-act',
        parserVersion: '1.0.0',
        confidence: 0.95,
      },
    });

    const res = await coordinator.canonicalize(candMulti);
    expect(res.status).toBe('created');

    const canonical = await catalogRepo.getEventById(res.eventId!);
    expect(canonical?.artists.length).toBe(3);
    expect(canonical?.artists[0].name).toBe('Big Thief');
    expect(canonical?.artists[0].billingPosition).toBe('headliner');
    expect(canonical?.artists[1].name).toBe('Japanese Breakfast');
    expect(canonical?.artists[1].billingPosition).toBe('support');
    expect(canonical?.artists[2].name).toBe('Lucy Dacus');
    expect(canonical?.artists[2].billingPosition).toBe('support');
  });

  // Requirement 16: Atomic external-ID enrichment
  it('16. atomically enriches newly observed Ticketmaster external ID on an already matched artist', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo } =
      setupTestRepositories();
    const source = await ensureTicketmasterSource(sourceRepo);
    const coordinator = new CanonicalizationCoordinator(catalogRepo);

    // 1. Existing canonical artist with Spotify ID in catalog
    const existingArtist = await catalogRepo.createArtist({
      name: 'Bon Iver',
      normalizedName: 'bon iver',
    });
    await catalogRepo.addArtistExternalId({
      artistId: existingArtist.id,
      provider: 'spotify',
      externalId: 'spotify_bon_iver_123',
    });

    // 2. Incoming candidate has Spotify ID (matching artist) AND new Ticketmaster ID
    const raw = await rawIngestRepo.create({
      sourceId: source.id,
      sourceUrl: 'https://example.com',
      acquisitionMethod: 'api',
      fetchedAt: new Date().toISOString(),
      contentHash: 'hash-enrich',
      contentType: 'application/json',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });

    const cand = await candidateRepo.create({
      rawIngestId: raw.id,
      sourceId: source.id,
      sourceEventId: 'TM-BON-IVER-1',
      title: 'Bon Iver Live',
      artistNames: ['Bon Iver'],
      artists: [
        {
          name: 'Bon Iver',
          billingPosition: 'headliner',
          externalIds: [
            { provider: 'spotify', externalId: 'spotify_bon_iver_123' },
            { provider: 'ticketmaster', externalId: 'tm_attraction_boniver' },
          ],
        },
      ],
      venueName: 'Red Rocks Amphitheatre',
      city: 'Morrison',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2026-10-10',
      startsAt: '2026-10-11T02:00:00Z',
      confidence: 0.95,
      provenance: {
        sourceId: source.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://example.com',
        sourceEventId: 'TM-BON-IVER-1',
        rawIngestId: raw.id,
        fetchedAt: new Date().toISOString(),
        contentHash: 'hash-enrich',
        parserVersion: '1.0.0',
        confidence: 0.95,
      },
    });

    const res = await coordinator.canonicalize(cand);
    expect(res.status).toBe('created');

    // Verify external IDs on existing artist: must now have both Spotify and Ticketmaster!
    const externalIds = await catalogRepo.findArtistExternalIds(
      existingArtist.id,
    );
    expect(externalIds.length).toBe(2);
    expect(
      externalIds.some(
        (e) =>
          e.provider === 'ticketmaster' &&
          e.externalId === 'tm_attraction_boniver',
      ),
    ).toBe(true);
    expect(
      externalIds.some(
        (e) =>
          e.provider === 'spotify' && e.externalId === 'spotify_bon_iver_123',
      ),
    ).toBe(true);
  });

  // Requirement 17: Conflicting external IDs
  it('17. rejects associating external ID when it is already registered to a different canonical artist', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo } =
      setupTestRepositories();
    const source = await ensureTicketmasterSource(sourceRepo);
    const coordinator = new CanonicalizationCoordinator(catalogRepo);

    // Artist 1 owns TM ID "TM-CONFLICT-1"
    const artist1 = await catalogRepo.createArtist({
      name: 'Artist Alpha',
      normalizedName: 'artist alpha',
    });
    await catalogRepo.addArtistExternalId({
      artistId: artist1.id,
      provider: 'ticketmaster',
      externalId: 'TM-CONFLICT-1',
    });

    // Artist 2 has a Spotify ID
    const artist2 = await catalogRepo.createArtist({
      name: 'Artist Beta',
      normalizedName: 'artist beta',
    });
    await catalogRepo.addArtistExternalId({
      artistId: artist2.id,
      provider: 'spotify',
      externalId: 'SPOTIFY-BETA-1',
    });

    // Incoming candidate identifies Artist Beta by Spotify ID, but asserts TM ID belongs to Artist Alpha!
    const raw = await rawIngestRepo.create({
      sourceId: source.id,
      sourceUrl: 'https://example.com',
      acquisitionMethod: 'api',
      fetchedAt: new Date().toISOString(),
      contentHash: 'hash-ext-conflict',
      contentType: 'application/json',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });

    const candConflict = await candidateRepo.create({
      rawIngestId: raw.id,
      sourceId: source.id,
      sourceEventId: 'TM-CONFLICT-EVT',
      title: 'Artist Beta Live',
      artistNames: ['Artist Beta'],
      artists: [
        {
          name: 'Artist Beta',
          billingPosition: 'headliner',
          externalIds: [
            { provider: 'spotify', externalId: 'SPOTIFY-BETA-1' },
            { provider: 'ticketmaster', externalId: 'TM-CONFLICT-1' },
          ],
        },
      ],
      venueName: 'Ogden Theatre',
      city: 'Denver',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2026-11-20',
      confidence: 0.9,
      provenance: {
        sourceId: source.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://example.com',
        sourceEventId: 'TM-CONFLICT-EVT',
        rawIngestId: raw.id,
        fetchedAt: new Date().toISOString(),
        contentHash: 'hash-ext-conflict',
        parserVersion: '1.0.0',
        confidence: 0.9,
      },
    });

    const res = await coordinator.canonicalize(candConflict);
    expect(res.status).toBe('needs_review');
    expect(res.reasons).toContain(
      'external_id_already_associated_with_different_artist',
    );
  });

  // Requirement 18: Transaction rollback upon failure
  it('18. guarantees zero orphaned records when canonicalization persistence encounters an error', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo } =
      setupTestRepositories();
    const source = await ensureTicketmasterSource(sourceRepo);

    // Mock applyCanonicalization to simulate an unhandled database failure
    const originalApply = catalogRepo.applyCanonicalization.bind(catalogRepo);
    catalogRepo.applyCanonicalization = async () => {
      throw new Error(
        'Simulated PostgreSQL foreign key check failure in apply_canonicalization RPC',
      );
    };

    const coordinator = new CanonicalizationCoordinator(catalogRepo);

    const raw = await rawIngestRepo.create({
      sourceId: source.id,
      sourceUrl: 'https://example.com',
      acquisitionMethod: 'api',
      fetchedAt: new Date().toISOString(),
      contentHash: 'hash-rollback-test',
      contentType: 'application/json',
      httpStatus: 200,
      parserVersion: '1.0.0',
    });

    const cand = await candidateRepo.create({
      rawIngestId: raw.id,
      sourceId: source.id,
      sourceEventId: 'ROLLBACK-1',
      title: 'Rollback Band',
      artistNames: ['Rollback Band'],
      venueName: 'New Rollback Venue',
      city: 'Boulder',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2026-12-31',
      confidence: 0.9,
      provenance: {
        sourceId: source.id,
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://example.com',
        sourceEventId: 'ROLLBACK-1',
        rawIngestId: raw.id,
        fetchedAt: new Date().toISOString(),
        contentHash: 'hash-rollback-test',
        parserVersion: '1.0.0',
        confidence: 0.9,
      },
    });

    await expect(coordinator.canonicalize(cand)).rejects.toThrow(
      /Simulated PostgreSQL foreign key check failure/,
    );

    // Restore applyCanonicalization and verify catalog is completely clean (zero orphaned events or venues)
    catalogRepo.applyCanonicalization = originalApply;
    const events = await catalogRepo.listEvents();
    expect(events.length).toBe(0);
  });

  // Requirement 19: Field-level provenance and evidence rows
  it('19. records complete field evidence rows with provenance linking to raw ingest and source', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo, adapter } =
      setupTestRepositories();

    const result = await runTicketmasterIngestion({
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      adapter,
      useFixture: true,
      persist: true,
    });

    const eventId = result.persistedEventIds[0];
    const eventDetail = await catalogRepo.getEventById(eventId);
    expect(eventDetail).not.toBeNull();
    expect(eventDetail?.fieldEvidence).toBeDefined();
    expect(eventDetail!.fieldEvidence!.length).toBeGreaterThanOrEqual(5);

    const titleEvidence = eventDetail!.fieldEvidence!.find(
      (e) => e.fieldName === 'title',
    );
    expect(titleEvidence).toBeDefined();
    expect(titleEvidence?.sourceId).toBe(result.source.id);
    expect(titleEvidence?.rawIngestId).toBeDefined();
  });

  // Requirement 20: Accepted events visible through the catalog repository
  it('20. newly canonicalized events are immediately visible and queryable through listEvents', async () => {
    const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo, adapter } =
      setupTestRepositories();

    await runTicketmasterIngestion({
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      adapter,
      useFixture: true,
      persist: true,
    });

    const allEvents = await catalogRepo.listEvents({ limit: 50 });
    expect(allEvents.length).toBe(5);

    // Filter by city
    const denverEvents = await catalogRepo.listEvents({ city: 'Denver' });
    expect(denverEvents.length).toBeGreaterThanOrEqual(1);

    // Each summary has title, venueName, date, artists, ticket URL
    for (const evt of allEvents) {
      expect(evt.id).toBeDefined();
      expect(evt.title.length).toBeGreaterThan(0);
      expect(evt.venueName.length).toBeGreaterThan(0);
      expect(evt.localStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(evt.artists.length).toBeGreaterThanOrEqual(1);
    }
  });

  // Requirement 21: applyCanonicalization cross-artist external ID conflict rejection & rollback
  it('21. applyCanonicalization rejects cross-artist external ID conflict with unique constraint and performs atomic rollback', async () => {
    const { catalogRepo } = setupTestRepositories();

    // 1. Create artist A and attach Ticketmaster external ID
    const artistA = await catalogRepo.createArtist({
      name: 'Artist Alpha',
      normalizedName: 'artist alpha',
    });
    await catalogRepo.addArtistExternalId({
      artistId: artistA.id,
      provider: 'ticketmaster',
      externalId: 'TM-EXTERNAL-ALPHA',
    });

    // 2. Create artist B
    const artistB = await catalogRepo.createArtist({
      name: 'Artist Beta',
      normalizedName: 'artist beta',
    });

    // 3. Attempt canonicalization transaction that tries to assign Artist Alpha's external ID to Artist Beta
    const conflictPayload: CanonicalizationPayload = {
      event: {
        name: 'Conflicting Beta Concert',
        normalized_name: 'conflicting beta concert',
        local_start_date: '2026-12-25',
        timezone: 'America/Denver',
      },
      venueToCreate: {
        name: 'Conflict Venue',
        normalized_name: 'conflict venue',
        city: 'Denver',
      },
      artists: [
        {
          artist_id: artistB.id,
          name: 'Artist Beta',
          external_ids: [
            {
              provider: 'ticketmaster',
              external_id: 'TM-EXTERNAL-ALPHA', // Belongs to Artist Alpha!
            },
          ],
        },
      ],
    };

    await expect(
      catalogRepo.applyCanonicalization(conflictPayload),
    ).rejects.toThrow(
      /duplicate key value violates unique constraint "uq_artist_provider_external_id"/,
    );

    // 4. Verify atomic rollback: no new event or venue was created
    const events = await catalogRepo.listEvents();
    expect(events.length).toBe(0);

    const venue = await catalogRepo.findVenue('conflict venue', 'Denver');
    expect(venue).toBeNull();

    // Artist Beta did not receive the conflicting external ID
    const betaExt = Array.from(catalogRepo.artistExternalIds.values()).filter(
      (e) => e.artistId === artistB.id,
    );
    expect(betaExt.length).toBe(0);
  });

  // Requirement 22: formatPricePreview neutral currency formatting
  it('22. formatPricePreview formats prices neutrally without fabricating currencies or symbols', () => {
    // Missing or undefined price
    expect(formatPricePreview(null)).toBe('Price TBA');
    expect(formatPricePreview(undefined)).toBe('Price TBA');
    expect(formatPricePreview({ min: null, max: null })).toBe('Price TBA');

    // USD currency
    expect(formatPricePreview({ min: 25, max: 75, currency: 'USD' })).toBe(
      '$25 – 75 USD',
    );
    expect(formatPricePreview({ min: 50, max: 50, currency: 'USD' })).toBe(
      '$50 USD',
    );

    // Non-USD currency (must not prepend $)
    expect(formatPricePreview({ min: 30, max: 80, currency: 'EUR' })).toBe(
      '30 – 80 EUR',
    );
    expect(formatPricePreview({ min: 40, max: 40, currency: 'GBP' })).toBe(
      '40 GBP',
    );

    // Missing currency (must not assume $ or USD)
    expect(formatPricePreview({ min: 20, max: 60, currency: null })).toBe(
      '20 – 60 (Currency Unknown)',
    );
    expect(formatPricePreview({ min: 35, max: 35, currency: undefined })).toBe(
      '35 (Currency Unknown)',
    );
  });
});
