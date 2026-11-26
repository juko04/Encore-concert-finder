// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { inferGenresFromText } from '@/lib/genres/infer';
import {
  enrichEventGenres,
  fillInferredEventGenres,
} from '@/lib/genres/enrich-event-genres';
import { GenreBadge } from '@/components/index/GenreBadge';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';
import { canonicalGenreLabel, genreDbTerms } from '@/lib/genres/catalog-genres';
import type { Event } from '@/lib/domain/catalog';

afterEach(cleanup);

describe('inferGenresFromText', () => {
  it.each([
    ['Yonder Mountain String Band w/ Remedy Tree', 'Bluegrass'],
    [
      'Billy Failing Holiday Sleigh Ride w/ Broken Compass Bluegrass',
      'Bluegrass',
    ],
    ['Jazz at the Piano Bar', 'Jazz'],
    ['Latin Night', 'Latin'],
    ['Noche Sonidera', 'Latin'],
    ['Metal Monday: Thrash Attack', 'Metal'],
    ['Emo Night: 2000s Edition', 'Punk'],
    ['Hip Hop Open Mic', 'Hip Hop'],
    ['Deep House Sessions', 'Electronic'],
    ['Techno Tuesday', 'Electronic'],
    ['Colorado Symphony Orchestra presents Beethoven', 'Classical'],
    ['Gospel Brunch', 'Gospel'],
    ['Reggae Sunday', 'Reggae'],
    ['Songwriter Showcase', 'Folk'],
    ['Classic Rock Tribute Night', 'Rock'],
    ['Funk Friday', 'Funk'],
    ['All The Feels R&B with DJ TGIF', 'R&B'],
    ['Horsetooth Honky Tonk', 'Country'],
    ['Colorado Symphony Orchestra presents Holiday Brass', 'Classical'],
  ])('infers a genre from "%s"', (title, genre) => {
    expect(inferGenresFromText(title).genres).toContain(genre);
  });

  it('treats a leading DJ billing as an electronic set', () => {
    expect(inferGenresFromText('DJ Kelly Kix').genres).toEqual(['Electronic']);
    expect(inferGenresFromText('Friday Night', ['DJ Spinz']).genres).toEqual([
      'Electronic',
    ]);
  });

  it('never guesses from a bare band name', () => {
    for (const t of [
      'Ripe',
      "Where's West",
      'The Sways',
      'Cracked Ribs w/ Now If Ever, Disruptive Impulse + My Expired Affection',
      'John Hollier & the Rêverie',
      'almost a.m. w/ moony',
      'Donavon Frankenreiter',
      '',
    ]) {
      expect(inferGenresFromText(t).genres).toEqual([]);
    }
    expect(inferGenresFromText(null).genres).toEqual([]);
    expect(inferGenresFromText(undefined).genres).toEqual([]);
  });

  it('guards known false positives', () => {
    for (const t of [
      'Blues Traveler',
      'Soul Asylum',
      'MF DOOM Tribute',
      'Jazz Is Dead',
      'House Party',
      'Country Club Night',
      'Full House Comedy',
    ]) {
      expect(inferGenresFromText(t).genres).toEqual([]);
    }
    // An 'Orchestra' in an act's name is not classical music by itself.
    for (const t of [
      'DeadPhish Orchestra w/ RADO',
      'Electric Light Orchestra Tribute',
    ]) {
      expect(inferGenresFromText(t).genres).toEqual([]);
    }
  });

  it('returns at most two genres with the phrase they came from', () => {
    const r = inferGenresFromText('Latin Jazz Funk Fusion Night');
    expect(r.genres.length).toBeLessThanOrEqual(2);
    expect(r.evidence.every((e) => e.phrase.length > 0)).toBe(true);
  });

  it('produces strings the shared vocabulary can label', () => {
    expect(
      canonicalGenreLabel(inferGenresFromText('Bluegrass Jam').genres[0]),
    ).toBe('Country');
    expect(
      canonicalGenreLabel(inferGenresFromText('Jazz Night').genres[0]),
    ).toBe('Jazz');
    expect(
      canonicalGenreLabel(inferGenresFromText('Latin Night').genres[0]),
    ).toBe('Latin');
    expect(
      canonicalGenreLabel(inferGenresFromText('Hip Hop Night').genres[0]),
    ).toBe('Hip-Hop');
  });
});

describe('inferred genre strings are found by the matching filter label', () => {
  it.each([
    ['Funk Friday', 'R&B'],
    ['Gospel Brunch', 'R&B'],
    ['Bluegrass Jam', 'Country'],
    ['Ska Night', 'Punk'],
    ['Latin Night', 'Latin'],
    ['Jazz Night', 'Jazz'],
    ['Hip Hop Night', 'Hip-Hop'],
    ['Techno Tuesday', 'Electronic'],
    ['Symphony Pops', 'Classical'],
  ])('"%s" is matched by the "%s" filter', (title, label) => {
    const genres = inferGenresFromText(title).genres;
    expect(genres.length).toBeGreaterThan(0);
    // Same two checks the site uses: the badge label and the DB-side filter terms.
    expect(canonicalGenreLabel(genres[0])).toBe(label);
    const terms = genreDbTerms(label);
    expect(
      terms.some((t) => genres.some((g) => g.toLowerCase().includes(t))),
    ).toBe(true);
  });
});

describe('fill-if-empty writes with provenance', () => {
  async function seedEvent(genres: string[] = []) {
    const repo = new MemoryCatalogRepository();
    const id = 'e0000000-0000-0000-0000-000000000001';
    repo.events.set(id, {
      id,
      name: 'Bluegrass Jam',
      normalizedName: 'bluegrass jam',
      eventKind: 'concert',
      status: 'scheduled',
      timezone: 'America/Denver',
      localStartDate: '2040-01-01',
      startTimePrecision: 'date_only',
      isMultiDay: false,
      venueId: 'v',
      genres,
      genre: genres[0] ?? null,
    } as unknown as Event);
    return { repo, id };
  }

  it('writes inferred genres with their source when the event has none', async () => {
    const { repo, id } = await seedEvent();
    const res = await enrichEventGenres(
      {
        eventId: id,
        title: 'Bluegrass Jam',
        artists: [{ name: 'Local Band' }],
      },
      { repo },
    );
    expect(res).toMatchObject({
      genres: ['Bluegrass'],
      source: 'inferred_title',
      written: true,
    });
    expect(repo.events.get(id)).toMatchObject({
      genre: 'Bluegrass',
      genres: ['Bluegrass'],
      genresSource: 'inferred_title',
    });
  });

  it('never overwrites genres the event already has', async () => {
    const { repo, id } = await seedEvent(['Rock']);
    const res = await enrichEventGenres(
      { eventId: id, title: 'Bluegrass Jam', artists: [] },
      { repo },
    );
    expect(res.written).toBe(false);
    expect(repo.events.get(id)?.genres).toEqual(['Rock']);
  });

  it('prefers an exact-name Ticketmaster lookup for the headliner over title words', async () => {
    const { repo, id } = await seedEvent();
    const lookup = vi.fn(async () => ['Alternative', 'Indie Rock']);
    const res = await enrichEventGenres(
      { eventId: id, title: 'Bluegrass Jam', artists: [{ name: 'Lettuce' }] },
      { repo, lookup },
    );
    expect(lookup).toHaveBeenCalledWith('Lettuce');
    expect(res.source).toBe('ticketmaster_attraction');
    expect(repo.events.get(id)?.genresSource).toBe('ticketmaster_attraction');
  });

  it('falls back to the title when the lookup finds nothing or throws', async () => {
    for (const lookup of [
      vi.fn(async () => null),
      vi.fn(async () => {
        throw new Error('boom');
      }),
    ]) {
      const { repo, id } = await seedEvent();
      const res = await enrichEventGenres(
        { eventId: id, title: 'Jazz Night', artists: [{ name: 'Some Trio' }] },
        { repo, lookup },
      );
      expect(res.source).toBe('inferred_title');
    }
  });

  it('ingestion hook infers only when the candidate carries no genre of its own', async () => {
    const { repo, id } = await seedEvent();
    expect(
      await fillInferredEventGenres(repo, id, {
        title: 'Latin Night',
        artistNames: [],
        rawPayload: { genres: ['Dance/Electronic'] },
      }),
    ).toBe(false);
    expect(
      await fillInferredEventGenres(repo, id, {
        title: 'Latin Night',
        artistNames: [],
        rawPayload: {},
      }),
    ).toBe(true);
    expect(repo.events.get(id)?.genresSource).toBe('inferred_title');
    expect(
      await fillInferredEventGenres(repo, null, {
        title: 'x',
        artistNames: [],
        rawPayload: {},
      }),
    ).toBe(false);
  });
});

describe('GenreBadge inferred marker', () => {
  it('marks inferred genres with a dashed border and an explanatory title', () => {
    const { getByTestId } = render(<GenreBadge genre={['Jazz']} inferred />);
    const badge = getByTestId('genre-badge');
    expect(badge.getAttribute('data-inferred')).toBe('true');
    expect(badge.getAttribute('title')).toMatch(/inferred/i);
    expect(badge.className).toContain('border-dashed');
  });

  it('shows source genres plainly', () => {
    const { getByTestId } = render(<GenreBadge genre={['Jazz']} />);
    const badge = getByTestId('genre-badge');
    expect(badge.getAttribute('data-inferred')).toBeNull();
    expect(badge.getAttribute('title')).toBeNull();
    expect(badge.className).not.toContain('border-dashed');
  });
});
