import { beforeEach, describe, expect, it } from 'vitest';
import { CanonicalizationCoordinator } from '@/lib/entity-resolution/canonicalization-coordinator';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';
import { loadFixtures } from '../fixtures/fixture-helper';

const SPOTIFY_ID = 'sharedSpotifyId123';

describe('Canonicalization: provider external-ID conflicts route to needs_review', () => {
  let repo: MemoryCatalogRepository;
  let coordinator: CanonicalizationCoordinator;
  const fixtures = loadFixtures();

  beforeEach(() => {
    repo = new MemoryCatalogRepository();
    coordinator = new CanonicalizationCoordinator(repo);
  });

  const thomasCandidate = () => ({
    ...fixtures.single_show,
    id: crypto.randomUUID(),
    sourceEventId: 'tm-day-out-with-thomas',
    title: 'Day Out With Thomas',
    ticketUrl: 'https://example.com/day-out-with-thomas',
    artistNames: ['Thomas the Tank Engine', 'Thomas & Friends'],
    artists: [
      {
        name: 'Thomas the Tank Engine',
        billingPosition: 'headliner' as const,
        sortOrder: 0,
        externalIds: [{ provider: 'spotify', externalId: SPOTIFY_ID }],
      },
      {
        name: 'Thomas & Friends',
        billingPosition: 'support' as const,
        sortOrder: 1,
        externalIds: [{ provider: 'spotify', externalId: SPOTIFY_ID }],
      },
    ],
  });

  it('two attractions sharing one Spotify id in one listing collapse into ONE artist, linked once, with audit evidence', async () => {
    const cand = thomasCandidate();
    const result = await coordinator.canonicalize(cand);

    expect(result.status).toBe('created');
    expect(repo.events.size).toBe(1);
    expect(repo.artists.size).toBe(1);
    expect(repo.eventArtists.size).toBe(1);
    // display name is the FIRST attraction's name
    expect(Array.from(repo.artists.values())[0].name).toBe(
      'Thomas the Tank Engine',
    );
    // the shared Spotify id is stored once
    expect(repo.artistExternalIds.size).toBe(1);
    const evidence = Array.from(repo.eventFieldEvidence.values()).filter(
      (e) => e.fieldName === 'shared_external_id_in_candidate_collapsed',
    );
    expect(evidence).toHaveLength(1);
  });

  it('an unrelated event in the same batch still completes', async () => {
    const first = await coordinator.canonicalize(thomasCandidate());
    expect(first.status).toBe('created');

    const good = await coordinator.canonicalize({
      ...fixtures.single_show,
      id: crypto.randomUUID(),
      sourceEventId: 'tm-unrelated',
      localStartDate: '2026-09-02',
      startsAt: undefined,
      title: 'Unrelated Show',
      ticketUrl: 'https://example.com/unrelated',
      artistNames: ['Unrelated Band'],
      artists: [
        {
          name: 'Unrelated Band',
          billingPosition: 'headliner' as const,
          sortOrder: 0,
          externalIds: [{ provider: 'spotify', externalId: 'otherSpotify' }],
        },
      ],
    });
    expect(good.status).toBe('created');
    expect(repo.events.size).toBe(2);
    expect(repo.artists.size).toBe(2);
  });

  it('a new artist claiming an external id owned by an existing different artist is not merged', async () => {
    // Existing artist "Owner" owns the spotify id.
    const owner = await repo.createArtist({
      name: 'Owner Artist',
      normalizedName: 'owner artist',
    });
    await repo.addArtistExternalId({
      artistId: owner.id,
      provider: 'spotify',
      externalId: SPOTIFY_ID,
    });

    // Directly exercise the repository transaction with a payload where a *new*
    // artist id claims the same id (what the coordinator would never emit after
    // its own check, i.e. the stored-procedure backstop path).
    const candId = crypto.randomUUID();
    const out = await repo.applyCanonicalization({
      event: { name: 'X', normalized_name: 'x', timezone: 'UTC' },
      artists: [
        {
          artist_id: crypto.randomUUID(),
          name: 'Impostor',
          external_ids: [{ provider: 'spotify', external_id: SPOTIFY_ID }],
        },
      ],
      resolution: {
        event_candidate_id: candId,
        status: 'created',
        confidence: 0.9,
        reasons: [],
      },
    });
    expect(out.status).toBe('needs_review');
    expect(repo.events.size).toBe(0);
    expect(repo.artists.size).toBe(1);
    const res = await repo.findResolutionByCandidateId(candId);
    expect(res?.status).toBe('needs_review');
    expect(res?.reasons).toContain('duplicate_external_id_conflict');
  });

  it('same artist repeating its own external id is not a conflict', async () => {
    const cand = {
      ...thomasCandidate(),
      artistNames: ['Solo Thomas'],
      artists: [
        {
          name: 'Solo Thomas',
          billingPosition: 'headliner' as const,
          sortOrder: 0,
          externalIds: [
            { provider: 'spotify', externalId: SPOTIFY_ID },
            { provider: 'spotify', externalId: SPOTIFY_ID },
          ],
        },
      ],
    };
    const result = await coordinator.canonicalize(cand);
    expect(result.status).toBe('created');
  });
});
