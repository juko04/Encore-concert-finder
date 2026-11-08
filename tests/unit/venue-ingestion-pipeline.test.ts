import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeName } from '@/lib/domain/value-objects';
import {
  MemoryCatalogRepository,
  MemoryEventCandidateRepository,
  MemoryRawIngestRepository,
  MemorySourceRepository,
} from '@/lib/repositories/memory-repositories';
import { runVenueIngestion } from '@/lib/sources/venue/ingestion-pipeline';
import { CERVANTES_CONFIG } from '@/lib/sources/venue/source-registry';

describe('Venue Ingestion Pipeline', () => {
  const fixturePath = path.resolve(
    process.cwd(),
    'tests/fixtures/cervantes-events-response.html',
  );
  const fixtureHtml = fs.readFileSync(fixturePath, 'utf-8');

  it('executes safe dry-run preview with zero database writes', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    const result = await runVenueIngestion({
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      fixtureHtml,
      persist: false,
    });

    expect(result.source.slug).toBe(CERVANTES_CONFIG.slug);
    expect(result.rawIngestsFetched).toBe(1);
    expect(result.rawIngestsPersisted).toBe(0);
    expect(result.candidatesParsed).toBe(103);
    expect(result.candidatesPersisted).toBe(0);
    expect(result.canonicalEventsCreated).toBeGreaterThan(50);
    expect(result.candidatesNeedsReview).toBeGreaterThanOrEqual(0);

    // Verify raw ingest repo remains completely empty in dry-run
    const rawList = await rawIngestRepo.listBySource(result.source.id);
    expect(rawList).toHaveLength(0);
  });

  it('persists raw ingests, candidates, and canonical entities in persist mode', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    const result = await runVenueIngestion({
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      fixtureHtml,
      persist: true,
    });

    expect(result.rawIngestsPersisted).toBe(1);
    expect(result.candidatesPersisted).toBe(103);
    expect(result.canonicalEventsCreated).toBeGreaterThan(50);
    expect(result.persistedEventIds.length).toBeGreaterThan(50);

    // Verify raw ingest row was persisted with SHA-256 hash
    const rawList = await rawIngestRepo.listBySource(result.source.id);
    expect(rawList).toHaveLength(1);
    expect(rawList[0].contentHash).toMatch(/^[0-9a-f]{64}$/);

    // Verify canonical events are queryable via catalog repository
    const firstEventId = result.persistedEventIds[0];
    const event = await catalogRepo.getEventById(firstEventId);
    expect(event).toBeDefined();
    expect(event?.sources.length).toBeGreaterThanOrEqual(1);
    expect(event?.sources[0].sourceId).toBe(result.source.id);
  });

  it('guarantees 100% idempotent repeat ingestion with zero duplicate canonical events', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    // First ingestion run
    const firstResult = await runVenueIngestion({
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      fixtureHtml,
      persist: true,
    });

    const initialCreatedCount = firstResult.canonicalEventsCreated;
    expect(initialCreatedCount).toBeGreaterThan(50);

    // Second ingestion run against the identical source payload
    const secondResult = await runVenueIngestion({
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      fixtureHtml,
      persist: true,
    });

    expect(secondResult.rawIngestsFetched).toBe(1);
    expect(secondResult.rawIngestsPersisted).toBe(0);
    expect(secondResult.rawIngestsReused).toBe(1); // Reused existing raw ingest row
    expect(secondResult.canonicalEventsCreated).toBe(0); // ZERO duplicate events created!
    expect(
      secondResult.candidatesSkipped + secondResult.canonicalEventsMatched,
    ).toBeGreaterThan(50);
  });

  it('matches existing Ticketmaster event and prevents cross-source duplicate creation', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    // 1. Seed an existing canonical event (as if previously ingested from Ticketmaster)
    // Matches the Daniel Donato show: 2026-11-07 at Mission Ballroom
    const venue = await catalogRepo.findVenueByNameAndCity(
      'Mission Ballroom',
      'Denver',
    );
    const venueId =
      venue?.id ??
      (
        await catalogRepo.createVenue({
          name: 'Mission Ballroom',
          normalizedName: 'mission ballroom',
          city: 'Denver',
          region: 'CO',
          countryCode: 'US',
          timezone: 'America/Denver',
        })
      ).id;

    const normArtist = normalizeName("Daniel Donato's Cosmic Country");
    const artist =
      (await catalogRepo.findArtistByName(normArtist)) ??
      (await catalogRepo.createArtist({
        name: "Daniel Donato's Cosmic Country",
        normalizedName: normArtist,
      }));

    const existingTmEvent = await catalogRepo.createEvent({
      name: "Daniel Donato's Cosmic Country",
      normalizedName: normArtist,
      eventKind: 'concert',
      status: 'scheduled',
      venueId,
      city: 'Denver',
      region: 'CO',
      countryCode: 'US',
      timezone: 'America/Denver',
      localStartDate: '2026-11-07',
      startsAt: '2026-11-08T03:00:00.000Z',
      startTimePrecision: 'instant',
      isMultiDay: false,
      primaryTicketUrl: 'https://www.ticketmaster.com/event/12345',
    });

    await catalogRepo.linkEventArtist(
      existingTmEvent.id,
      artist.id,
      'headliner',
      1,
    );

    // 2. Run venue ingestion for Cervantes calendar (which co-promotes this Mission Ballroom show)
    const venueResult = await runVenueIngestion({
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      fixtureHtml,
      persist: true,
    });

    // 3. Confirm that the show matched the pre-existing event rather than creating a duplicate
    expect(venueResult.canonicalEventsMatched).toBeGreaterThanOrEqual(1);

    // Verify Daniel Donato show now has BOTH Ticketmaster and Cervantes source corroboration
    const mergedEvent = await catalogRepo.getEventById(existingTmEvent.id);
    expect(mergedEvent).toBeDefined();

    // Verify ticket links contain the newly merged Etix link
    expect(mergedEvent?.ticketLinks.length).toBeGreaterThanOrEqual(1);
    expect(
      mergedEvent?.ticketLinks.some((tl) => tl.url.includes('etix.com')),
    ).toBe(true);
  });

  it('routes candidate with missing required fields to needs_review', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    // Malformed HTML with missing date and unknown venue
    const malformedHtml = `
      <div class="generalView">
        <div class="col-12 eventWrapper rhpSingleEvent py-4 px-0 rhp-event__single-event--list">
          <h2 class="rhp-event__title--list">Untitled Jam</h2>
        </div>
      </div>
    `;

    const result = await runVenueIngestion({
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      fixtureHtml: malformedHtml,
      persist: false,
    });

    expect(result.candidatesParsed).toBe(1);
    expect(result.candidatesNeedsReview).toBe(1);
    expect(result.reviewReasons['missing_event_date']).toBe(1);
  });

  it('canonicalizes cancelled concerts with status "cancelled" and excludes them from scheduled catalog', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    const result = await runVenueIngestion({
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      fixtureHtml,
      persist: true,
    });

    // Find all persisted events
    const allEvents = await Promise.all(
      result.persistedEventIds.map((id) => catalogRepo.getEventById(id)),
    );

    // Verify cancelled Ghengar concert from fixture was persisted with status: 'cancelled'
    const ghengarShow = allEvents.find((e) => e?.name.includes('Ghengar'));
    expect(ghengarShow).toBeDefined();
    expect(ghengarShow?.status).toBe('cancelled');

    // Verify scheduled catalog query strictly excludes cancelled events
    const scheduledEvents = await catalogRepo.listEvents({
      status: 'scheduled',
      limit: 200,
    });
    const ghengarInScheduled = scheduledEvents.find((e) =>
      e.title.includes('Ghengar'),
    );
    expect(ghengarInScheduled).toBeUndefined();
  });

  it('distinguishes separate early and late performances for the same artist on the same date without merging', async () => {
    const crypto = await import('node:crypto');
    const sourceRepo = new MemorySourceRepository();
    const catalogRepo = new MemoryCatalogRepository();
    const { CanonicalizationCoordinator } =
      await import('@/lib/entity-resolution/canonicalization-coordinator');

    const sourceId = crypto.randomUUID();
    const rawIngestId = crypto.randomUUID();

    const source = await sourceRepo.upsert({
      id: sourceId,
      name: "Cervantes' Other Side",
      slug: 'cervantes-other-side',
      sourceType: 'venue',
      acquisitionMethod: 'html_http',
      parserVersion: '1.0.0',
      active: true,
      consecutiveFailures: 0,
      reliabilityScore: 0.98,
    });

    const venue = await catalogRepo.createVenue({
      name: "Cervantes' Other Side",
      normalizedName: 'cervantes other side',
      city: 'Denver',
      region: 'CO',
      countryCode: 'US',
      timezone: 'America/Denver',
    });

    const coordinator = new CanonicalizationCoordinator(catalogRepo);

    const artistExternalIds = [
      {
        provider: 'spotify',
        externalId: 'spotify-artist-julian-123',
      },
    ];

    // 1. Ingest Early Performance (6:30 PM local = 01:30 UTC next day)
    const earlyCandidate = {
      id: crypto.randomUUID(),
      rawIngestId,
      sourceId: source.id,
      title: 'Acoustic Showcase (Early Show)',
      artistNames: ['Julian Solo'],
      artists: [
        {
          name: 'Julian Solo',
          billingPosition: 'headliner' as const,
          sortOrder: 1,
          externalIds: artistExternalIds,
        },
      ],
      venueName: "Cervantes' Other Side",
      city: 'Denver',
      state: 'CO',
      country: 'US',
      timezone: 'America/Denver',
      localStartDate: '2026-11-20',
      startsAt: '2026-11-21T01:30:00.000Z',
      startTimePrecision: 'instant' as const,
      ticketUrl: 'https://www.etix.com/ticket/p/11111/early-show',
      confidence: 0.98,
      provenance: {
        sourceId: source.id,
        sourceType: 'venue' as const,
        acquisitionMethod: 'html_http' as const,
        sourceUrl: 'https://cervantesmasterpiece.com/events/early',
        contentHash: 'early-content-hash-123',
        fetchedAt: '2026-11-08T00:00:00.000Z',
        parserVersion: '1.0.0',
        confidence: 0.98,
      },
    };

    const earlyOutcome = await coordinator.canonicalize(earlyCandidate);
    expect(earlyOutcome.status).toBe('created');
    const earlyEventId = earlyOutcome.eventId!;

    // 2. Ingest Late Performance on same date & venue for same artist (9:30 PM local = 04:30 UTC next day)
    const lateCandidate = {
      id: crypto.randomUUID(),
      rawIngestId,
      sourceId: source.id,
      title: 'Acoustic Showcase (Late Show)',
      artistNames: ['Julian Solo'],
      artists: [
        {
          name: 'Julian Solo',
          billingPosition: 'headliner' as const,
          sortOrder: 1,
          externalIds: artistExternalIds,
        },
      ],
      venueName: "Cervantes' Other Side",
      city: 'Denver',
      state: 'CO',
      country: 'US',
      timezone: 'America/Denver',
      localStartDate: '2026-11-20',
      startsAt: '2026-11-21T04:30:00.000Z',
      startTimePrecision: 'instant' as const,
      ticketUrl: 'https://www.etix.com/ticket/p/22222/late-show',
      confidence: 0.98,
      provenance: {
        sourceId: source.id,
        sourceType: 'venue' as const,
        acquisitionMethod: 'html_http' as const,
        sourceUrl: 'https://cervantesmasterpiece.com/events/late',
        contentHash: 'late-content-hash-456',
        fetchedAt: '2026-11-08T00:00:00.000Z',
        parserVersion: '1.0.0',
        confidence: 0.98,
      },
    };

    const lateOutcome = await coordinator.canonicalize(lateCandidate);

    // Negative deduplication assertion: Must NOT merge into early show! Must CREATE a separate canonical event.
    expect(lateOutcome.status).toBe('created');
    expect(lateOutcome.eventId).not.toBe(earlyEventId);

    // Both distinct performances must coexist in catalog
    const sameDayEvents = await catalogRepo.findEventsOnDateAtVenue(
      '2026-11-20',
      venue.id,
    );
    expect(sameDayEvents).toHaveLength(2);
  });
});
