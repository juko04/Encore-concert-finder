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

    // Verify that NO partial records were committed
    expect(catalogRepo.events.size).toBe(0);
    expect(catalogRepo.eventArtists.size).toBe(0);
    expect(catalogRepo.eventTicketLinks.size).toBe(0);
    expect(catalogRepo.eventSources.size).toBe(0);
    expect(catalogRepo.eventFieldEvidence.size).toBe(0);
    expect(catalogRepo.candidateResolutions.size).toBe(0);
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
});
