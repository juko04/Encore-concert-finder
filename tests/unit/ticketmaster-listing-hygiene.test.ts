import { describe, expect, it } from 'vitest';
import {
  extractTicketmasterGenres,
  isNonArtistAttraction,
  splitTicketPackageTitle,
} from '@/lib/sources/ticketmaster/listing-filters';
import { parseTicketmasterEvent } from '@/lib/sources/ticketmaster/parser';
import {
  evaluateFieldMerge,
  isMoreSpecificTitle,
} from '@/lib/entity-resolution/field-merge';
import { storeTicketmasterArtistGenres } from '@/lib/sources/ticketmaster/ingestion-pipeline';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';
import type { Event } from '@/lib/domain/catalog';
import type { EventCandidate } from '@/lib/domain/event-candidate';
import type { TicketmasterEvent } from '@/lib/sources/ticketmaster/types';

function tmEvent(
  overrides: Partial<TicketmasterEvent> = {},
): TicketmasterEvent {
  return {
    id: 'evt-1',
    name: 'Nickelback: Everything Under The Sun Tour',
    dates: {
      start: {
        localDate: '2027-04-24',
        localTime: '19:00:00',
        dateTime: '2027-04-25T01:00:00Z',
      },
      timezone: 'America/Denver',
      status: { code: 'onsale' },
    },
    classifications: [
      {
        primary: true,
        segment: { name: 'Music' },
        genre: { name: 'Rock' },
        subGenre: { name: 'Hard Rock' },
      },
    ],
    _embedded: {
      venues: [
        {
          id: 'v1',
          name: 'Ball Arena',
          city: { name: 'Denver' },
          state: { stateCode: 'CO' },
          timezone: 'America/Denver',
        },
      ],
      attractions: [
        {
          id: 'K8vZ9171EXf',
          name: 'Nickelback',
          classifications: [
            {
              primary: true,
              genre: { name: 'Rock' },
              subGenre: { name: 'Hard Rock' },
            },
          ],
        },
        {
          id: 'K8vZ917b-Of',
          name: 'Club Level Seating: Ball Arena',
          classifications: [{ primary: true, genre: { name: 'Other' } }],
        },
      ],
    },
    ...overrides,
  } as TicketmasterEvent;
}

const CONTEXT = {
  sourceId: 'b0000000-0000-0000-0000-000000000003',
  rawIngestId: 'c0000000-0000-0000-0000-000000000001',
  sourceUrl: 'https://app.ticketmaster.com/discovery/v2/events.json',
  fetchedAt: '2026-11-24T12:00:00Z',
  contentHash: 'hash',
  parserVersion: '1.0.0',
};

describe('ticket package detection', () => {
  it('splits a package prefix from the real show title', () => {
    expect(splitTicketPackageTitle('Club Level Seating: Nickelback')).toEqual({
      isPackage: true,
      baseTitle: 'Nickelback',
    });
    expect(splitTicketPackageTitle('VIP Package - Dom Dolla')).toEqual({
      isPackage: true,
      baseTitle: 'Dom Dolla',
    });
    expect(splitTicketPackageTitle('Parking: Red Rocks')).toEqual({
      isPackage: true,
      baseTitle: 'Red Rocks',
    });
  });

  it('does not treat real titles or artists containing those words as packages', () => {
    for (const t of [
      'Nickelback: Everything Under The Sun Tour',
      'The Parking Lot Experience',
      'Vip Vap',
      'Suite Life Live',
      'Club Night with Dom Dolla',
    ]) {
      expect(splitTicketPackageTitle(t).isPackage).toBe(false);
    }
  });

  it('flags seat products and the venue itself as non-artists, never real performers', () => {
    expect(
      isNonArtistAttraction('Club Level Seating: Ball Arena', 'Ball Arena'),
    ).toBe(true);
    expect(isNonArtistAttraction('Club Seating: Paramount Theatre')).toBe(true);
    expect(isNonArtistAttraction('Ball Arena', 'Ball Arena')).toBe(true);
    expect(
      isNonArtistAttraction('Premium Parking: Ball Arena', 'Ball Arena'),
    ).toBe(true);
    expect(isNonArtistAttraction('Nickelback', 'Ball Arena')).toBe(false);
    expect(isNonArtistAttraction('Don Broco', 'Ball Arena')).toBe(false);
    expect(isNonArtistAttraction('Ely Oaks', 'Ball Arena')).toBe(false);
    expect(isNonArtistAttraction('', 'Ball Arena')).toBe(false);
  });
});

describe('Ticketmaster genre extraction', () => {
  it('returns genre then sub-genre from the primary classification', () => {
    expect(
      extractTicketmasterGenres([
        { primary: false, genre: { name: 'Pop' } },
        {
          primary: true,
          segment: { name: 'Music' },
          genre: { name: 'Dance/Electronic' },
          subGenre: { name: 'House' },
        },
      ]),
    ).toEqual(['Dance/Electronic', 'House']);
  });

  it('drops placeholder values and never invents genres', () => {
    expect(
      extractTicketmasterGenres([
        {
          primary: true,
          genre: { name: 'Undefined' },
          subGenre: { name: 'Other' },
        },
      ]),
    ).toEqual([]);
    expect(extractTicketmasterGenres(undefined)).toEqual([]);
    expect(extractTicketmasterGenres([])).toEqual([]);
  });
});

describe('Ticketmaster parser: package listings and genres', () => {
  it('keeps the tour title and real artists, with genres, for a normal listing', () => {
    const c = parseTicketmasterEvent(tmEvent(), CONTEXT);
    expect(c.title).toBe('Nickelback: Everything Under The Sun Tour');
    expect(c.artistNames).toEqual(['Nickelback']);
    expect(c.artists?.[0].genres).toEqual(['Rock', 'Hard Rock']);
    expect(c.rawPayload?.genres).toEqual(['Rock', 'Hard Rock']);
    expect(c.rawPayload?.isTicketPackage).toBeUndefined();
  });

  it('drops the seating pseudo-artist and strips the package prefix from the title', () => {
    const c = parseTicketmasterEvent(
      tmEvent({ id: 'evt-2', name: 'Club Level Seating: Nickelback' }),
      CONTEXT,
    );
    expect(c.title).toBe('Nickelback');
    expect(c.artistNames).toEqual(['Nickelback']);
    expect(c.artistNames).not.toContain('Club Level Seating: Ball Arena');
    expect(c.rawPayload?.isTicketPackage).toBe(true);
    // The original name is preserved in the audit payload.
    expect(c.rawPayload?.name).toBe('Club Level Seating: Nickelback');
  });

  it('leaves genres off when Ticketmaster supplies none', () => {
    const c = parseTicketmasterEvent(
      tmEvent({ classifications: undefined }),
      CONTEXT,
    );
    expect(c.rawPayload?.genres).toBeUndefined();
  });
});

describe('field merge: tour title and genres', () => {
  const current: Event = {
    id: 'e1',
    name: 'Nickelback',
    normalizedName: 'nickelback',
    eventKind: 'concert',
    status: 'scheduled',
    venueId: 'v1',
    timezone: 'America/Denver',
    localStartDate: '2027-04-24',
    startTimePrecision: 'instant',
    isMultiDay: false,
  };
  const candidate = (over: Partial<EventCandidate>): EventCandidate =>
    ({
      title: 'Nickelback: Everything Under The Sun Tour',
      artistNames: ['Nickelback'],
      venueName: 'Ball Arena',
      timezone: 'America/Denver',
      localStartDate: '2027-04-24',
      startTimePrecision: 'instant',
      confidence: 0.95,
      provenance: {
        sourceId: 's',
        sourceType: 'ticketing',
        acquisitionMethod: 'api',
        sourceUrl: 'https://x',
        contentHash: 'h',
        fetchedAt: '2026-11-24T00:00:00Z',
        confidence: 0.95,
        parserVersion: '1.0.0',
      },
      ...over,
    }) as EventCandidate;

  it('upgrades a bare title to the tour name (recorded as field evidence)', () => {
    const out = evaluateFieldMerge(current, candidate({}));
    expect(out.updates.name).toBe('Nickelback: Everything Under The Sun Tour');
    expect(out.evidences.some((e) => e.fieldName === 'name')).toBe(true);
  });

  it('never lets a ticket-package listing override the title', () => {
    const out = evaluateFieldMerge(
      current,
      candidate({
        title: 'Nickelback: Club Level Seating',
        rawPayload: { isTicketPackage: true },
      }),
    );
    expect(out.updates.name).toBeUndefined();
  });

  it('does not treat "w/ opener" or "feat." suffixes as a more specific title', () => {
    expect(
      isMoreSpecificTitle(
        'The Cactus Blossoms',
        'The Cactus Blossoms w/ Margo Cilker',
      ),
    ).toBe(false);
    expect(isMoreSpecificTitle('Phish', 'Phish feat. Trey')).toBe(false);
    expect(isMoreSpecificTitle('Phish', 'Phish: Night 2')).toBe(true);
    expect(isMoreSpecificTitle('Phish: Night 2', 'Phish')).toBe(false);
    expect(isMoreSpecificTitle('Phish', 'Phish')).toBe(false);
  });

  it('fills genres only when the event has none', () => {
    const filled = evaluateFieldMerge(
      current,
      candidate({ rawPayload: { genres: ['Dance/Electronic', 'House'] } }),
    );
    expect(filled.updates.genres).toEqual(['Dance/Electronic', 'House']);
    expect(filled.updates.genre).toBe('Dance/Electronic');

    const kept = evaluateFieldMerge(
      { ...current, genre: 'Rock', genres: ['Rock'] },
      candidate({ rawPayload: { genres: ['Dance/Electronic'] } }),
    );
    expect(kept.updates.genres).toBeUndefined();
  });
});

describe('storeTicketmasterArtistGenres', () => {
  it('fills genres by Ticketmaster attraction id, only when empty, with provenance', async () => {
    const repo = new MemoryCatalogRepository();
    const artist = await repo.createArtist({
      name: 'Cloonee',
      normalizedName: 'cloonee',
    });
    await repo.addArtistExternalId({
      artistId: artist.id,
      provider: 'ticketmaster',
      externalId: 'K8vZ917QdK7',
    });

    const cand = {
      artists: [
        {
          name: 'Cloonee',
          externalIds: [
            { provider: 'ticketmaster', externalId: 'K8vZ917QdK7' },
          ],
          genres: ['Dance/Electronic', 'House'],
        },
        // Same name, unknown attraction id: must not be touched (never matched by name).
        {
          name: 'Cloonee',
          externalIds: [{ provider: 'ticketmaster', externalId: 'OTHER' }],
          genres: ['Country'],
        },
      ],
    };
    const written = await storeTicketmasterArtistGenres(repo, cand);
    expect(written).toBe(1);
    expect((await repo.getArtistById(artist.id))?.genres).toEqual([
      'Dance/Electronic',
      'House',
    ]);

    // Fill-if-empty: a second observation never overwrites.
    const again = await storeTicketmasterArtistGenres(repo, {
      artists: [
        {
          name: 'Cloonee',
          externalIds: [
            { provider: 'ticketmaster', externalId: 'K8vZ917QdK7' },
          ],
          genres: ['Pop'],
        },
      ],
    });
    expect(again).toBe(0);
    expect((await repo.getArtistById(artist.id))?.genres).toEqual([
      'Dance/Electronic',
      'House',
    ]);
  });
});
