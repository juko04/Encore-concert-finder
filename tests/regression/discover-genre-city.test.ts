// Genre taxonomy + dislike precedence (finding h) and Discover rows (d, e).
import { describe, expect, it } from 'vitest';
import {
  buildGenreTasteProfile,
  calculateGenreFit,
  classifyGenre,
  genreSimilarity,
} from '@/lib/recommendation/genre';
import { getDiscoverHomeData } from '@/lib/discover/home-data';
import { getDiscoverDateWindows } from '@/lib/discover/dates';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';

describe('REGRESSION genre taxonomy', () => {
  it('classifies reggaeton as Latin, not unknown/other', () => {
    const c = classifyGenre('reggaeton');
    expect(c.family).toBe('latin');
  });
  it('reggaeton is not treated as similar to techno', () => {
    expect(genreSimilarity('reggaeton', 'techno')).toBeLessThan(0.5);
  });
  it('explicit dislike keeps a similar genre from scoring as positive fit', () => {
    const profile = buildGenreTasteProfile({
      artistPreferences: [
        {
          id: 'p1',
          userId: 'u',
          artistId: 'a1',
          artistName: 'Disliked DJ',
          normalizedArtistName: 'disliked dj',
          preferenceLevel: 'dislike',
          createdAt: '',
          updatedAt: '',
          canonicalArtist: { id: 'a1', name: 'Disliked DJ', genres: ['house'] },
        } as never,
      ],
      spotifyTopArtists: [
        { id: 's2', name: 'Techno Guy', rank: 1, genres: ['techno'] } as never,
      ],
    });
    const fit = calculateGenreFit(['house'], profile);
    expect(fit.dislikedGenreSimilarity).toBeGreaterThan(0);
    // house must not be credited as a positive match through techno similarity
    // to a degree that outweighs the dislike
    expect(fit.similarity).toBeLessThanOrEqual(fit.dislikedGenreSimilarity);
  });
});

const ev = (id: string, extra: Partial<CanonicalEventSummary> = {}) =>
  ({
    id,
    title: id,
    venueName: 'V',
    venueId: 'v',
    city: 'Denver',
    region: 'CO',
    localStartDate: '2026-11-28',
    startsAt: '2026-11-28T20:00:00Z',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    eventKind: 'concert',
    artists: [],
    minPrice: 25,
    maxPrice: 40,
    currency: 'USD',
    ...extra,
  }) as CanonicalEventSummary;

describe('REGRESSION discover home rows', () => {
  const now = new Date('2026-11-24T20:00:00Z');
  const pool = Array.from({ length: 80 }, (_, i) => ev(`e${i}`));
  const calls: Array<Record<string, unknown>> = [];
  const repo = {
    listEvents: async (f: Record<string, unknown>) => {
      calls.push(f);
      return pool.slice(0, (f.limit as number) ?? 12);
    },
  };

  it('See-all hrefs carry the same filters the row was built from', async () => {
    const data = await getDiscoverHomeData({
      catalogRepo: repo as never,
      now,
      homeLocation: { city: 'Denver', state: 'CO', lat: 39.7, lng: -105 },
    });
    const w = getDiscoverDateWindows(now);
    const by = Object.fromEntries(data.rows.map((r) => [r.id, r.seeAllHref]));
    if (by['near-home']) expect(by['near-home']).toContain('city=Denver');
    if (by['weekend']) {
      expect(by['weekend']).toContain(`startDate=${w.weekend.startDate}`);
      expect(by['weekend']).toContain(`endDate=${w.weekend.endDate}`);
    }
    if (by['free']) expect(by['free']).toContain('freeOnly=true');
  });

  it('rows do not repeat the same event across sections (unintentional overlap)', async () => {
    const data = await getDiscoverHomeData({ catalogRepo: repo as never, now });
    // near-home / picked / free / under-30 may overlap on purpose; the
    // time-window and city rows must each claim their own shows.
    const exclusive = data.rows.filter((r) =>
      /weekend|next-?7|plan|city/i.test(r.id),
    );
    const ids = exclusive.flatMap((r) =>
      r.events.map((e) => (e as { id: string }).id),
    );
    const dupRatio = 1 - new Set(ids).size / Math.max(ids.length, 1);
    expect(dupRatio).toBe(0);
  });
});
