import { describe, expect, it, vi } from 'vitest';
import {
  buildGenreTasteProfile,
  describeGenre,
  describeGenreMatch,
  summarizeGenreTaste,
} from '@/lib/recommendation/genre';
import {
  calculateArtistInterestFactor,
  UNMARKED_ARTIST_SCORE,
} from '@/lib/recommendation/factors/artist-interest';
import { enrichSpotifyArtistGenres } from '@/lib/sources/spotify/genre-enrichment';
import {
  createTicketmasterGenreLookup,
  clearTicketmasterGenreLookupCache,
} from '@/lib/sources/ticketmaster/attraction-genres';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';
import type { SpotifyTopArtist } from '@/lib/domain/spotify';

function sp(
  id: string,
  name: string,
  rank: number,
  extra: Partial<SpotifyTopArtist> = {},
): SpotifyTopArtist {
  return {
    id,
    name,
    rank,
    imageUrl: null,
    spotifyUrl: `https://open.spotify.com/artist/${id}`,
    genres: [],
    popularity: 0,
    timeRange: 'short_term',
    ...extra,
  } as SpotifyTopArtist;
}

const EDM = ['Dance/Electronic', 'House'];

describe('genre taste is inferred per user (not hard-coded)', () => {
  const edmListener = [
    sp('1', 'John Summit', 1, { genres: EDM }),
    sp('2', 'Dom Dolla', 2, { genres: EDM }),
    sp('3', 'Cloonee', 4, { genres: EDM }),
    sp('4', 'GRiZ', 6, { genres: ['Dance/Electronic', 'Dubstep'] }),
    sp('5', 'FISHER', 8, { genres: EDM }),
    sp('6', 'Ely Oaks', 9, { genres: EDM }),
    sp('7', 'Jack Harlow', 7, { genres: ['Hip-Hop/Rap'] }),
  ];

  it('an electronic-heavy listener is assumed to like electronic, with their own artists as the basis', () => {
    const profile = buildGenreTasteProfile({
      artistPreferences: [],
      spotifyTopArtists: edmListener,
    });
    const summary = summarizeGenreTaste(profile, 3);
    expect(summary[0].label).toBe('electronic / EDM');
    expect(summary[0].weight).toBe(1);
    // Basis = the user's strongest artists in that taste.
    expect(summary[0].artists.length).toBeGreaterThan(0);
    for (const a of summary[0].artists) {
      expect(edmListener.map((x) => x.name)).toContain(a);
    }
    expect(summary[0].artists).not.toContain('Jack Harlow');
    // Raw genre spellings are kept for catalog queries.
    expect(summary[0].rawGenres.join(' ')).toMatch(/dance\/electronic|house/i);
  });

  it('a different listener gets a different taste (nothing is hard-coded to EDM)', () => {
    const country = [
      sp('a', 'Zach Bryan', 1, { genres: ['Country', 'Americana'] }),
      sp('b', 'Tyler Childers', 2, { genres: ['Country'] }),
      sp('c', 'Town Mountain', 3, { genres: ['Country', 'Bluegrass'] }),
    ];
    const summary = summarizeGenreTaste(
      buildGenreTasteProfile({
        artistPreferences: [],
        spotifyTopArtists: country,
      }),
    );
    expect(summary[0].label).toMatch(/country|bluegrass|folk/);
    expect(summary.map((s) => s.label)).not.toContain('electronic / EDM');
  });

  it('with no genre data there is no taste (never guessed)', () => {
    const profile = buildGenreTasteProfile({
      artistPreferences: [],
      spotifyTopArtists: [sp('x', 'Unknown', 1), sp('y', 'Other', 2)],
    });
    expect(profile.isEmpty).toBe(true);
    expect(summarizeGenreTaste(profile)).toEqual([]);
  });

  it('an unfamiliar electronic act scores above neutral and explains the assumption', () => {
    const profile = buildGenreTasteProfile({
      artistPreferences: [],
      spotifyTopArtists: edmListener,
    });
    const res = calculateArtistInterestFactor(
      [
        {
          id: 'new',
          name: 'Some New DJ',
          genres: ['Dance/Electronic', 'Techno'],
        },
      ],
      [],
      edmListener,
      profile,
    );
    expect(res.factorScore.score).toBeGreaterThan(UNMARKED_ARTIST_SCORE);
    expect(res.genreMatch).toBeDefined();
    expect(res.factorScore.explanation).toContain('Assumed taste for');
    expect(res.factorScore.explanation).toContain('based on your listening to');
    // Names come from this user's own listening.
    expect(res.genreMatch?.similarArtists?.length).toBeGreaterThan(0);
    expect(res.factorScore.explanation).toMatch(
      /John Summit|Dom Dolla|Cloonee/,
    );
  });

  it('an unrelated genre does not match an electronic listener', () => {
    const profile = buildGenreTasteProfile({
      artistPreferences: [],
      spotifyTopArtists: edmListener,
    });
    const res = calculateArtistInterestFactor(
      [{ id: 'r', name: 'Some Rock Band', genres: ['Rock', 'Hard Rock'] }],
      [],
      edmListener,
      profile,
    );
    expect(res.genreMatch).toBeUndefined();
    expect(res.factorScore.score).toBe(UNMARKED_ARTIST_SCORE);
  });

  it('describes genres and matches in plain language', () => {
    expect(describeGenre('Dance/Electronic')).toBe('electronic / EDM');
    expect(describeGenre('House')).toBe('house');
    expect(describeGenre('Hip-Hop/Rap')).toBe('hip-hop');
    expect(
      describeGenreMatch(
        {
          eventGenre: 'House',
          tasteGenre: 'dance electronic',
          similarTo: 'John Summit',
          similarArtists: ['John Summit', 'Cloonee', 'FISHER'],
        },
        'Chris Lake',
      ),
    ).toBe(
      'Assumed taste for electronic / EDM, based on your listening to John Summit, Cloonee and FISHER. Chris Lake is house',
    );
  });
});

describe('a Spotify top-10 artist is never shown as "unfamiliar"', () => {
  it('matches the event artist through the verified canonical id (the Ely Oaks case)', () => {
    const top = [
      sp('7kNq', 'John Summit', 1, { canonicalArtistId: 'canon-summit' }),
      sp('2MdF', 'Ely Oaks', 9, { canonicalArtistId: 'canon-ely' }),
    ];
    const res = calculateArtistInterestFactor(
      [{ id: 'canon-ely', name: 'Ely Oaks' }],
      [],
      top,
    );
    expect(res.matchedArtist?.isSpotifyAffinity).toBe(true);
    expect(res.matchedArtist?.spotifyRank).toBe(9);
    expect(res.factorScore.explanation).not.toMatch(/unfamiliar/i);
    expect(res.factorScore.score).toBeGreaterThan(UNMARKED_ARTIST_SCORE);
  });

  it('without Spotify data the same artist is (correctly) unfamiliar', () => {
    const res = calculateArtistInterestFactor(
      [{ id: 'canon-ely', name: 'Ely Oaks' }],
      [],
      [],
    );
    expect(res.factorScore.explanation).toMatch(/unfamiliar/i);
  });
});

describe('enrichSpotifyArtistGenres', () => {
  it('uses catalog genres for verified canonical matches, then a bounded name lookup', async () => {
    const repo = new MemoryCatalogRepository();
    const cloonee = await repo.createArtist({
      name: 'Cloonee',
      normalizedName: 'cloonee',
    });
    await repo.fillArtistGenres(
      cloonee.id,
      ['Dance/Electronic', 'House'],
      'ticketmaster',
    );

    const artists = [
      sp('1', 'Cloonee', 4, { canonicalArtistId: cloonee.id }),
      sp('2', 'Dom Dolla', 2),
      sp('3', 'Mystery Act', 3),
    ];
    const lookup = vi.fn(async (name: string) =>
      name === 'Dom Dolla' ? ['Dance/Electronic'] : null,
    );
    const stats = await enrichSpotifyArtistGenres(artists, {
      catalogRepo: repo,
      lookup,
    });

    expect(stats).toEqual({ fromCatalog: 1, fromLookup: 1 });
    expect(artists[0].genres).toEqual(['Dance/Electronic', 'House']);
    expect(artists[0].genresSource).toBe('catalog');
    expect(artists[1].genres).toEqual(['Dance/Electronic']);
    expect(artists[1].genresSource).toBe('ticketmaster');
    // Unknown stays unknown.
    expect(artists[2].genres).toEqual([]);
    // Catalog-resolved artists are not looked up again.
    expect(lookup).not.toHaveBeenCalledWith('Cloonee');
  });

  it('looks up only the best-ranked artists up to the cap and survives lookup failures', async () => {
    const artists = Array.from({ length: 10 }, (_, i) =>
      sp(`id${i}`, `Artist ${i}`, i + 1),
    );
    const lookup = vi.fn(async (name: string) => {
      if (name === 'Artist 1') throw new Error('network');
      return ['Rock'];
    });
    const stats = await enrichSpotifyArtistGenres(artists, {
      lookup,
      maxLookups: 3,
      concurrency: 2,
    });
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(lookup).not.toHaveBeenCalledWith('Artist 5');
    expect(stats.fromLookup).toBe(2); // rank 2 threw
    expect(artists[1].genres).toEqual([]);
  });

  it('does not overwrite genres an artist already has', async () => {
    const artists = [sp('1', 'Has Genres', 1, { genres: ['Pop'] })];
    const lookup = vi.fn(async () => ['Rock']);
    await enrichSpotifyArtistGenres(artists, { lookup });
    expect(lookup).not.toHaveBeenCalled();
    expect(artists[0].genres).toEqual(['Pop']);
  });
});

describe('Ticketmaster attraction genre lookup', () => {
  const body = (attractions: unknown[]) =>
    new Response(JSON.stringify({ _embedded: { attractions } }), {
      status: 200,
    });

  it('only accepts an exact normalized-name match, caches results, and never guesses', async () => {
    clearTicketmasterGenreLookupCache();
    const request = vi.fn().mockResolvedValue(
      body([
        {
          name: 'Dom Dolla Tribute Band',
          classifications: [{ primary: true, genre: { name: 'Rock' } }],
        },
        {
          name: 'DOM DOLLA',
          classifications: [
            {
              primary: true,
              genre: { name: 'Dance/Electronic' },
              subGenre: { name: 'House' },
            },
          ],
        },
      ]),
    );
    const lookup = createTicketmasterGenreLookup({
      apiKey: 'k',
      client: { request } as never,
    });
    expect(await lookup('Dom Dolla')).toEqual(['Dance/Electronic', 'House']);
    expect(await lookup('dom dolla')).toEqual(['Dance/Electronic', 'House']);
    expect(request).toHaveBeenCalledTimes(1); // second call served from cache

    clearTicketmasterGenreLookupCache();
    const ambiguous = vi.fn().mockResolvedValue(
      body([
        {
          name: 'Dom Dolla Tribute Band',
          classifications: [{ primary: true, genre: { name: 'Rock' } }],
        },
      ]),
    );
    const lookup2 = createTicketmasterGenreLookup({
      apiKey: 'k',
      client: { request: ambiguous } as never,
    });
    expect(await lookup2('Dom Dolla')).toBeNull();
  });

  it('treats network errors as unknown and does not cache them', async () => {
    clearTicketmasterGenreLookupCache();
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(
        body([
          {
            name: 'GRiZ',
            classifications: [
              { primary: true, genre: { name: 'Dance/Electronic' } },
            ],
          },
        ]),
      );
    const lookup = createTicketmasterGenreLookup({
      apiKey: 'k',
      client: { request } as never,
    });
    expect(await lookup('GRiZ')).toBeNull();
    expect(await lookup('GRiZ')).toEqual(['Dance/Electronic']);
  });
});
