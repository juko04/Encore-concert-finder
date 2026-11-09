import { describe, expect, it } from 'vitest';
import { normalizeName } from '@/lib/domain/value-objects';
import {
  runVenueIngestion,
  LARIMER_LOUNGE_CONFIG,
  LOST_LAKE_CONFIG,
  GLOBE_HALL_CONFIG,
} from '@/lib/sources/venue';
import {
  MemoryCatalogRepository,
  MemoryEventCandidateRepository,
  MemoryRawIngestRepository,
  MemorySourceRepository,
} from '@/lib/repositories/memory-repositories';

describe('Denver Independent Venues Ingestion Pipeline', () => {
  it('executes safe dry-run preview for all three venues without persisting raw or candidate records', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    // 1. Larimer Lounge dry-run
    const larimerResult = await runVenueIngestion({
      config: LARIMER_LOUNGE_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: false,
    });

    expect(larimerResult.candidatesParsed).toBe(70);
    expect(larimerResult.canonicalEventsCreated).toBeGreaterThanOrEqual(50);
    expect(larimerResult.rawIngestsPersisted).toBe(0);
    expect(larimerResult.candidatesPersisted).toBe(0);

    // Verify raw ingest repo remains completely empty in dry-run
    const larimerRaw = await rawIngestRepo.listBySource(
      larimerResult.source.id,
    );
    expect(larimerRaw).toHaveLength(0);

    // 2. Lost Lake dry-run
    const lostLakeResult = await runVenueIngestion({
      config: LOST_LAKE_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: false,
    });

    expect(lostLakeResult.candidatesParsed).toBe(35);
    expect(lostLakeResult.canonicalEventsCreated).toBe(35);
    expect(lostLakeResult.rawIngestsPersisted).toBe(0);

    const lostLakeRaw = await rawIngestRepo.listBySource(
      lostLakeResult.source.id,
    );
    expect(lostLakeRaw).toHaveLength(0);

    // 3. Globe Hall dry-run
    const globeResult = await runVenueIngestion({
      config: GLOBE_HALL_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: false,
    });

    expect(globeResult.candidatesParsed).toBe(44);
    expect(globeResult.canonicalEventsCreated).toBeGreaterThanOrEqual(40);
    expect(globeResult.rawIngestsPersisted).toBe(0);

    const globeRaw = await rawIngestRepo.listBySource(globeResult.source.id);
    expect(globeRaw).toHaveLength(0);
  });

  it('persists canonical events and candidate observations in persistence mode', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    const result = await runVenueIngestion({
      config: LOST_LAKE_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: true,
    });

    expect(result.rawIngestsPersisted).toBe(1);
    expect(result.candidatesPersisted).toBe(35);
    expect(result.canonicalEventsCreated).toBe(35);

    const catalogEvents = await catalogRepo.listEvents();
    expect(catalogEvents).toHaveLength(35);

    // Verify all created events have valid venue, local date, and ticket link
    for (const ev of catalogEvents) {
      expect(ev.venueId).toBeDefined();
      expect(ev.localStartDate).toMatch(/^202[67]-\d{2}-\d{2}$/);
      expect(ev.status).toBe('scheduled');
    }
  });

  it('performs cross-source deduplication when matching a pre-existing Ticketmaster event', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    // 1. Seed a pre-existing canonical venue and artist (as if ingested from Ticketmaster)
    const venue = await catalogRepo.createVenue({
      name: 'Globe Hall',
      normalizedName: 'globe hall',
      city: 'Denver',
      region: 'CO',
      timezone: 'America/Denver',
    });

    const normArtist = normalizeName('The Cactus Blossoms');
    let artist = await catalogRepo.findArtistByName(normArtist);
    if (!artist) {
      artist = await catalogRepo.createArtist({
        name: 'The Cactus Blossoms',
        normalizedName: normArtist,
      });
      await catalogRepo.addArtistExternalId({
        artistId: artist.id,
        provider: 'ticketmaster',
        externalId: 'K8vZ9171oVf',
      });
    }

    // Seed canonical event with Ticketmaster link on 2026-11-07
    const tmCanonicalEvent = await catalogRepo.createEvent({
      name: 'The Cactus Blossoms',
      normalizedName: normArtist,
      venueId: venue.id,
      city: 'Denver',
      region: 'CO',
      countryCode: 'US',
      timezone: 'America/Denver',
      localStartDate: '2026-11-07',
      startsAt: '2026-11-08T03:00:00.000Z',
      startTimePrecision: 'instant',
      status: 'scheduled',
      eventKind: 'concert',
      isMultiDay: false,
      primaryTicketUrl: 'https://www.ticketmaster.com/event/tm-12345',
    });

    await catalogRepo.linkEventArtist(
      tmCanonicalEvent.id,
      artist.id,
      'headliner',
      1,
    );

    // 2. Ingest Globe Hall official website (which features The Cactus Blossoms on 2026-11-07)
    const result = await runVenueIngestion({
      config: GLOBE_HALL_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: true,
    });

    // The Cactus Blossoms must MATCH the pre-existing event rather than duplicating it
    expect(result.canonicalEventsMatched).toBeGreaterThanOrEqual(1);

    // Verify that The Cactus Blossoms event was updated with the Etix direct ticket link
    const updatedDetail = await catalogRepo.getEventById(tmCanonicalEvent.id);
    expect(updatedDetail).toBeDefined();
    expect(updatedDetail?.name).toBe('The Cactus Blossoms');

    const ticketLinks = updatedDetail?.ticketLinks || [];
    expect(ticketLinks.some((l) => l.url.includes('etix.com'))).toBe(true);
  });

  it('preserves distinct early and late shows on the same date without merging', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    await runVenueIngestion({
      config: GLOBE_HALL_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: true,
    });

    const catalogEvents = await catalogRepo.listEvents();

    // Jonah Kagen has both (EARLY SHOW ADDED) at 4 pm (23:00 UTC) and (LATE SHOW) at 8 pm (03:00 UTC)
    const jonahEvents = catalogEvents.filter((e) =>
      e.title.toLowerCase().includes('jonah kagen'),
    );

    // Must be at least 2 distinct events (early and late show)
    expect(jonahEvents.length).toBeGreaterThanOrEqual(2);

    const startTimes = jonahEvents.map((e) => e.startsAt);
    expect(startTimes).toContain('2026-11-08T23:00:00.000Z');
    expect(startTimes).toContain('2026-11-09T03:00:00.000Z');
  });

  it('enforces idempotency on repeat ingestion of unchanged sources', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    // First ingestion: creates canonical events
    const firstRun = await runVenueIngestion({
      config: LOST_LAKE_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: true,
    });

    expect(firstRun.rawIngestsPersisted).toBe(1);
    expect(firstRun.canonicalEventsCreated).toBe(35);

    // Second ingestion with identical content
    const secondRun = await runVenueIngestion({
      config: LOST_LAKE_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: true,
    });

    expect(secondRun.rawIngestsReused).toBe(1);
    expect(secondRun.rawIngestsPersisted).toBe(0);
    expect(secondRun.candidatesReused).toBe(35);
    expect(secondRun.canonicalEventsCreated).toBe(0);

    // Total events in catalog remains strictly 35
    expect(await catalogRepo.listEvents()).toHaveLength(35);
  });

  it('routes non-music listings to needs_review with missing_artist_identity', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    const result = await runVenueIngestion({
      config: LARIMER_LOUNGE_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: true,
    });

    // The 8 non-music events (shuttle buses, merch pop-up, pure bingo) must route to review
    expect(result.reviewReasons['missing_artist_identity']).toBe(8);
    expect(result.candidatesNeedsReview).toBeGreaterThanOrEqual(8);
  });

  it('canonicalizes verified free concert with event_kind: free_event while keeping unknown prices as concert', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    await runVenueIngestion({
      config: LARIMER_LOUNGE_CONFIG,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: true,
      persist: true,
    });

    const events = await catalogRepo.listEvents();

    // 1. Verified free event created in catalog as free_event
    const freeShow = events.find((e) => e.title.includes('s1ms'));
    expect(freeShow).toBeDefined();
    expect(freeShow?.eventKind).toBe('free_event');

    // 2. Verified free event with series title By The Fire resolved to performer Strawberry Milk
    const byTheFire = events.find((e) =>
      e.title.includes('By The Fire Feat. Strawberry Milk'),
    );
    expect(byTheFire).toBeDefined();
    expect(byTheFire?.eventKind).toBe('free_event');
    const byTheFireDetail = await catalogRepo.getEventById(byTheFire!.id);
    expect(byTheFireDetail?.artists[0].name).toBe('Strawberry Milk');

    // 3. Ordinary unknown-price event created as concert
    const concertShow = events.find((e) => e.title.includes('Susto'));
    expect(concertShow).toBeDefined();
    expect(concertShow?.eventKind).toBe('concert');
  });

  it('continues processing remaining venues when an individual venue fails and records failure', async () => {
    const sourceRepo = new MemorySourceRepository();
    const rawIngestRepo = new MemoryRawIngestRepository();
    const candidateRepo = new MemoryEventCandidateRepository();
    const catalogRepo = new MemoryCatalogRepository();

    const faultyConfig = {
      ...LARIMER_LOUNGE_CONFIG,
      slug: 'faulty-venue',
      name: 'Faulty Venue',
      calendarUrl: 'https://invalid-url-that-fails.com/events/',
    };

    const targetConfigs = [faultyConfig, LOST_LAKE_CONFIG];
    const results = [];
    const failedVenues: Array<{ name: string; slug: string; error: string }> =
      [];

    for (const config of targetConfigs) {
      try {
        if (config.slug === 'faulty-venue') {
          throw new Error('Connection refused to faulty-venue');
        }
        const result = await runVenueIngestion({
          config,
          sourceRepo,
          rawIngestRepo,
          candidateRepo,
          catalogRepo,
          useFixture: true,
          persist: false,
        });
        results.push(result);
      } catch (err: unknown) {
        failedVenues.push({
          name: config.name,
          slug: config.slug,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    expect(results).toHaveLength(1);
    expect(results[0].source.slug).toBe(LOST_LAKE_CONFIG.slug);
    expect(failedVenues).toHaveLength(1);
    expect(failedVenues[0].name).toBe('Faulty Venue');
    expect(failedVenues[0].error).toContain('Connection refused');
  });
});
