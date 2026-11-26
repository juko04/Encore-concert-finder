import { describe, it, expect } from 'vitest';
import {
  canonicalGenreLabel,
  displayGenreLabel,
  eventDisplayGenreLabel,
  eventGenreList,
  eventMatchesGenre,
  genreBadgeClasses,
  genreDbTerms,
  genreMatchesQuery,
  normalizeGenreFacets,
  resolveGenreQuery,
  MIXED_GENRE_LABEL,
} from '@/lib/genres/catalog-genres';

describe('shared catalog genres', () => {
  it('drops non-genres in one place', () => {
    for (const raw of [
      'Live Music',
      "Children's Music",
      'French Music',
      'World Music',
      'Rodeo',
    ]) {
      expect(canonicalGenreLabel(raw)).toBeNull();
      expect(displayGenreLabel(raw)).toBeNull();
    }
    expect(
      normalizeGenreFacets(['Live Music', 'Rodeo', 'Rock', 'Hip-Hop/Rap']),
    ).toEqual(['Hip-Hop', 'Rock']);
  });

  it('degrades gracefully for unknown or malformed input', () => {
    expect(displayGenreLabel('Zorblax Fusion')).toBeNull();
    expect(displayGenreLabel(undefined)).toBeNull();
    expect(displayGenreLabel(null)).toBeNull();
    expect(canonicalGenreLabel(42 as unknown)).toBeNull();
    expect(normalizeGenreFacets(undefined)).toEqual([]);
    expect(normalizeGenreFacets([null, 5, ''] as unknown[])).toEqual([]);
    expect(genreBadgeClasses(null)).toContain('zinc');
    expect(genreBadgeClasses('Nope')).toContain('zinc');
  });

  it('maps raw source strings through the taxonomy', () => {
    expect(canonicalGenreLabel('Hip-Hop/Rap')).toBe('Hip-Hop');
    expect(canonicalGenreLabel('Alternative Rock')).toBe('Indie');
    expect(canonicalGenreLabel('R&B')).toBe('R&B');
    expect(canonicalGenreLabel('melodic house')).toBe('Electronic');
    expect(displayGenreLabel('Rock')).toBe('Rock');
    expect(displayGenreLabel('Hip-Hop/Rap')).toBe('Hip-Hop');
  });

  it('shows Mixed for multi-genre shows', () => {
    expect(displayGenreLabel('Rock/Hip-Hop')).toBe(MIXED_GENRE_LABEL);
    expect(displayGenreLabel(['Jazz', 'Electronic'])).toBe(MIXED_GENRE_LABEL);
    expect(displayGenreLabel(['Rock', 'Live Music'])).toBe('Rock');
  });

  it('gives each genre its own badge color', () => {
    const labels = [
      'Electronic',
      'Hip-Hop',
      'Pop',
      'Rock',
      'Indie',
      'Metal',
      'Punk',
      'Country',
      'Folk',
      'Jazz',
      'Blues',
      'R&B',
      'Reggae',
      'Latin',
      'Classical',
      'Mixed',
    ];
    const classes = labels.map(genreBadgeClasses);
    expect(new Set(classes).size).toBe(labels.length);
    for (const c of classes) expect(c).toContain('dark:');
  });

  it('search aliases resolve to hip-hop', () => {
    for (const q of ['hip hop', 'Hip-Hop', 'hiphop', 'HIPHOP', 'rap']) {
      expect(resolveGenreQuery(q)).toBe('Hip-Hop');
    }
    expect(resolveGenreQuery('Red Rocks')).toBeNull();
    expect(resolveGenreQuery('')).toBeNull();
    expect(genreDbTerms('Hip-Hop')).toContain('rap');
    expect(genreDbTerms(null)).toEqual([]);
    expect(genreMatchesQuery('hip hop', 'Hip-Hop/Rap')).toBe(true);
    expect(genreMatchesQuery('rap', 'Hip-Hop')).toBe(true);
    expect(genreMatchesQuery('hiphop', 'Rock')).toBe(false);
    // plain text still works
    expect(genreMatchesQuery('roc', 'Rock')).toBe(true);
  });

  it('filter matches by canonical label and falls back to substring', () => {
    expect(eventMatchesGenre('Hip-Hop', 'Hip-Hop/Rap')).toBe(true);
    expect(eventMatchesGenre('Hip-Hop', 'Rock', ['Folk'])).toBe(false);
    expect(eventMatchesGenre('all', 'Rock')).toBe(true);
    expect(eventMatchesGenre('zorb', 'Zorblax')).toBe(true);
    expect(eventMatchesGenre('zorb', null)).toBe(false);
  });
});

describe('event genre badge uses all genre metadata', () => {
  it('shows a single genre repeated in different spellings as that genre, not Mixed', () => {
    expect(
      eventDisplayGenreLabel({
        genre: 'Hip-Hop/Rap',
        genres: ['Hip Hop', 'rap'],
        artists: [{ genres: ['hip hop'] }, { genres: ['Rap'] }],
      }),
    ).toBe('Hip-Hop');
  });

  it('is Mixed for a festival with several genres across its fields', () => {
    expect(
      eventDisplayGenreLabel({
        genre: 'Festival',
        genres: ['Rock', 'Electronic'],
        artists: [{ genres: ['jazz'] }],
      }),
    ).toBe(MIXED_GENRE_LABEL);
  });

  it('is Mixed when the artists on the bill disagree even if event.genre is a single genre', () => {
    expect(
      eventDisplayGenreLabel({
        genre: 'Rock',
        artists: [{ genres: ['hip hop'] }, { genres: ['country'] }],
      }),
    ).toBe(MIXED_GENRE_LABEL);
  });

  it('falls back to artist genres when the event has none', () => {
    expect(
      eventDisplayGenreLabel({ genre: null, artists: [{ genres: ['jazz'] }] }),
    ).toBe('Jazz');
  });

  it('ignores non-genres for Mixed', () => {
    expect(
      eventDisplayGenreLabel({
        genre: 'Rock',
        genres: ['Live Music', "Children's Music", 'French Music', 'Rodeo'],
        artists: [{ genres: ['world music'] }],
      }),
    ).toBe('Rock');
    expect(
      eventDisplayGenreLabel({ genre: 'Live Music', genres: ['Rodeo'] }),
    ).toBeNull();
  });

  it('collects all raw strings from the event and every artist', () => {
    expect(
      eventGenreList({
        genre: 'Rock',
        genres: ['Pop'],
        artists: [{ genres: ['jazz'] }, { genres: undefined }],
      }),
    ).toEqual(['Rock', 'Pop', 'jazz']);
  });
});
