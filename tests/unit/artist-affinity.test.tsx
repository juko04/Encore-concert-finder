import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import {
  annotateEventWithArtistAffinity,
  createArtistAffinityResolver,
  sortArtistsByAffinity,
} from '@/lib/recommendation/artist-affinity';
import { SupportActsLine } from '@/components/index/SupportActsLine';
import type { UserArtistPreference } from '@/lib/domain/user-preference';
import type { SpotifyTopArtist } from '@/lib/domain/spotify';

const pref = (
  artistId: string,
  level: UserArtistPreference['preferenceLevel'],
): UserArtistPreference => ({
  id: `p-${artistId}`,
  userId: 'u',
  artistId,
  artistName: artistId,
  normalizedArtistName: artistId,
  preferenceLevel: level,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const top = (
  id: string,
  rank: number,
  canonicalArtistId?: string | null,
): SpotifyTopArtist => ({
  id,
  name: id,
  rank,
  imageUrl: null,
  spotifyUrl: '',
  genres: [],
  popularity: 50,
  timeRange: 'short_term',
  ...(canonicalArtistId !== undefined ? { canonicalArtistId } : {}),
});

describe('artist affinity resolver', () => {
  const resolve = createArtistAffinityResolver(
    [
      pref('fav', 'favorite'),
      pref('lk', 'like'),
      pref('int', 'interested'),
      pref('no', 'dislike'),
    ],
    [top('sp-1', 1), top('sp-canon', 2, 'canon-sp'), top('sp-no', 3, 'no')],
  );

  it('ranks favorites above likes, ignores unmarked and disliked artists', () => {
    expect(resolve({ id: 'fav', name: 'Fav' })).toMatchObject({
      score: 100,
      level: 'favorite',
    });
    expect(resolve({ id: 'lk', name: 'Lk' })).toMatchObject({
      score: 75,
      level: 'like',
    });
    expect(resolve({ id: 'int', name: 'Int' })).toMatchObject({
      score: 55,
      level: 'interested',
    });
    expect(resolve({ id: 'zzz', name: 'Nobody' })).toBeNull();
    expect(resolve({ id: 'no', name: 'No' })).toBeNull();
  });

  it('uses Spotify listening below explicit likes, matched by Spotify id or canonical id', () => {
    const a = resolve({ id: 'x', name: 'X', spotifyArtistId: 'sp-1' });
    expect(a?.level).toBe('spotify');
    expect(a?.score).toBeLessThan(75);
    expect(a?.spotifyRank).toBe(1);

    const byCanonical = resolve({ id: 'canon-sp', name: 'Canon Spotify' });
    expect(byCanonical?.level).toBe('spotify');
    expect(byCanonical?.spotifyRank).toBe(2);
  });

  it('gives explicit preferences precedence over Spotify listening and respects dislikes', () => {
    const resolvePrefOverSpotify = createArtistAffinityResolver(
      [pref('canon-int', 'interested')],
      [top('sp-int', 1, 'canon-int')],
    );
    expect(
      resolvePrefOverSpotify({
        id: 'canon-int',
        name: 'Interested Act',
        spotifyArtistId: 'sp-int',
      }),
    ).toMatchObject({ score: 55, level: 'interested' });

    expect(
      resolve({ id: 'no', name: 'Disliked Spotify', spotifyArtistId: 'sp-no' }),
    ).toBeNull();
  });

  it('never matches by name alone', () => {
    expect(resolve({ name: 'fav' })).toBeNull();
  });

  it('marks nothing for a user with no signals', () => {
    expect(
      createArtistAffinityResolver([], [])({ id: 'fav', name: 'F' }),
    ).toBeNull();
  });
});

describe('ordering and annotation', () => {
  it('sorts liked artists first, highest first, stable for the rest', () => {
    const out = sortArtistsByAffinity([
      { name: 'a' },
      { name: 'b', affinity: { score: 75, level: 'like' as const } },
      { name: 'c' },
      { name: 'd', affinity: { score: 100, level: 'favorite' as const } },
      { name: 'e', affinity: { score: 70, level: 'spotify' as const } },
    ]);
    expect(out.map((x) => x.name)).toEqual(['d', 'b', 'e', 'a', 'c']);
  });

  it('annotates plain and scored events without mutating and strips stale affinity on re-annotation', () => {
    const resolve = createArtistAffinityResolver([pref('fav', 'favorite')], []);
    const plain = {
      artists: [
        { id: 'fav', name: 'F' },
        { id: 'o', name: 'O' },
      ],
    };
    const out = annotateEventWithArtistAffinity(plain, resolve);
    expect(out.artists[0]).toMatchObject({ affinity: { score: 100 } });
    expect(out.artists[1]).not.toHaveProperty('affinity');
    expect(plain.artists[0]).not.toHaveProperty('affinity');
    const cleared = annotateEventWithArtistAffinity(out, () => null);
    expect(cleared.artists[0]).not.toHaveProperty('affinity');
    expect(out.artists[0]).toMatchObject({ affinity: { score: 100 } });

    const scored = annotateEventWithArtistAffinity(
      { event: plain, score: 1 },
      resolve,
    );
    expect(scored.event.artists[0]).toMatchObject({
      affinity: { level: 'favorite' },
    });
  });
});

describe('SupportActsLine', () => {
  it('lists liked acts first with a marker and screen-reader label, plain for guests', () => {
    const html = renderToStaticMarkup(
      <SupportActsLine
        className="line-clamp-1 text-xs"
        acts={[
          { name: 'Plain Opener' },
          { name: 'Spotify Opener', affinity: { score: 70, level: 'spotify' } },
          { name: 'Dear Fav', affinity: { score: 100, level: 'favorite' } },
        ]}
      />,
    );
    expect(html.indexOf('Dear Fav')).toBeLessThan(
      html.indexOf('Spotify Opener'),
    );
    expect(html.indexOf('Spotify Opener')).toBeLessThan(
      html.indexOf('Plain Opener'),
    );
    expect(html).toContain('data-testid="liked-artist"');
    expect(html).toContain('aria-hidden="true">♥ </span>');
    expect(html).toContain('class="sr-only"> (a favorite)</span>');
    expect(html).toContain(
      'class="sr-only"> (in your Spotify listening)</span>',
    );
    expect(html).toContain('class="line-clamp-1 text-xs"');

    const guest = renderToStaticMarkup(
      <SupportActsLine acts={[{ name: 'A' }, { name: 'B' }]} />,
    );
    expect(guest).not.toContain('liked-artist');
    expect(guest).not.toContain('sr-only');
    expect(guest).toContain('A');
  });

  it('renders nothing without support acts or only blank names', () => {
    expect(renderToStaticMarkup(<SupportActsLine acts={[]} />)).toBe('');
    expect(
      renderToStaticMarkup(<SupportActsLine acts={[{ name: '  ' }]} />),
    ).toBe('');
  });
});
