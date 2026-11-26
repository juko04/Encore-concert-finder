import { beforeEach, describe, expect, it } from 'vitest';
import {
  CanonicalizationCoordinator,
  dedupeArtistPayloads,
} from '@/lib/entity-resolution/canonicalization-coordinator';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';
import type { EventCandidate } from '@/lib/domain/event-candidate';
import { parseTicketmasterEvent } from '@/lib/sources/ticketmaster/parser';
import { trustedAttractionGenres } from '@/lib/sources/ticketmaster/listing-filters';
import type { TicketmasterEvent } from '@/lib/sources/ticketmaster/types';
import { loadFixtures } from '../fixtures/fixture-helper';

const SPOTIFY_ID = 'sharedSpotifyThomas(Synthetic Test)';

describe('Multiple external ids per provider and artist-less events', () => {
  let repo: MemoryCatalogRepository;
  let coordinator: CanonicalizationCoordinator;
  const fixtures = loadFixtures();

  beforeEach(() => {
    repo = new MemoryCatalogRepository();
    coordinator = new CanonicalizationCoordinator(repo);
  });

  const base = (
    over: Partial<EventCandidate> & { sourceEventId: string },
  ): EventCandidate & { id: string; rawIngestId: string; sourceId: string } =>
    ({
      ...fixtures.single_show,
      id: crypto.randomUUID(),
      rawIngestId: crypto.randomUUID(),
      sourceId: crypto.randomUUID(),
      ...over,
    }) as EventCandidate & {
      id: string;
      rawIngestId: string;
      sourceId: string;
    };

  const thomasCandidate = (sourceEventId = 'tm-thomas') =>
    base({
      sourceEventId,
      title: 'Day Out With Thomas (Synthetic Test)',
      ticketUrl: `https://example.test/${sourceEventId}`,
      artistNames: ['Day Out With Thomas', 'Thomas & Friends'],
      artists: [
        {
          name: 'Day Out With Thomas',
          billingPosition: 'unknown',
          sortOrder: 0,
          externalIds: [
            { provider: 'ticketmaster', externalId: 'TM-ATTR-A' },
            { provider: 'spotify', externalId: SPOTIFY_ID },
          ],
        },
        {
          name: 'Thomas & Friends',
          billingPosition: 'unknown',
          sortOrder: 1,
          externalIds: [
            { provider: 'ticketmaster', externalId: 'TM-ATTR-B' },
            { provider: 'spotify', externalId: SPOTIFY_ID },
          ],
        },
      ],
    });

  async function seedThomasOwner() {
    const owner = await repo.createArtist({
      name: 'Thomas the Tank Engine (Synthetic Test)',
      normalizedName: 'thomas the tank engine synthetic test',
    });
    await repo.addArtistExternalId({
      artistId: owner.id,
      provider: 'spotify',
      externalId: SPOTIFY_ID,
    });
    return owner;
  }

  describe('several ids from one provider', () => {
    it('the repository transaction lets one artist hold two ids of the same provider', async () => {
      const owner = await seedThomasOwner();
      for (const id of ['TM-ONE', 'TM-TWO']) {
        await repo.applyCanonicalization({
          event: {
            name: `Event ${id}`,
            normalized_name: `event ${id}`.toLowerCase(),
            timezone: 'UTC',
          },
          artists: [
            {
              artist_id: owner.id,
              external_ids: [{ provider: 'ticketmaster', external_id: id }],
            },
          ],
        });
      }
      const ids = (await repo.findArtistExternalIds(owner.id))
        .filter((e) => e.provider === 'ticketmaster')
        .map((e) => e.externalId)
        .sort();
      expect(ids).toEqual(['TM-ONE', 'TM-TWO']);
    });

    it('an id owned by a DIFFERENT artist is still never reassigned', async () => {
      const owner = await seedThomasOwner();
      const other = await repo.createArtist({
        name: 'Other Artist (Synthetic Test)',
        normalizedName: 'other artist synthetic test',
      });
      await repo.addArtistExternalId({
        artistId: other.id,
        provider: 'ticketmaster',
        externalId: 'TM-ATTR-A',
      });
      const candidate = thomasCandidate();
      const result = await coordinator.canonicalize(candidate);
      expect(result.status).toBe('needs_review');
      // The resolver refuses the cross-artist id before any write (the stored procedure
      // backstop with duplicate_external_id_conflict is covered by the integration suite).
      expect(result.reasons).toContain(
        'external_id_already_associated_with_different_artist',
      );
      const res = await repo.findResolutionByCandidateId(candidate.id);
      expect(res?.status).toBe('needs_review');
      expect(repo.events.size).toBe(0);
      const ownerIds = await repo.findArtistExternalIds(owner.id);
      expect(ownerIds.filter((e) => e.provider === 'ticketmaster')).toEqual([]);
      expect(
        (await repo.findArtistByExternalId('ticketmaster', 'TM-ATTR-A'))?.id,
      ).toBe(other.id);
    });

    it('two attractions sharing one Spotify id that resolve to one existing artist create the event', async () => {
      const owner = await seedThomasOwner();
      const result = await coordinator.canonicalize(thomasCandidate());
      expect(result.status).toBe('created');
      expect(repo.events.size).toBe(1);
      // one artist, linked once, holding BOTH ticketmaster ids
      expect(repo.artists.size).toBe(1);
      expect(repo.eventArtists.size).toBe(1);
      const ext = await repo.findArtistExternalIds(owner.id);
      expect(
        ext
          .filter((e) => e.provider === 'ticketmaster')
          .map((e) => e.externalId)
          .sort(),
      ).toEqual(['TM-ATTR-A', 'TM-ATTR-B']);
      expect(ext.filter((e) => e.provider === 'spotify')).toHaveLength(1);
    });

    it('the rest of the batch completes and replaying the Thomas listing is idempotent', async () => {
      await seedThomasOwner();
      const first = thomasCandidate();
      expect((await coordinator.canonicalize(first)).status).toBe('created');

      const other = await coordinator.canonicalize(
        base({
          sourceEventId: 'tm-other',
          title: 'Other Show (Synthetic Test)',
          ticketUrl: 'https://example.test/tm-other',
          localStartDate: '2026-09-01',
          artistNames: ['Other Band (Synthetic Test)'],
          artists: [
            {
              name: 'Other Band (Synthetic Test)',
              billingPosition: 'headliner',
              externalIds: [{ provider: 'ticketmaster', externalId: 'TM-O' }],
            },
          ],
        }),
      );
      expect(other.status).toBe('created');

      // Replay of the same upstream event (new candidate row, same source event id)
      const replay = thomasCandidate();
      replay.sourceId = first.sourceId;
      const again = await coordinator.canonicalize(replay);
      expect(again.status).toBe('matched');
      expect(repo.events.size).toBe(2);
      const ext = Array.from(repo.artistExternalIds.values()).filter(
        (e) => e.provider === 'ticketmaster' && e.externalId.startsWith('TM-A'),
      );
      expect(ext).toHaveLength(2);
    });

    it('two NEW attractions sharing one Spotify id collapse into one artist holding both Ticketmaster ids', async () => {
      const first = thomasCandidate();
      const result = await coordinator.canonicalize(first);
      expect(result.status).toBe('created');
      expect(repo.events.size).toBe(1);
      expect(repo.artists.size).toBe(1);
      expect(repo.eventArtists.size).toBe(1);
      const artist = Array.from(repo.artists.values())[0];
      expect(artist.name).toBe('Day Out With Thomas');
      const ext = await repo.findArtistExternalIds(artist.id);
      expect(
        ext
          .filter((e) => e.provider === 'ticketmaster')
          .map((e) => e.externalId)
          .sort(),
      ).toEqual(['TM-ATTR-A', 'TM-ATTR-B']);
      expect(ext.filter((e) => e.provider === 'spotify')).toHaveLength(1);
      const evidence = Array.from(repo.eventFieldEvidence.values()).filter(
        (e) => e.fieldName === 'shared_external_id_in_candidate_collapsed',
      );
      expect(evidence).toHaveLength(1);

      // replay (same upstream event) is idempotent
      const replay = thomasCandidate();
      replay.sourceId = first.sourceId;
      expect((await coordinator.canonicalize(replay)).status).toBe('matched');
      expect(repo.events.size).toBe(1);
      expect(repo.artists.size).toBe(1);
      expect(repo.artistExternalIds.size).toBe(3);
    });

    it('a shared id whose attraction ids belong to an unrelated existing artist stays needs_review', async () => {
      const x = await repo.createArtist({
        name: 'Unrelated X (Synthetic Test)',
        normalizedName: 'unrelated x synthetic test',
      });
      await repo.addArtistExternalId({
        artistId: x.id,
        provider: 'ticketmaster',
        externalId: 'TM-ATTR-A',
      });
      const y = await repo.createArtist({
        name: 'Unrelated Y (Synthetic Test)',
        normalizedName: 'unrelated y synthetic test',
      });
      await repo.addArtistExternalId({
        artistId: y.id,
        provider: 'spotify',
        externalId: SPOTIFY_ID,
      });
      const cand = thomasCandidate();
      const result = await coordinator.canonicalize(cand);
      expect(result.status).toBe('needs_review');
      expect((await repo.findResolutionByCandidateId(cand.id))?.status).toBe(
        'needs_review',
      );
      expect(repo.events.size).toBe(0);
    });

    it('two attractions with DIFFERENT Spotify ids remain two artists', async () => {
      const cand = thomasCandidate('tm-diff');
      cand.artists = cand.artists!.map((a, i) => ({
        ...a,
        externalIds: [
          a.externalIds![0],
          { provider: 'spotify', externalId: `${SPOTIFY_ID}-${i}` },
        ],
      }));
      const result = await coordinator.canonicalize(cand);
      expect(result.status).toBe('created');
      expect(repo.artists.size).toBe(2);
      expect(repo.eventArtists.size).toBe(2);
      expect(
        Array.from(repo.eventFieldEvidence.values()).filter(
          (e) => e.fieldName === 'shared_external_id_in_candidate_collapsed',
        ),
      ).toHaveLength(0);
    });

    it('dedupeArtistPayloads unions external ids without duplicates', () => {
      const out = dedupeArtistPayloads([
        {
          artist_id: 'a',
          external_ids: [{ provider: 'ticketmaster', external_id: '1' }],
        },
        {
          artist_id: 'a',
          image_url: 'https://x.test/i.png',
          external_ids: [
            { provider: 'ticketmaster', external_id: '1' },
            { provider: 'ticketmaster', external_id: '2' },
          ],
        },
        { artist_id: 'b' },
      ]);
      expect(out).toHaveLength(2);
      expect(out[0].external_ids).toHaveLength(2);
      expect(out[0].image_url).toBe('https://x.test/i.png');
    });
  });

  describe('artist-less events', () => {
    const clubNight = (
      sourceEventId: string,
      title: string,
      over: Partial<EventCandidate> = {},
    ) =>
      base({
        sourceEventId,
        title,
        artistNames: [],
        artists: [],
        ticketUrl: `https://example.test/${sourceEventId}`,
        venueName: 'Stampede (Synthetic Test)',
        city: 'Denver',
        localStartDate: '2026-12-10',
        startsAt: undefined,
        startTimePrecision: 'date_only',
        price: { min: 5, max: 5, currency: 'USD' },
        rawPayload: {
          genres: ['Dance/Electronic', 'House'],
          images: {
            source: 'ticketmaster',
            eventImageUrl: 'https://img.example.test/ladies.jpg',
          },
        },
        ...over,
      });

    it('with a genre creates the event with zero artists and carries price, image and genres', async () => {
      const cand = clubNight('tm-ladies', 'Ladies Night 2026 (Synthetic Test)');
      const payloads: Array<Record<string, unknown>> = [];
      const original = repo.applyCanonicalization.bind(repo);
      repo.applyCanonicalization = async (p) => {
        payloads.push(p as unknown as Record<string, unknown>);
        return original(p);
      };
      const result = await coordinator.canonicalize(cand);
      expect(result.status).toBe('created');
      expect(repo.events.size).toBe(1);
      expect(repo.artists.size).toBe(0);
      expect(repo.eventArtists.size).toBe(0);
      const event = Array.from(repo.events.values())[0];
      expect(event.name).toBe('Ladies Night 2026 (Synthetic Test)');
      expect(event.imageUrl).toBe('https://img.example.test/ladies.jpg');
      const sent = payloads[0] as {
        artists: unknown[];
        event: Record<string, unknown>;
      };
      expect(sent.artists).toEqual([]);
      expect(sent.event.genre).toBe('Dance/Electronic');
      expect(sent.event.genres).toEqual(['Dance/Electronic', 'House']);
      expect(sent.event.min_price).toBe(5);
      expect(sent.event.max_price).toBe(5);
      expect(sent.event.currency).toBe('USD');
      const res = await repo.findResolutionByCandidateId(cand.id);
      expect(res?.status).toBe('created');
    });

    it('without any genre is a persisted needs_review (missing_artist_identity)', async () => {
      const cand = clubNight('tm-nogenre', 'No Genre Night (Synthetic Test)', {
        rawPayload: {},
      });
      const result = await coordinator.canonicalize(cand);
      expect(result.status).toBe('needs_review');
      expect(result.reasons).toContain('missing_artist_identity');
      expect((await repo.findResolutionByCandidateId(cand.id))?.status).toBe(
        'needs_review',
      );
      expect(repo.events.size).toBe(0);
    });

    it('a seat/VIP/parking package listing without an artist stays in review even with a genre', async () => {
      const cand = clubNight('tm-pkg', 'Nickelback (Synthetic Test)', {
        rawPayload: { genres: ['Rock'], isTicketPackage: true },
      });
      const result = await coordinator.canonicalize(cand);
      expect(result.status).toBe('needs_review');
      expect(result.reasons).toContain('missing_artist_identity');
    });

    it('two different artist-less events at one venue on one night stay separate', async () => {
      const a = await coordinator.canonicalize(
        clubNight('tm-a', 'Ladies Night (Synthetic Test)'),
      );
      const b = await coordinator.canonicalize(
        clubNight('tm-b', '$5 Thursdays! (Synthetic Test)'),
      );
      expect(a.status).toBe('created');
      expect(b.status).toBe('created');
      expect(repo.events.size).toBe(2);
      expect(a.eventId).not.toBe(b.eventId);
    });

    it('the same artist-less title (another source event id) merges, repeated processing never duplicates', async () => {
      const first = clubNight('tm-same-1', 'Ladies Night (Synthetic Test)');
      expect((await coordinator.canonicalize(first)).status).toBe('created');

      // same candidate processed again: source-event-id match
      const replay = clubNight('tm-same-1', 'Ladies Night (Synthetic Test)', {
        sourceId: first.sourceId,
      });
      expect((await coordinator.canonicalize(replay)).status).toBe('matched');

      // same title, different upstream id/url: title identity merges it
      const twin = clubNight('tm-same-2', 'Ladies Night (Synthetic Test)', {
        ticketUrl: 'https://example.test/other-url',
      });
      expect((await coordinator.canonicalize(twin)).status).toBe('matched');
      expect(repo.events.size).toBe(1);
    });

    it('a normal artist show on the same night is neither blocked nor merged', async () => {
      await coordinator.canonicalize(
        clubNight('tm-club', 'Ladies Night (Synthetic Test)'),
      );
      const show = await coordinator.canonicalize(
        base({
          sourceEventId: 'tm-real',
          title: 'Real Band Live (Synthetic Test)',
          ticketUrl: 'https://example.test/real',
          venueName: 'Stampede (Synthetic Test)',
          city: 'Denver',
          localStartDate: '2026-12-10',
          artistNames: ['Real Band (Synthetic Test)'],
          artists: [
            {
              name: 'Real Band (Synthetic Test)',
              billingPosition: 'headliner',
            },
          ],
        }),
      );
      expect(show.status).toBe('created');
      expect(repo.events.size).toBe(2);
    });

    it('an artist-less candidate never merges into an artist show on the same night', async () => {
      await coordinator.canonicalize(
        base({
          sourceEventId: 'tm-real2',
          title: 'Real Band Live (Synthetic Test)',
          ticketUrl: 'https://example.test/real2',
          venueName: 'Stampede (Synthetic Test)',
          city: 'Denver',
          localStartDate: '2026-12-10',
          artistNames: ['Real Band (Synthetic Test)'],
          artists: [
            {
              name: 'Real Band (Synthetic Test)',
              billingPosition: 'headliner',
            },
          ],
        }),
      );
      const club = await coordinator.canonicalize(
        clubNight('tm-club2', 'Ladies Night (Synthetic Test)'),
      );
      expect(club.status).toBe('created');
      expect(repo.events.size).toBe(2);
    });
  });

  describe('House Party: untrusted Religious attraction genre', () => {
    const music = [
      {
        primary: true,
        segment: { name: 'Music' },
        genre: { name: 'Pop' },
      },
    ];
    const clubListing = [
      {
        primary: true,
        segment: { name: 'Miscellaneous' },
        genre: { name: 'Fairs & Festivals' },
      },
    ];
    const gospel = ['Religious', 'Gospel'];

    it('drops Religious/Gospel when the event is classified as a non-music listing', () => {
      expect(trustedAttractionGenres(gospel, clubListing)).toEqual([]);
      expect(
        trustedAttractionGenres(['Religious', 'House'], clubListing),
      ).toEqual(['House']);
    });

    it('keeps it for a Music event, a Religious event, or when the event has no classification', () => {
      expect(trustedAttractionGenres(gospel, music)).toEqual(gospel);
      expect(
        trustedAttractionGenres(gospel, [
          {
            primary: true,
            segment: { name: 'Music' },
            genre: { name: 'Religious' },
          },
        ]),
      ).toEqual(gospel);
      expect(trustedAttractionGenres(gospel, undefined)).toEqual(gospel);
      expect(trustedAttractionGenres(['Rock'], clubListing)).toEqual(['Rock']);
    });

    it('the parser stores no Religious genre on the shared "House Party" attraction of a club listing', () => {
      const evt = {
        id: 'hp-1',
        name: 'House Party - Ages 21+',
        dates: {
          start: { localDate: '2026-12-04', localTime: '21:00:00' },
          timezone: 'America/Chicago',
          status: { code: 'onsale' },
        },
        classifications: clubListing,
        _embedded: {
          venues: [
            {
              id: 'v',
              name: "Wooly's",
              city: { name: 'Des Moines' },
              timezone: 'America/Chicago',
            },
          ],
          attractions: [
            {
              id: 'K8vZ91755zf',
              name: 'House Party',
              classifications: [
                {
                  primary: true,
                  segment: { name: 'Music' },
                  genre: { name: 'Religious' },
                  subGenre: { name: 'Gospel' },
                },
              ],
            },
          ],
        },
      } as unknown as TicketmasterEvent;
      const cand = parseTicketmasterEvent(evt, {
        sourceId: 's',
        rawIngestId: 'r',
        sourceUrl: 'https://example.test',
        fetchedAt: '2026-11-01T00:00:00Z',
        contentHash: 'h',
        parserVersion: '1',
      });
      expect(cand.artists?.[0].name).toBe('House Party');
      expect(cand.artists?.[0].genres).toBeUndefined();
      expect(cand.rawPayload?.genres).toEqual(['Fairs & Festivals']);
    });
  });
});
