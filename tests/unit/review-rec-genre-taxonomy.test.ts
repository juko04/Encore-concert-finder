import { describe, it, expect } from 'vitest';
import {
  buildGenreTasteProfile,
  calculateGenreFit,
  classifyGenre,
  genreSimilarity,
  normalizeGenre,
} from '@/lib/recommendation/genre';

type Case = [genre: string, family: string | null, cluster: string | null];

describe('genre taxonomy edge cases (review)', () => {
  const classification: Case[] = [
    // latin / urban family
    ['reggaeton', 'latin', 'latin_urban'],
    ['reggaeton colombiano', 'latin', 'latin_urban'],
    ['trap latino', 'latin', 'latin_urban'],
    ['latin hip hop', 'latin', 'latin_urban'],
    ['urbano latino', 'latin', 'latin_urban'],
    ['regional mexican', 'latin', 'latin'],
    ['norteño', 'latin', 'latin'],
    ['latin pop', 'latin', 'latin'],
    // reggae stays reggae
    ['reggae', 'reggae', 'reggae'],
    ['dancehall', 'reggae', 'reggae'],
    ['reggae fusion', 'reggae', 'reggae'],
    // hip hop vs house vs trap
    ['hip hop', 'hip_hop', 'hip_hop'],
    ['hip-hop', 'hip_hop', 'hip_hop'],
    ['hip house', 'electronic', 'house'],
    ['trap', 'hip_hop', 'trap'],
    ['country rap', 'hip_hop', 'hip_hop'],
    ['emo rap', 'hip_hop', 'hip_hop'],
    // electronic sub-clusters
    ['house', 'electronic', 'house'],
    ['tech house', 'electronic', 'house'],
    ['bass house', 'electronic', 'bass'],
    ['drum and bass', 'electronic', 'dnb'],
    ['drum & bass', 'electronic', 'dnb'],
    ['DnB', 'electronic', 'dnb'],
    ['dubstep', 'electronic', 'bass'],
    ['indietronica', 'electronic', 'electronica'],
    // pop
    ['k-pop', 'pop', 'k_pop'],
    ['K Pop', 'pop', 'k_pop'],
    ['dance pop', 'pop', 'dance_pop'],
    ['electropop', 'pop', 'dance_pop'],
    // indie ambiguity: bare "indie" is indie rock, "indie pop" is pop
    ['indie', 'rock', 'indie_rock'],
    ['indie pop', 'pop', 'indie_pop'],
    ['post-punk', 'rock', 'indie_rock'],
    // case, diacritics, punctuation, whitespace
    ['  HOUSE  ', 'electronic', 'house'],
    ['R&B', 'soul_rnb', 'soul_rnb'],
    ['r & b', 'soul_rnb', 'soul_rnb'],
    ['Hip   Hop!', 'hip_hop', 'hip_hop'],
    // substring false positives
    ['house of pain', null, null],
    ['bravery', null, null],
    ['brave', null, null],
    ['dreamhouse', null, null],
    // unknown / empty
    ['totally unknown genre', null, null],
    ['', null, null],
    ['   ', null, null],
  ];

  it.each(classification)('classifies %j as %s/%s', (g, family, cluster) => {
    expect(classifyGenre(g)).toEqual({ family, cluster });
  });

  const similarity: [string, string, number][] = [
    ['reggaeton', 'reggae', 0],
    ['reggaeton', 'house', 0],
    ['reggaeton', 'trap latino', 0.7],
    ['reggaeton', 'latin pop', 0.35],
    ['reggaeton', 'reggaeton', 1],
    ['trap', 'trap latino', 0],
    ['hip hop', 'hip house', 0],
    ['house', 'hip house', 0.7],
    ['house', 'bass house', 0.35],
    ['drum and bass', 'dubstep', 0.35],
    ['drum and bass', 'drum & bass', 1],
    ['k-pop', 'k pop', 1],
    ['country', 'country rap', 0],
    ['house', 'totally unknown genre', 0],
    ['mystery a', 'mystery b', 0],
    ['mystery a', 'mystery a', 1],
    ['', 'house', 0],
  ];

  it.each(similarity)('similarity(%j, %j) = %s', (a, b, expected) => {
    expect(genreSimilarity(a, b)).toBe(expected);
  });

  it('is symmetric', () => {
    for (const [a, b] of similarity) {
      expect(genreSimilarity(a, b)).toBe(genreSimilarity(b, a));
    }
  });

  it('normalizeGenre tolerates non-string junk without throwing', () => {
    expect(normalizeGenre(undefined as unknown as string)).toBe('');
    expect(normalizeGenre(null as unknown as string)).toBe('');
  });

  it('handles empty and very long genre lists', () => {
    const profile = buildGenreTasteProfile({
      artistPreferences: [],
      spotifyTopArtists: [
        { id: 's1', name: 'A', rank: 1, genres: ['house'] } as never,
      ],
    });
    expect(calculateGenreFit([], profile).similarity).toBe(0);
    expect(calculateGenreFit(null, profile).hasKnownGenres).toBe(false);
    const long = Array.from({ length: 5000 }, (_, i) => `made up genre ${i}`);
    long.push('house');
    const t0 = Date.now();
    const fit = calculateGenreFit(long, profile);
    expect(fit.similarity).toBe(1);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('unknown genres are neutral: no similarity, no dislike penalty', () => {
    const profile = buildGenreTasteProfile({
      artistPreferences: [],
      spotifyTopArtists: [
        { id: 's1', name: 'A', rank: 1, genres: ['house'] } as never,
      ],
    });
    const fit = calculateGenreFit(['zzz unknown'], profile);
    expect(fit.similarity).toBe(0);
    expect(fit.dislikedGenreSimilarity).toBe(0);
  });
});
