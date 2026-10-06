import { beforeEach, describe, expect, it } from 'vitest';
import { CanonicalizationCoordinator } from '@/lib/entity-resolution/canonicalization-coordinator';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';
import { loadFixtures } from '../fixtures/fixture-helper';

describe('CanonicalizationCoordinator Unit Tests', () => {
  let catalogRepo: MemoryCatalogRepository;
  let coordinator: CanonicalizationCoordinator;
  const fixtures = loadFixtures();

  beforeEach(() => {
    catalogRepo = new MemoryCatalogRepository();
    coordinator = new CanonicalizationCoordinator(catalogRepo);
  });

  it('atomically creates canonical event, artists, ticket links, provenance, and resolution (Finding 2)', async () => {
    const candidate = fixtures.single_show;
    const result = await coordinator.canonicalize(candidate);

    expect(result.status).toBe('created');
    expect(result.eventId).toBeDefined();

    // Verify all parts were persisted
    const event = await catalogRepo.getEventById(result.eventId!);
    expect(event).toBeDefined();
    expect(event?.name).toBe(candidate.title);
    expect(event?.artists.length).toBe(1);
    expect(event?.ticketLinks.length).toBe(1);
    expect(event?.sources.length).toBe(1);
    expect(catalogRepo.candidateResolutions.size).toBe(1);
    expect(catalogRepo.eventFieldEvidence.size).toBeGreaterThan(0);
  });

  it('guarantees atomic rollback when persistence throws an error (Finding 2)', async () => {
    // Force an error during applyCanonicalization
    const originalApply = catalogRepo.applyCanonicalization.bind(catalogRepo);
    catalogRepo.applyCanonicalization = async () => {
      throw new Error('Simulated database write failure');
    };

    const candidate = fixtures.single_show;
    await expect(coordinator.canonicalize(candidate)).rejects.toThrow(
      'Simulated database write failure',
    );

    // Verify that NO partial records were committed (including zero upfront venue or artist writes)
    expect(catalogRepo.events.size).toBe(0);
    expect(catalogRepo.venues.size).toBe(0);
    expect(catalogRepo.artists.size).toBe(0);
    expect(catalogRepo.eventArtists.size).toBe(0);
    expect(catalogRepo.eventTicketLinks.size).toBe(0);
    expect(catalogRepo.eventSources.size).toBe(0);
    expect(catalogRepo.eventFieldEvidence.size).toBe(0);
    expect(catalogRepo.candidateResolutions.size).toBe(0);
  });

  it('correctly replays and updates an existing canonical event on subsequent ingest (Finding 7)', async () => {
    const candidate1 = {
      ...fixtures.single_show,
      sourceEventId: 'upstream_evt_456',
      price: { min: 45, max: 80, currency: 'USD' },
    };
    const res1 = await coordinator.canonicalize(candidate1);
    expect(res1.status).toBe('created');
    expect(res1.eventId).toBeDefined();

    // Second ingest: same source and sourceEventId, but price increased to 50-95
    const candidate2 = {
      ...fixtures.single_show,
      sourceEventId: 'upstream_evt_456',
      price: { min: 50, max: 95, currency: 'USD' },
    };
    const res2 = await coordinator.canonicalize(candidate2);
    expect(res2.status).toBe('matched');
    expect(res2.eventId).toBe(res1.eventId);

    // Only ONE event exists in repository
    expect(catalogRepo.events.size).toBe(1);

    // Ticket link updated with new price
    const event = await catalogRepo.getEventById(res1.eventId!);
    expect(event?.ticketLinks[0].minPrice).toBe(50);
    expect(event?.ticketLinks[0].maxPrice).toBe(95);
  });

  it('routes candidate to needs_review when artist name is ambiguous across multiple entities (Finding 5)', async () => {
    // Pre-create two distinct artists with the same normalized name
    await catalogRepo.createArtist({
      name: 'Ghost (Swedish Metal)',
      normalizedName: 'ghost',
    });
    await catalogRepo.createArtist({
      name: 'Ghost (Japanese Psych Rock)',
      normalizedName: 'ghost',
    });

    const ambiguousCandidate = {
      ...fixtures.single_show,
      artistNames: ['Ghost'],
      title: 'Ghost Live in Concert',
    };

    const res = await coordinator.canonicalize(ambiguousCandidate);
    expect(res.status).toBe('needs_review');
    expect(res.eventId).toBeNull();
    expect(res.reasons).toContain('ambiguous_artist_identity');
    expect(catalogRepo.events.size).toBe(0);
  });

  it('does not fabricate Colorado geography for non-Colorado events (Finding 3)', async () => {
    // Austin show: Texas, America/Chicago
    const austinCandidate = fixtures.non_colorado_show_austin;
    const austinRes = await coordinator.canonicalize(austinCandidate);
    expect(austinRes.status).toBe('created');

    const austinEvent = await catalogRepo.getEventById(austinRes.eventId!);
    expect(austinEvent?.city).toBe('Austin');
    expect(austinEvent?.region).toBe('TX');
    expect(austinEvent?.timezone).toBe('America/Chicago');
    expect(austinEvent?.city).not.toBe('Denver');
    expect(austinEvent?.timezone).not.toBe('America/Denver');

    // London show: Great Britain, Europe/London, GBP currency
    const londonCandidate = fixtures.non_colorado_show_london_eur_gbp;
    const londonRes = await coordinator.canonicalize(londonCandidate);
    expect(londonRes.status).toBe('created');

    const londonEvent = await catalogRepo.getEventById(londonRes.eventId!);
    expect(londonEvent?.city).toBe('London');
    expect(londonEvent?.countryCode).toBe('GB');
    expect(londonEvent?.timezone).toBe('Europe/London');
    expect(londonEvent?.ticketLinks[0].currency).toBe('GBP');
  });

  it('routes candidate to needs_review when timezone cannot be resolved (Finding 3)', async () => {
    const candidateMissingTz = {
      ...fixtures.single_show,
      timezone: undefined,
      venueName: 'Venue Without Timezone',
    };

    const res = await coordinator.canonicalize(candidateMissingTz);
    expect(res.status).toBe('needs_review');
    expect(res.eventId).toBeNull();
    expect(res.reasons).toContain('missing_or_invalid_timezone');
  });

  it('derives local calendar date correctly across UTC date rollover (Finding 4)', async () => {
    // UTC 02:00:00 on Oct 15 in America/Denver is 20:00:00 on Oct 14
    const rolloverCandidate = fixtures.utc_rollover_show;
    const res = await coordinator.canonicalize(rolloverCandidate);

    expect(res.status).toBe('created');
    const event = await catalogRepo.getEventById(res.eventId!);
    expect(event?.localStartDate).toBe('2026-10-14');
  });

  it('preserves real source provenance and attribution (Finding 5 & 8)', async () => {
    // Venue source candidate: ticketProviderSourceId should be null
    const venueCandidate = fixtures.single_show;
    const venueRes = await coordinator.canonicalize(venueCandidate);
    const venueEvent = await catalogRepo.getEventById(venueRes.eventId!);

    expect(venueEvent?.ticketLinks[0].ticketProviderSourceId).toBeNull();
    expect(venueEvent?.sources[0].sourceId).toBe(
      venueCandidate.provenance.sourceId,
    );

    // Ticketing source candidate: ticketProviderSourceId should be candidate.sourceId
    const ticketingCandidate = fixtures.non_colorado_show_london_eur_gbp;
    const ticketRes = await coordinator.canonicalize(ticketingCandidate);
    const ticketEvent = await catalogRepo.getEventById(ticketRes.eventId!);

    expect(ticketEvent?.ticketLinks[0].ticketProviderSourceId).toBe(
      ticketingCandidate.sourceId,
    );
  });

  it('filters catalog events by artistId (Finding 11)', async () => {
    const candidate1 = fixtures.single_show; // Khruangbin
    const res1 = await coordinator.canonicalize(candidate1);
    const event1 = await catalogRepo.getEventById(res1.eventId!);
    const khruangbinId = event1!.artists[0].id;

    const candidate2 = fixtures.non_colorado_show_austin; // Spoon
    await coordinator.canonicalize(candidate2);

    // Filter by Khruangbin ID
    const khruangbinEvents = await catalogRepo.listEvents({
      artistId: khruangbinId,
    });
    expect(khruangbinEvents.length).toBe(1);
    expect(khruangbinEvents[0].id).toBe(event1?.id);

    // Filter by non-existent artist ID
    const noEvents = await catalogRepo.listEvents({
      artistId: 'non-existent-artist',
    });
    expect(noEvents.length).toBe(0);
  });

  it('guarantees all persisted entities use valid UUID identifiers (Invariant 1)', async () => {
    const candidate = fixtures.single_show;
    const res = await coordinator.canonicalize(candidate);
    expect(res.status).toBe('created');

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const event = await catalogRepo.getEventById(res.eventId!);
    expect(event?.id).toMatch(uuidRegex);
    expect(event?.venueId).toMatch(uuidRegex);
    expect(event?.artists[0].id).toMatch(uuidRegex);
    expect(event?.ticketLinks[0].id).toMatch(uuidRegex);
    expect(event?.sources[0].sourceId).toMatch(uuidRegex);

    for (const fe of catalogRepo.eventFieldEvidence.values()) {
      expect(fe.id).toMatch(uuidRegex);
      expect(fe.eventId).toMatch(uuidRegex);
    }

    for (const cr of catalogRepo.candidateResolutions.values()) {
      expect(cr.id).toMatch(uuidRegex);
      expect(cr.eventId).toMatch(uuidRegex);
    }
  });

  it('preserves non-concert eventKind through canonicalization (Invariant 5)', async () => {
    const clubShowCandidate = {
      ...fixtures.single_show,
      title: 'Late Night Club Showcase',
      eventKind: 'club_show' as const,
      isFestival: false,
    };

    const res = await coordinator.canonicalize(clubShowCandidate);
    expect(res.status).toBe('created');

    const event = await catalogRepo.getEventById(res.eventId!);
    expect(event?.eventKind).toBe('club_show');
  });

  it('enforces candidate observation immutability across repeated ingestion (Invariant 3)', async () => {
    const { MemoryEventCandidateRepository } =
      await import('@/lib/repositories/memory-repositories');
    const candidateRepo = new MemoryEventCandidateRepository();

    const candidate1 = {
      ...fixtures.single_show,
      sourceEventId: 'upstream_obs_123',
      rawIngestId: '00000000-0000-0000-0000-000000000001',
      sourceId: 'a0000000-0000-0000-0000-000000000001',
    };

    const record1 = await candidateRepo.create(candidate1);
    expect(record1.id).toBeDefined();

    // Second observation (e.g. crawl run next day with new rawIngestId)
    const candidate2 = {
      ...fixtures.single_show,
      sourceEventId: 'upstream_obs_123',
      rawIngestId: '00000000-0000-0000-0000-000000000002',
      sourceId: 'a0000000-0000-0000-0000-000000000001',
      title: 'Khruangbin at Red Rocks (Updated Title)',
    };

    const record2 = await candidateRepo.create(candidate2);
    expect(record2.id).toBeDefined();

    // Must be two distinct candidate rows, not overwritten!
    expect(record1.id).not.toBe(record2.id);
    const fetched1 = await candidateRepo.getById(record1.id);
    const fetched2 = await candidateRepo.getById(record2.id);
    expect(fetched1?.title).toBe('Khruangbin at Red Rocks');
    expect(fetched2?.title).toBe('Khruangbin at Red Rocks (Updated Title)');
  });

  it('rejects mapping an upstream source_event_id to multiple canonical events (Invariant 4)', async () => {
    const sourceId = 'a0000000-0000-0000-0000-000000000001';
    const upstreamEventId = 'ticketmaster_ev_999';

    // Link upstream event to event 1
    await catalogRepo.recordEventSource({
      eventId: '11111111-1111-1111-1111-111111111111',
      sourceId,
      sourceEventId: upstreamEventId,
      sourceUrl: 'https://tm.com/event/999',
      confidence: 0.9,
    });

    // Attempting to link the SAME upstream identity to event 2 must be rejected
    await expect(
      catalogRepo.recordEventSource({
        eventId: '22222222-2222-2222-2222-222222222222',
        sourceId,
        sourceEventId: upstreamEventId,
        sourceUrl: 'https://tm.com/event/999',
        confidence: 0.9,
      }),
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  });

  it('routes to needs_review when candidate artist matches existing artist by name alone without external IDs (Invariant 7)', async () => {
    // Pre-seed an existing artist named "Ghost"
    await catalogRepo.createArtist({
      name: 'Ghost',
      normalizedName: 'ghost',
    });

    // Incoming candidate has artist "Ghost" but NO external ID disambiguation
    const candidate = {
      ...fixtures.single_show,
      title: 'Ghost Live',
      artistNames: ['Ghost'],
      artists: [{ name: 'Ghost' }],
    };

    const res = await coordinator.canonicalize(candidate);
    expect(res.status).toBe('needs_review');
    expect(res.eventId).toBeNull();
    expect(res.reasons).toContain('ambiguous_artist_identity');
  });

  it('rejects candidate entering canonicalization without valid persisted UUID IDs (Point 6)', async () => {
    // Missing id
    const candidateNoId = {
      ...fixtures.single_show,
      id: undefined as unknown as string,
    };
    await expect(coordinator.canonicalize(candidateNoId)).rejects.toThrow(
      /Candidate must be persisted with valid UUID/,
    );

    // Non-UUID string
    const candidateInvalidId = {
      ...fixtures.single_show,
      id: 'candidate_custom_string',
    };
    await expect(coordinator.canonicalize(candidateInvalidId)).rejects.toThrow(
      /Candidate must be persisted with valid UUID/,
    );
  });

  it('safely routes candidate with missing or empty venue locality to needs_review (Point 9)', async () => {
    const candidateEmptyCity = {
      ...fixtures.single_show,
      city: '   ',
    };
    const res = await coordinator.canonicalize(candidateEmptyCity);
    expect(res.status).toBe('needs_review');
    expect(res.eventId).toBeNull();
    expect(res.reasons).toContain('missing_venue_locality');

    // Verify zero venues created with empty string
    expect(catalogRepo.venues.size).toBe(0);
  });

  describe('Candidate Identity Model (Point 5)', () => {
    it('satisfies all 4 candidate identity and replay invariants', async () => {
      const { MemoryEventCandidateRepository } =
        await import('@/lib/repositories/memory-repositories');
      const candRepo = new MemoryEventCandidateRepository();

      const rawIngestId1 = '00000000-0000-0000-0000-000000000001';
      const rawIngestId2 = '00000000-0000-0000-0000-000000000002';
      const sourceId = 'a0000000-0000-0000-0000-000000000001';

      // Case 1: same raw observation + same extracted event -> no duplicate candidate
      const candA1 = await candRepo.create({
        ...fixtures.single_show,
        rawIngestId: rawIngestId1,
        sourceId,
        sourceEventId: 'event_alpha',
        title: 'Event Alpha',
      });
      const candA1Replay = await candRepo.create({
        ...fixtures.single_show,
        rawIngestId: rawIngestId1,
        sourceId,
        sourceEventId: 'event_alpha',
        title: 'Event Alpha',
      });
      expect(candA1Replay.id).toBe(candA1.id);

      // Case 2: same raw observation + different extracted event -> separate candidates
      const candB1 = await candRepo.create({
        ...fixtures.single_show,
        rawIngestId: rawIngestId1,
        sourceId,
        sourceEventId: 'event_beta',
        title: 'Event Beta',
      });
      expect(candB1.id).not.toBe(candA1.id);

      // Case 3: new raw observation + same source_event_id -> new immutable candidate
      const candA2 = await candRepo.create({
        ...fixtures.single_show,
        rawIngestId: rawIngestId2,
        sourceId,
        sourceEventId: 'event_alpha',
        title: 'Event Alpha (Rescheduled)',
      });
      expect(candA2.id).not.toBe(candA1.id);

      // Case 4: those candidates -> resolve to same canonical event
      const resA1 = await coordinator.canonicalize(candA1);
      expect(resA1.status).toBe('created');
      const resA2 = await coordinator.canonicalize(candA2);
      expect(resA2.status).toBe('matched');
      expect(resA2.eventId).toBe(resA1.eventId);
    });

    it('obeys candidate-identity semantics and idempotency on createMany batch replay (Issue 5)', async () => {
      const { MemoryEventCandidateRepository } =
        await import('@/lib/repositories/memory-repositories');
      const candRepo = new MemoryEventCandidateRepository();

      const rawIngestId = '00000000-0000-0000-0000-000000000010';
      const sourceId = 'a0000000-0000-0000-0000-000000000001';

      const batch = [
        {
          ...fixtures.single_show,
          rawIngestId,
          sourceId,
          sourceEventId: 'batch_ev_1',
          title: 'Batch Event 1',
        },
        {
          ...fixtures.single_show,
          rawIngestId,
          sourceId,
          sourceEventId: 'batch_ev_2',
          title: 'Batch Event 2',
        },
      ];

      // First execution
      const firstRun = await candRepo.createMany(batch);
      expect(firstRun.length).toBe(2);
      expect(firstRun[0].id).not.toBe(firstRun[1].id);

      // Replay identical batch
      const secondRun = await candRepo.createMany(batch);
      expect(secondRun.length).toBe(2);

      // Candidate IDs must remain stable and identical (idempotent, no duplicates)
      expect(secondRun[0].id).toBe(firstRun[0].id);
      expect(secondRun[1].id).toBe(firstRun[1].id);

      const allInRaw = await candRepo.getByRawIngestId(rawIngestId);
      expect(allInRaw.length).toBe(2);
    });
  });
});
