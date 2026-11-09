import { describe, expect, it } from 'vitest';
import { normalizeName } from '@/lib/domain/value-objects';
import {
  runVenueIngestion,
  VELVET_ELK_CONFIG,
  ROOTS_MUSIC_PROJECT_CONFIG,
} from '@/lib/sources/venue';
import {
  MemoryCatalogRepository,
  MemoryEventCandidateRepository,
  MemoryRawIngestRepository,
  MemorySourceRepository,
} from '@/lib/repositories/memory-repositories';

describe('Boulder Independent Venues Ingestion Pipeline', () => {
  it('executes safe dry-run preview for both venues without persisting raw or candidate records', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    // 1. Velvet Elk Lounge dry-run
    const velvetResult = await runVenueIngestion({
      config: VELVET_ELK_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: false,
    });

    expect(velvetResult.candidatesParsed).toBe(6);
    expect(velvetResult.canonicalEventsCreated).toBe(5);
    expect(velvetResult.rawIngestsPersisted).toBe(0);
    expect(velvetResult.candidatesPersisted).toBe(0);

    const velvetRaw = await rawIngestRepo.listBySource(velvetResult.source.id);
    expect(velvetRaw).toHaveLength(0);

    // 2. Roots Music Project dry-run
    const rootsResult = await runVenueIngestion({
      config: ROOTS_MUSIC_PROJECT_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: false,
    });

    expect(rootsResult.candidatesParsed).toBe(12);
    expect(rootsResult.canonicalEventsCreated).toBe(10);
    expect(rootsResult.rawIngestsPersisted).toBe(0);
    expect(rootsResult.candidatesPersisted).toBe(0);

    const rootsRaw = await rawIngestRepo.listBySource(rootsResult.source.id);
    expect(rootsRaw).toHaveLength(0);
  });

  it('persists Velvet Elk Lounge events and performs idempotent repeat ingestion', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    // First persistent run
    const firstRun = await runVenueIngestion({
      config: VELVET_ELK_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: true,
    });

    expect(firstRun.rawIngestsPersisted).toBe(1);
    expect(firstRun.candidatesPersisted).toBe(6);
    expect(firstRun.canonicalEventsCreated).toBe(5);
    expect(firstRun.candidatesNeedsReview).toBe(1); // Happy Hour

    // Verify canonical events in catalog
    const catalogEvents = await catalogRepo.listEvents();
    expect(catalogEvents).toHaveLength(5);

    // Verify venue attribution
    const venue = await catalogRepo.findVenueByNameAndCity(
      normalizeName('Velvet Elk Lounge'),
      'Boulder',
    );
    expect(venue).toBeDefined();
    expect(venue?.city).toBe('Boulder');
    expect(venue?.region).toBe('CO');

    // Second persistent run (idempotency check)
    const secondRun = await runVenueIngestion({
      config: VELVET_ELK_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: true,
    });

    expect(secondRun.rawIngestsPersisted).toBe(0);
    expect(secondRun.rawIngestsReused).toBe(1);
    expect(secondRun.candidatesPersisted).toBe(0);
    expect(secondRun.candidatesReused).toBe(6);
    expect(secondRun.canonicalEventsCreated).toBe(0);

    // Total events in catalog remains strictly 5
    expect(await catalogRepo.listEvents()).toHaveLength(5);
  });

  it('persists Roots Music Project events, verifies free admission, and maintains idempotency', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    // First persistent run
    const firstRun = await runVenueIngestion({
      config: ROOTS_MUSIC_PROJECT_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: true,
    });

    expect(firstRun.rawIngestsPersisted).toBe(1);
    expect(firstRun.candidatesPersisted).toBe(12);
    expect(firstRun.canonicalEventsCreated).toBe(10);
    expect(firstRun.candidatesNeedsReview).toBe(2); // Marketing workshop + art show

    // Verify venue attribution
    const venue = await catalogRepo.findVenueByNameAndCity(
      normalizeName('Roots Music Project'),
      'Boulder',
    );
    expect(venue).toBeDefined();
    expect(venue?.city).toBe('Boulder');

    // Verify verified free admission concert persisted as free_event
    const catalogEvents = await catalogRepo.listEvents();
    expect(catalogEvents).toHaveLength(10);
    const freeEvent = catalogEvents.find((e) =>
      e.title.toLowerCase().includes('open decks'),
    );
    expect(freeEvent).toBeDefined();
    expect(freeEvent?.eventKind).toBe('free_event');

    // Second persistent run (idempotency check)
    const secondRun = await runVenueIngestion({
      config: ROOTS_MUSIC_PROJECT_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: true,
    });

    expect(secondRun.rawIngestsPersisted).toBe(0);
    expect(secondRun.rawIngestsReused).toBe(1);
    expect(secondRun.candidatesPersisted).toBe(0);
    expect(secondRun.candidatesReused).toBe(12);
    expect(secondRun.canonicalEventsCreated).toBe(0);

    // Total events in catalog remains strictly 10
    expect(await catalogRepo.listEvents()).toHaveLength(10);
  });

  it('matches pre-existing canonical events from other sources without creating duplicates', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    // 1. Seed existing canonical venue and artist
    const venue = await catalogRepo.createVenue({
      name: 'Velvet Elk Lounge',
      normalizedName: normalizeName('Velvet Elk Lounge'),
      city: 'Boulder',
      region: 'CO',
      countryCode: 'US',
      timezone: 'America/Denver',
    });

    const artist = await catalogRepo.createArtist({
      name: 'Peach Rat',
      normalizedName: normalizeName('Peach Rat'),
    });

    // 2. Pre-seed event for Peach Rat on 2026-11-15 from an aggregator
    const preExistingEvent = await catalogRepo.createEvent({
      name: 'Peach Rat Live at Velvet Elk',
      normalizedName: normalizeName('Peach Rat'),
      venueId: venue.id,
      city: 'Boulder',
      region: 'CO',
      countryCode: 'US',
      timezone: 'America/Denver',
      localStartDate: '2026-11-15',
      startTimePrecision: 'date_only',
      status: 'scheduled',
      eventKind: 'concert',
      isMultiDay: false,
      primaryTicketUrl: 'https://example.com/peach-rat-boulder',
    });

    await catalogRepo.linkEventArtist(
      preExistingEvent.id,
      artist.id,
      'headliner',
      1,
    );

    // Verify initial count is 1
    const beforeEvents = await catalogRepo.listEvents();
    expect(beforeEvents).toHaveLength(1);

    // 3. Ingest Velvet Elk Lounge
    const ingestResult = await runVenueIngestion({
      config: VELVET_ELK_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: true,
    });

    // Peach Rat matched existing event, other 4 concerts created new events
    expect(ingestResult.canonicalEventsMatched).toBe(1);
    expect(ingestResult.canonicalEventsCreated).toBe(4);

    // Total events should now be 5 (not 6)
    const afterEvents = await catalogRepo.listEvents();
    expect(afterEvents).toHaveLength(5);
  });

  it('properly preserves cancellation status on cancelled events', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    await runVenueIngestion({
      config: VELVET_ELK_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: true,
    });

    const catalogEvents = await catalogRepo.listEvents();
    const robertEllis = catalogEvents.find((e) =>
      e.title.includes('Robert Ellis'),
    );
    expect(robertEllis).toBeDefined();
    expect(robertEllis?.status).toBe('cancelled');
  });
});
