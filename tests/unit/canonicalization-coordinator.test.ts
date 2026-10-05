import { describe, expect, it } from 'vitest';
import { CanonicalizationCoordinator } from '@/lib/entity-resolution/canonicalization-coordinator';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';
import { getFixtureCandidate } from '@/tests/fixtures/fixture-helper';

describe('CanonicalizationCoordinator (Pipeline unit tests)', () => {
  it('creates canonical event, artist, venue, ticket link, and source evidence for a single show', async () => {
    const catalogRepo = new MemoryCatalogRepository();
    const coordinator = new CanonicalizationCoordinator();

    const candidate = getFixtureCandidate('singleShow');
    const resolution = await coordinator.canonicalize({
      candidate,
      catalogRepo,
    });

    expect(resolution.status).toBe('created');
    expect(resolution.eventId).toBeDefined();

    const event = await catalogRepo.getEventById(resolution.eventId!);
    expect(event).not.toBeNull();
    expect(event?.name).toBe('The Mountain Goats');
    expect(event?.venue?.name).toBe('Gothic Theatre');
    expect(event?.artists.map((a) => a.name)).toContain('The Mountain Goats');
    expect(event?.artists.map((a) => a.name)).toContain('Adeem the Artist');
    expect(event?.startTimePrecision).toBe('instant');
    expect(event?.startsAt).toBe('2026-10-16T02:00:00Z');
    expect(event?.ticketLinks.length).toBe(1);
    expect(event?.sources.length).toBe(1);

    // Verify field evidence
    const evidenceList = Array.from(catalogRepo.eventFieldEvidence.values());
    expect(evidenceList.length).toBeGreaterThanOrEqual(2);
    expect(evidenceList.some((e) => e.fieldName === 'title')).toBe(true);
    expect(evidenceList.some((e) => e.fieldName === 'local_start_date')).toBe(
      true,
    );
  });

  it('correctly handles date-only events without fabricating midnight instants', async () => {
    const catalogRepo = new MemoryCatalogRepository();
    const coordinator = new CanonicalizationCoordinator();

    const candidate = getFixtureCandidate('dateOnlyEvent');
    const resolution = await coordinator.canonicalize({
      candidate,
      catalogRepo,
    });

    expect(resolution.status).toBe('created');
    const event = await catalogRepo.getEventById(resolution.eventId!);
    expect(event?.startTimePrecision).toBe('date_only');
    expect(event?.startsAt).toBeNull();
    expect(event?.localStartDate).toBe('2026-10-20');
  });

  it('upgrades date-only precision to instant when second source provides exact time', async () => {
    const catalogRepo = new MemoryCatalogRepository();
    const coordinator = new CanonicalizationCoordinator();

    // 1. Initial date-only observation
    const initialCandidate = getFixtureCandidate('dateOnlyEvent');
    const initialRes = await coordinator.canonicalize({
      candidate: initialCandidate,
      catalogRepo,
    });
    expect(initialRes.status).toBe('created');

    // 2. Second source observation with venue alias and instant time
    const upgradeCandidate = getFixtureCandidate('dateOnlyUpgrade');
    const upgradeRes = await coordinator.canonicalize({
      candidate: upgradeCandidate,
      catalogRepo,
    });

    expect(upgradeRes.status).toBe('matched');
    expect(upgradeRes.eventId).toBe(initialRes.eventId);

    const event = await catalogRepo.getEventById(initialRes.eventId!);
    expect(event?.startTimePrecision).toBe('instant');
    expect(event?.startsAt).toBe('2026-10-21T01:30:00Z');
    expect(event?.sources.length).toBe(2);

    // Verify field evidence was recorded for the upgrade
    const evidence = Array.from(catalogRepo.eventFieldEvidence.values());
    expect(evidence.some((e) => e.fieldName === 'starts_at')).toBe(true);
  });

  it('merges two different sources observing the same event into one canonical event', async () => {
    const catalogRepo = new MemoryCatalogRepository();
    const coordinator = new CanonicalizationCoordinator();

    const candidateA = getFixtureCandidate('twoSourcesSameEvent', 'sourceA');
    const candidateB = getFixtureCandidate('twoSourcesSameEvent', 'sourceB');

    const resA = await coordinator.canonicalize({
      candidate: candidateA,
      catalogRepo,
    });
    expect(resA.status).toBe('created');

    const resB = await coordinator.canonicalize({
      candidate: candidateB,
      catalogRepo,
    });
    expect(resB.status).toBe('matched');
    expect(resB.eventId).toBe(resA.eventId);

    // Both artists from both sources linked
    const event = await catalogRepo.getEventById(resA.eventId!);
    const artistNames = event?.artists.map((a) => a.name);
    expect(artistNames).toContain('Khruangbin');
    expect(artistNames).toContain('Hermanos Gutiérrez');
    expect(event?.sources.length).toBe(2);
  });

  it('keeps two consecutive residency nights as separate canonical events', async () => {
    const catalogRepo = new MemoryCatalogRepository();
    const coordinator = new CanonicalizationCoordinator();

    const night1Candidate = getFixtureCandidate('twoDayResidency', 'night1');
    const night2Candidate = getFixtureCandidate('twoDayResidency', 'night2');

    const res1 = await coordinator.canonicalize({
      candidate: night1Candidate,
      catalogRepo,
    });
    const res2 = await coordinator.canonicalize({
      candidate: night2Candidate,
      catalogRepo,
    });

    expect(res1.status).toBe('created');
    expect(res2.status).toBe('created');
    expect(res1.eventId).not.toBe(res2.eventId);

    const allEvents = await catalogRepo.listEvents();
    expect(allEvents.length).toBe(2);
    expect(allEvents[0].localStartDate).not.toBe(allEvents[1].localStartDate);
  });

  it('updates canonical event status to cancelled without deleting the record', async () => {
    const catalogRepo = new MemoryCatalogRepository();
    const coordinator = new CanonicalizationCoordinator();

    const original = getFixtureCandidate('cancellationObservation', 'original');
    const cancelObs = getFixtureCandidate(
      'cancellationObservation',
      'cancellation',
    );

    const initialRes = await coordinator.canonicalize({
      candidate: original,
      catalogRepo,
    });
    expect(initialRes.status).toBe('created');

    const cancelRes = await coordinator.canonicalize({
      candidate: cancelObs,
      catalogRepo,
    });
    expect(cancelRes.status).toBe('matched');
    expect(cancelRes.eventId).toBe(initialRes.eventId);

    const event = await catalogRepo.getEventById(initialRes.eventId!);
    expect(event?.status).toBe('cancelled');
  });

  it('routes ambiguous events (same date and venue, conflicting artists) to needs_review', async () => {
    const catalogRepo = new MemoryCatalogRepository();
    const coordinator = new CanonicalizationCoordinator();

    const candA = getFixtureCandidate('ambiguousCase', 'candidateA');
    const candB = getFixtureCandidate('ambiguousCase', 'candidateB');

    const resA = await coordinator.canonicalize({
      candidate: candA,
      catalogRepo,
    });
    expect(resA.status).toBe('created');

    const resB = await coordinator.canonicalize({
      candidate: candB,
      catalogRepo,
    });
    expect(resB.status).toBe('needs_review');
    expect(resB.eventId).toBeNull();
    expect(resB.reasons).toContain('same_venue_and_date_different_artists');

    // Canonical event A remains untouched and unpolluted
    const event = await catalogRepo.getEventById(resA.eventId!);
    expect(event?.artists.map((a) => a.name)).toEqual([
      'Band Alpha',
      'Band Beta',
    ]);
  });

  it('is completely idempotent when replaying the same candidate', async () => {
    const catalogRepo = new MemoryCatalogRepository();
    const coordinator = new CanonicalizationCoordinator();

    const candidate = getFixtureCandidate('singleShow');

    // Run 1
    const res1 = await coordinator.canonicalize({
      candidate,
      catalogRepo,
    });
    expect(res1.status).toBe('created');

    // Run 2 (Replay)
    const res2 = await coordinator.canonicalize({
      candidate,
      catalogRepo,
    });
    expect(res2.status).toBe('created');
    expect(res2.id).toBe(res1.id);
    expect(res2.eventId).toBe(res1.eventId);

    // Verify no duplicates
    const allEvents = await catalogRepo.listEvents();
    expect(allEvents.length).toBe(1);
    const artists = Array.from(catalogRepo.artists.values());
    expect(artists.length).toBe(2);
  });
});
