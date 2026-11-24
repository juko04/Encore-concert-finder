import { describe, it, expect } from 'vitest';
import {
  buildGenreTasteProfile,
  calculateGenreFit,
  classifyGenre,
  genreSimilarity,
} from '@/lib/recommendation/genre';
import {
  calculateArtistInterestFactor,
  GENRE_MAX_SCORE,
  UNMARKED_ARTIST_SCORE,
} from '@/lib/recommendation/factors/artist-interest';
import {
  calculatePriceFactor,
  MAX_AFFORDABILITY_SCORE,
} from '@/lib/recommendation/factors/price';
import {
  PRESET_WEIGHTS,
  validateWeightsSum,
} from '@/lib/recommendation/presets';
import { getModeScoringWeights } from '@/lib/recommendation/modes';
import { rankEvents, scoreEvent } from '@/lib/recommendation/engine';
import { buildRecommendationExplanation } from '@/lib/recommendation/explainer';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { UserArtistPreference } from '@/lib/domain/user-preference';
import type { SpotifyTopArtist } from '@/lib/domain/spotify';
import type { DiscoveryMode } from '@/lib/recommendation/types';

const JOHN_SUMMIT = {
  id: 'sp-summit',
  name: 'John Summit',
  rank: 1,
  genres: ['tech house', 'melodic house', 'house'],
  canonicalArtistId: 'canon-summit',
} as unknown as SpotifyTopArtist;

function makeEvent(
  id: string,
  artist: {
    name: string;
    genres?: string[];
    id?: string;
    spotifyArtistId?: string;
  },
  extra: Partial<CanonicalEventSummary> = {},
): CanonicalEventSummary {
  return {
    id,
    title: `${artist.name} live`,
    localStartDate: '2026-12-20',
    timezone: 'America/Denver',
    startTimePrecision: 'date_only',
    status: 'scheduled',
    eventKind: 'concert',
    artists: [
      {
        id: artist.id ?? `art-${id}`,
        name: artist.name,
        billingPosition: 'headliner',
        spotifyArtistId: artist.spotifyArtistId ?? null,
        genres: artist.genres,
      },
    ],
    ...extra,
  } as unknown as CanonicalEventSummary;
}

const context = {
  artistPreferences: [] as UserArtistPreference[],
  spotifyTopArtists: [JOHN_SUMMIT],
  referenceDate: '2026-11-24',
};

describe('genre taxonomy & similarity', () => {
  it('classifies sub-genres into clusters and families', () => {
    expect(classifyGenre('melodic house')).toEqual({
      family: 'electronic',
      cluster: 'house',
    });
    expect(classifyGenre('tech house').cluster).toBe('house');
    expect(classifyGenre('progressive house').cluster).toBe('house');
    expect(classifyGenre('bluegrass').family).toBe('country_folk');
    expect(classifyGenre('totally unknown style')).toEqual({
      family: null,
      cluster: null,
    });
  });

  it('ranks exact > same cluster > same family > unrelated', () => {
    const exact = genreSimilarity('tech house', 'tech house');
    const cluster = genreSimilarity('tech house', 'progressive house');
    const family = genreSimilarity('tech house', 'dubstep');
    const none = genreSimilarity('tech house', 'bluegrass');
    expect(exact).toBeGreaterThan(cluster);
    expect(cluster).toBeGreaterThan(family);
    expect(family).toBeGreaterThan(none);
    expect(none).toBe(0);
  });

  it('never invents similarity for unknown genre strings', () => {
    expect(genreSimilarity('zzz genre', 'qqq genre')).toBe(0);
    expect(genreSimilarity('zzz genre', 'zzz genre')).toBe(1);
  });
});

describe('genre taste profile', () => {
  it('builds positive taste from Spotify top artists weighted by rank', () => {
    const profile = buildGenreTasteProfile({
      artistPreferences: [],
      spotifyTopArtists: [
        JOHN_SUMMIT,
        {
          ...JOHN_SUMMIT,
          id: 'x',
          name: 'Far Down',
          rank: 40,
          genres: ['bluegrass'],
        } as SpotifyTopArtist,
      ],
    });
    expect(profile.isEmpty).toBe(false);
    const house = profile.positive.find((g) => g.genre === 'house');
    const blue = profile.positive.find((g) => g.genre === 'bluegrass');
    expect(house?.sourceArtist).toBe('John Summit');
    expect(house!.weight).toBeGreaterThan(blue!.weight);
  });

  it('routes explicit dislikes to the negative profile only', () => {
    const profile = buildGenreTasteProfile({
      artistPreferences: [
        {
          id: 'pref-1',
          userId: 'u',
          artistId: 'canon-summit',
          artistName: 'John Summit',
          normalizedArtistName: 'john summit',
          preferenceLevel: 'dislike',
          createdAt: '',
          updatedAt: '',
          spotifyArtistId: 'sp-summit',
        } as UserArtistPreference,
      ],
      spotifyTopArtists: [JOHN_SUMMIT],
    });
    expect(profile.positive).toHaveLength(0);
    expect(profile.negative.length).toBeGreaterThan(0);
  });

  it('is empty without any genre data', () => {
    expect(
      buildGenreTasteProfile({ artistPreferences: [], spotifyTopArtists: [] })
        .isEmpty,
    ).toBe(true);
  });
});

describe('genre-based artist fit', () => {
  const profile = buildGenreTasteProfile({
    artistPreferences: [],
    spotifyTopArtists: [JOHN_SUMMIT],
  });

  it('boosts a similar-genre artist above neutral but below a direct match', () => {
    const res = calculateArtistInterestFactor(
      [
        {
          id: 'a1',
          name: 'Chris Lake',
          billingPosition: 'headliner',
          genres: ['tech house'],
        },
      ],
      [],
      [JOHN_SUMMIT],
      profile,
    );
    expect(res.factorScore.score).toBeGreaterThan(UNMARKED_ARTIST_SCORE);
    expect(res.factorScore.score).toBeLessThanOrEqual(GENRE_MAX_SCORE);
    expect(res.factorScore.score).toBeLessThan(70); // direct Spotify top-5 match
    expect(res.isExploratory).toBe(false);
    expect(res.genreMatch?.similarTo).toBe('John Summit');
    expect(res.factorScore.explanation).toBe(
      'Similar to John Summit (tech house)',
    );
  });

  it('boosts a sibling sub-genre (progressive house) via the house cluster', () => {
    const res = calculateArtistInterestFactor(
      [
        {
          id: 'a2',
          name: 'Someone',
          billingPosition: 'headliner',
          genres: ['progressive house'],
        },
      ],
      [],
      [JOHN_SUMMIT],
      profile,
    );
    expect(res.isExploratory).toBe(false);
    expect(res.factorScore.score).toBeGreaterThan(UNMARKED_ARTIST_SCORE);
  });

  it('keeps unknown or unrelated genres neutral and exploratory', () => {
    for (const genres of [undefined, [], ['bluegrass'], ['mystery sound']]) {
      const res = calculateArtistInterestFactor(
        [{ id: 'a3', name: 'Nobody', billingPosition: 'headliner', genres }],
        [],
        [JOHN_SUMMIT],
        profile,
      );
      expect(res.factorScore.score).toBe(UNMARKED_ARTIST_SCORE);
      expect(res.isExploratory).toBe(true);
      expect(res.genreMatch).toBeUndefined();
    }
  });

  it('a direct artist match still beats any genre match', () => {
    const direct = calculateArtistInterestFactor(
      [
        {
          id: 'canon-summit',
          name: 'John Summit',
          billingPosition: 'headliner',
          spotifyArtistId: 'sp-summit',
          genres: ['tech house'],
        },
      ],
      [],
      [JOHN_SUMMIT],
      profile,
    );
    const genre = calculateGenreFit(['tech house'], profile);
    expect(direct.factorScore.score).toBe(70);
    expect(genre.similarity).toBeGreaterThan(0);
    expect(direct.factorScore.score).toBeGreaterThan(GENRE_MAX_SCORE);
  });

  it('explainer states genre similarity only from derived data', () => {
    const text = buildRecommendationExplanation({
      artistFactor: calculateArtistInterestFactor(
        [
          {
            id: 'a1',
            name: 'Chris Lake',
            billingPosition: 'headliner',
            genres: ['tech house'],
          },
        ],
        [],
        [JOHN_SUMMIT],
        profile,
      ) as never,
      distanceFactor: { isAvailable: false, score: 50 } as never,
      priceFactor: { isAvailable: false, score: 50 } as never,
      genreMatch: {
        eventGenre: 'tech house',
        tasteGenre: 'tech house',
        similarTo: 'John Summit',
        similarity: 1,
      },
      isSuppressed: false,
      isExploratory: false,
    });
    expect(text).toContain('Similar to John Summit (tech house)');
  });
});

describe('relevance gate & free-show cap', () => {
  it('caps verified-free price below 100', () => {
    const res = calculatePriceFactor({
      minPrice: 0,
      currency: 'USD',
      eventKind: 'free_event',
    });
    expect(res.factorScore.score).toBe(MAX_AFFORDABILITY_SCORE);
    expect(res.factorScore.score).toBeLessThan(100);
  });

  it('keeps unverified $0 neutral (50)', () => {
    const res = calculatePriceFactor({
      minPrice: 0,
      currency: 'USD',
      eventKind: 'concert',
    });
    expect(res.factorScore.score).toBe(50);
  });

  it('free unknown-artist show lands in exploratory and never outranks a relevant show', () => {
    const free = makeEvent(
      'free',
      { name: 'Open Mic Hero', genres: ['bluegrass'] },
      {
        eventKind: 'free_event',
        minPrice: 0,
        lat: 39.74,
        lng: -104.99,
      } as never,
    );
    const similar = makeEvent(
      'sim',
      { name: 'Chris Lake', genres: ['tech house'] },
      {
        minPrice: 60,
        currency: 'USD',
      },
    );
    const result = rankEvents([free, similar], {
      ...context,
      userProfile: {
        id: 'u',
        homeLatApprox: 39.74,
        homeLngApprox: -104.99,
        defaultRadiusMiles: 25,
        maxNormalTicketPrice: 80,
        maxSpontaneousPrice: 50,
        maxFavoriteArtistPrice: 150,
        recommendationPreset: 'balanced',
      } as never,
    });
    expect(result.recommendations.map((e) => e.eventId)).toContain('sim');
    expect(result.recommendations.map((e) => e.eventId)).not.toContain('free');
    expect(result.exploratory.map((e) => e.eventId)).toContain('free');
  });

  it('scores a no-signal show purely on price/distance below a similar-genre show at equal price', () => {
    const a = scoreEvent(
      makeEvent('a', { name: 'Unknown', genres: [] }),
      context,
    ).scoredEvent;
    const b = scoreEvent(
      makeEvent('b', { name: 'Chris Lake', genres: ['tech house'] }),
      context,
    ).scoredEvent;
    expect(b.score).toBeGreaterThan(a.score);
    expect(a.isExploratory).toBe(true);
    expect(b.isExploratory).toBe(false);
  });
});

describe('weights', () => {
  it('every preset and discovery mode sums to exactly 100 with no timing weight', () => {
    for (const w of Object.values(PRESET_WEIGHTS)) {
      expect(validateWeightsSum(w)).toBe(true);
      expect(Object.keys(w).sort()).toEqual(['artist', 'distance', 'price']);
    }
    const modes: DiscoveryMode[] = [
      'all',
      'this_weekend',
      'cheap_and_nearby',
      'worth_planning_for',
    ];
    for (const m of modes) {
      const w = getModeScoringWeights(m, PRESET_WEIGHTS.balanced);
      expect(w.artist + w.distance + w.price).toBe(100);
    }
  });

  it('exposes overrides for a future location picker and budget scale', () => {
    const ev = makeEvent('o', { name: 'X' }, {
      minPrice: 40,
      currency: 'USD',
      lat: 39.74,
      lng: -104.99,
    } as never);
    const base = scoreEvent(ev, { ...context }).scoredEvent;
    const withOverrides = scoreEvent(ev, {
      ...context,
      locationOverride: { lat: 39.74, lng: -104.99, radiusMiles: 25 },
      budgetOverride: { maxSpontaneousPrice: 100, maxNormalTicketPrice: 100 },
    }).scoredEvent;
    expect(base.factors.distance.isAvailable).toBe(false);
    expect(withOverrides.factors.distance.isAvailable).toBe(true);
    expect(withOverrides.factors.price.isAvailable).toBe(true);
  });
});
