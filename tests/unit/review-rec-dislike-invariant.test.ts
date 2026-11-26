/**
 * AGENTS.md invariant 11: genre similarity can never override an explicit dislike or the
 * lineup suppression rules.
 */
import { describe, it, expect } from 'vitest';
import { buildGenreTasteProfile } from '@/lib/recommendation/genre';
import { calculateArtistInterestFactor } from '@/lib/recommendation/factors/artist-interest';
import type { UserArtistPreference } from '@/lib/domain/user-preference';
import type { SpotifyTopArtist } from '@/lib/domain/spotify';

const pref = (
  id: string,
  artistId: string,
  name: string,
  level: UserArtistPreference['preferenceLevel'],
  extra: Partial<UserArtistPreference> = {},
): UserArtistPreference =>
  ({
    id,
    userId: 'u',
    artistId,
    artistName: name,
    normalizedArtistName: name.toLowerCase(),
    preferenceLevel: level,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  }) as UserArtistPreference;

const top = (id: string, name: string, genres: string[], rank = 1) =>
  ({ id, name, rank, genres }) as unknown as SpotifyTopArtist;

// The user listens to lots of house (strong positive genre taste).
const SPOTIFY = [
  top('sp-a', 'House Hero', ['house', 'tech house'], 1),
  top('sp-b', 'House Hero 2', ['melodic house'], 2),
];

describe('invariant 11: genre similarity never overrides dislikes', () => {
  it('a disliked artist in a liked genre is still suppressed', () => {
    const prefs = [pref('p1', 'art-1', 'Disliked House DJ', 'dislike')];
    const profile = buildGenreTasteProfile({
      artistPreferences: prefs,
      spotifyTopArtists: SPOTIFY,
    });
    expect(profile.positive.length).toBeGreaterThan(0);
    const r = calculateArtistInterestFactor(
      [
        {
          id: 'art-1',
          name: 'Disliked House DJ',
          billingPosition: 'headliner',
          genres: ['house', 'tech house'],
        },
      ],
      prefs,
      SPOTIFY,
      profile,
    );
    expect(r.isSuppressed).toBe(true);
    expect(r.factorScore.fieldStatus).toBe('suppressed');
    expect(r.genreMatch).toBeUndefined();
  });

  it('disliked headliner + highly similar support act: suppressed, support genre ignored', () => {
    const prefs = [pref('p1', 'art-h', 'Disliked Headliner', 'dislike')];
    const profile = buildGenreTasteProfile({
      artistPreferences: prefs,
      spotifyTopArtists: SPOTIFY,
    });
    const r = calculateArtistInterestFactor(
      [
        {
          id: 'art-h',
          name: 'Disliked Headliner',
          billingPosition: 'headliner',
          genres: ['trance'],
        },
        {
          id: 'art-s',
          name: 'Similar Support',
          billingPosition: 'support',
          genres: ['house', 'tech house'],
        },
      ],
      prefs,
      SPOTIFY,
      profile,
    );
    expect(r.isSuppressed).toBe(true);
    expect(r.suppressionReason).toMatch(/Headliner/);
  });

  it('non-favorite liked headliner with a disliked support act is suppressed despite genre fit', () => {
    const prefs = [
      pref('p1', 'art-h', 'Liked Headliner', 'like'),
      pref('p2', 'art-s', 'Disliked Support', 'dislike'),
    ];
    const profile = buildGenreTasteProfile({
      artistPreferences: prefs,
      spotifyTopArtists: SPOTIFY,
    });
    const r = calculateArtistInterestFactor(
      [
        {
          id: 'art-h',
          name: 'Liked Headliner',
          billingPosition: 'headliner',
          genres: ['house'],
        },
        {
          id: 'art-s',
          name: 'Disliked Support',
          billingPosition: 'support',
          genres: ['house'],
        },
      ],
      prefs,
      SPOTIFY,
      profile,
    );
    expect(r.isSuppressed).toBe(true);
  });

  it('favorite headliner overrides a disliked support act (documented exception)', () => {
    const prefs = [
      pref('p1', 'art-h', 'Fav Headliner', 'favorite'),
      pref('p2', 'art-s', 'Disliked Support', 'dislike'),
    ];
    const profile = buildGenreTasteProfile({
      artistPreferences: prefs,
      spotifyTopArtists: SPOTIFY,
    });
    const r = calculateArtistInterestFactor(
      [
        {
          id: 'art-h',
          name: 'Fav Headliner',
          billingPosition: 'headliner',
          genres: ['polka'],
        },
        {
          id: 'art-s',
          name: 'Disliked Support',
          billingPosition: 'support',
          genres: ['house'],
        },
      ],
      prefs,
      SPOTIFY,
      profile,
    );
    expect(r.isSuppressed).toBe(false);
    expect(r.factorScore.score).toBe(100);
    expect(r.matchedArtist?.name).toBe('Fav Headliner');
  });

  it('a disliked Spotify top artist adds no positive genre taste', () => {
    const prefs = [
      pref('p1', 'art-1', 'House Hero', 'dislike', { spotifyArtistId: 'sp-a' }),
    ];
    const profile = buildGenreTasteProfile({
      artistPreferences: prefs,
      spotifyTopArtists: [SPOTIFY[0]],
    });
    expect(profile.positive).toHaveLength(0);
    expect(profile.negative.length).toBeGreaterThan(0);
  });

  it('explicit dislike beats Spotify rank even for a top-ranked artist', () => {
    const prefs = [
      pref('p1', 'art-1', 'House Hero', 'dislike', { spotifyArtistId: 'sp-a' }),
    ];
    const profile = buildGenreTasteProfile({
      artistPreferences: prefs,
      spotifyTopArtists: SPOTIFY,
    });
    const r = calculateArtistInterestFactor(
      [
        {
          id: 'other',
          name: 'House Hero',
          spotifyArtistId: 'sp-a',
          billingPosition: 'headliner',
          genres: ['house'],
        },
      ],
      prefs,
      SPOTIFY,
      profile,
    );
    expect(r.isSuppressed).toBe(true);
  });

  it('an unrelated artist in a disliked genre gets penalized, not boosted', () => {
    const prefs = [
      pref('p1', 'art-d', 'Disliked Trancer', 'dislike', {
        canonicalArtist: {
          id: 'art-d',
          name: 'Disliked Trancer',
          genres: ['trance'],
        } as never,
      }),
    ];
    const profile = buildGenreTasteProfile({
      artistPreferences: prefs,
      spotifyTopArtists: SPOTIFY,
    });
    const withDislike = calculateArtistInterestFactor(
      [
        {
          id: 'x',
          name: 'Trance + House',
          billingPosition: 'headliner',
          genres: ['house', 'trance'],
        },
      ],
      prefs,
      SPOTIFY,
      profile,
    );
    const noDislike = calculateArtistInterestFactor(
      [
        {
          id: 'x',
          name: 'Trance + House',
          billingPosition: 'headliner',
          genres: ['house', 'trance'],
        },
      ],
      [],
      SPOTIFY,
      buildGenreTasteProfile({
        artistPreferences: [],
        spotifyTopArtists: SPOTIFY,
      }),
    );
    expect(withDislike.isSuppressed).toBe(false);
    expect(withDislike.factorScore.score).toBeLessThan(
      noDislike.factorScore.score,
    );
  });
});
