import { describe, expect, it } from 'vitest';
import {
  computeSpotifyAffinity,
  spotifyAffinityToArtistScore,
  LONG_ONLY_CAP,
} from '@/lib/recommendation/spotify-affinity';
import { buildGenreTasteProfile } from '@/lib/recommendation/genre';
import { calculateArtistInterestFactor } from '@/lib/recommendation/factors/artist-interest';
import type { SpotifyTopArtist } from '@/lib/domain/spotify';

const sa = (
  id: string,
  ranks: { short_term?: number; medium_term?: number; long_term?: number },
  genres: string[],
  rank = 1,
): SpotifyTopArtist =>
  ({
    id,
    name: id,
    rank,
    popularity: 50,
    genres,
    ranksByRange: ranks,
  }) as unknown as SpotifyTopArtist;

describe('computeSpotifyAffinity', () => {
  it('rising artist beats a steady artist with the same recent rank (outside the top 15)', () => {
    const rising = computeSpotifyAffinity({
      short_term: 20,
      medium_term: 35,
      long_term: 45,
    });
    const steady = computeSpotifyAffinity({
      short_term: 20,
      medium_term: 20,
      long_term: 20,
    });
    expect(rising.trend).toBe('rising');
    expect(rising.affinity).toBeGreaterThan(steady.affinity);
  });

  it('near the top of all three lists scores highest', () => {
    const allTop = computeSpotifyAffinity({
      short_term: 2,
      medium_term: 3,
      long_term: 4,
    });
    const recentOnly = computeSpotifyAffinity({ short_term: 2 });
    expect(allTop.consistentTop).toBe(true);
    expect(allTop.affinity).toBeGreaterThan(recentOnly.affinity);
  });

  it('long-term-only artists are not treated as current taste', () => {
    const old = computeSpotifyAffinity({ long_term: 1 });
    expect(old.affinity).toBeLessThanOrEqual(LONG_ONLY_CAP);
    const current = computeSpotifyAffinity({ short_term: 30 });
    expect(current.affinity).toBeGreaterThan(old.affinity);
  });

  it('fading artists score below steady ones', () => {
    const fading = computeSpotifyAffinity({ medium_term: 5, long_term: 3 });
    const steady = computeSpotifyAffinity({
      short_term: 5,
      medium_term: 5,
      long_term: 3,
    });
    expect(fading.trend).toBe('fading');
    expect(fading.affinity).toBeLessThan(steady.affinity);
  });

  it('artist score stays below an explicit "like" (75)', () => {
    expect(spotifyAffinityToArtistScore(1)).toBeLessThan(75);
    expect(spotifyAffinityToArtistScore(0)).toBeGreaterThanOrEqual(55);
  });
});

describe('genre weighting from Spotify affinity', () => {
  it('many artists in one genre outweigh a single artist in another', () => {
    const profile = buildGenreTasteProfile({
      artistPreferences: [],
      spotifyTopArtists: [
        sa('a', { short_term: 4, medium_term: 6, long_term: 9 }, ['house']),
        sa('b', { short_term: 7, medium_term: 8, long_term: 12 }, ['techno']),
        sa('c', { short_term: 9, medium_term: 11, long_term: 20 }, ['edm']),
        sa('d', { short_term: 2, medium_term: 3, long_term: 3 }, ['folk']),
      ],
    });
    const w = (g: string) =>
      profile.positive.find((e) => e.genre === g)?.weight ?? 0;
    expect(w('house') + w('techno') + w('edm')).toBeGreaterThan(w('folk'));
  });

  it('old long-term-only genre barely registers', () => {
    const profile = buildGenreTasteProfile({
      artistPreferences: [],
      spotifyTopArtists: [
        sa('now', { short_term: 5, medium_term: 5 }, ['house']),
        sa('then', { long_term: 1 }, ['emo']),
      ],
    });
    const emo = profile.positive.find((e) => e.genre === 'emo')?.weight ?? 0;
    const house =
      profile.positive.find((e) => e.genre === 'house')?.weight ?? 0;
    expect(house).toBe(1);
    expect(emo).toBeLessThan(0.15);
  });
});

describe('artist factor uses trend-aware score', () => {
  it('rising lineup artist scores above a faded one', () => {
    const lineup = (id: string) => [
      { id: `can-${id}`, name: id, spotifyArtistId: id },
    ];
    const rising = calculateArtistInterestFactor(
      lineup('r') as never,
      [],
      [sa('r', { short_term: 2, medium_term: 15, long_term: 30 }, ['house'])],
    );
    const old = calculateArtistInterestFactor(
      lineup('o') as never,
      [],
      [sa('o', { long_term: 2 }, ['house'])],
    );
    expect(rising.factorScore.score).toBeGreaterThan(old.factorScore.score);
    expect(rising.factorScore.score).toBeLessThan(75);
  });
});
