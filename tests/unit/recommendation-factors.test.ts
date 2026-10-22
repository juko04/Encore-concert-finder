import { describe, expect, it } from 'vitest';
import {
  ARTIST_PREFERENCE_SCORES,
  calculateArtistInterestFactor,
  UNMARKED_ARTIST_SCORE,
} from '@/lib/recommendation/factors/artist-interest';
import {
  calculateDistanceFactor,
  calculateHaversineDistanceMiles,
  DEFAULT_RADIUS_MILES,
  NEUTRAL_DISTANCE_SCORE,
} from '@/lib/recommendation/factors/distance';
import {
  calculatePriceFactor,
  NEUTRAL_PRICE_SCORE,
} from '@/lib/recommendation/factors/price';
import {
  calculateTimingFactor,
  getDayOfWeekFromDateString,
  NEUTRAL_TIMING_SCORE,
} from '@/lib/recommendation/factors/timing';
import type { UserArtistPreference } from '@/lib/domain/user-preference';

describe('Recommendation Factors (Independent Factor Unit Tests)', () => {
  describe('Factor 1: Artist Interest', () => {
    const preferences: UserArtistPreference[] = [
      {
        id: 'pref-1',
        userId: 'u1',
        artistId: 'canon-cure-1',
        artistName: 'The Cure',
        normalizedArtistName: 'the cure',
        preferenceLevel: 'favorite',
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      },
      {
        id: 'pref-2',
        userId: 'u1',
        artistId: 'canon-aurora-2',
        artistName: 'Aurora',
        normalizedArtistName: 'aurora',
        preferenceLevel: 'like',
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      },
      {
        id: 'pref-3',
        userId: 'u1',
        artistId: 'canon-chappell-3',
        artistName: 'Chappell Roan',
        normalizedArtistName: 'chappell roan',
        preferenceLevel: 'interested',
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      },
      {
        id: 'pref-4',
        userId: 'u1',
        artistId: 'canon-disliked-4',
        artistName: 'Bad Band',
        normalizedArtistName: 'bad band',
        preferenceLevel: 'dislike',
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      },
      {
        id: 'pref-5',
        userId: 'u1',
        artistId: 'canon-samename-rock',
        artistName: 'John Smith (Rock)',
        normalizedArtistName: 'john smith',
        preferenceLevel: 'favorite',
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ];

    it('scores Favorite preference as 100', () => {
      const res = calculateArtistInterestFactor(
        [{ id: 'canon-cure-1', name: 'The Cure' }],
        preferences,
      );
      expect(res.factorScore.score).toBe(100);
      expect(res.factorScore.fieldStatus).toBe('verified');
      expect(res.isSuppressed).toBe(false);
      expect(res.matchedArtist?.preferenceLevel).toBe('favorite');
    });

    it('scores Like preference as 75', () => {
      const res = calculateArtistInterestFactor(
        [{ id: 'canon-aurora-2', name: 'Aurora' }],
        preferences,
      );
      expect(res.factorScore.score).toBe(75);
      expect(res.factorScore.fieldStatus).toBe('verified');
      expect(res.isSuppressed).toBe(false);
      expect(res.matchedArtist?.preferenceLevel).toBe('like');
    });

    it('scores Interested preference as 55', () => {
      const res = calculateArtistInterestFactor(
        [{ id: 'canon-chappell-3', name: 'Chappell Roan' }],
        preferences,
      );
      expect(res.factorScore.score).toBe(55);
      expect(res.factorScore.fieldStatus).toBe('verified');
      expect(res.isSuppressed).toBe(false);
      expect(res.matchedArtist?.preferenceLevel).toBe('interested');
    });

    it('scores Unmarked artist with neutral exploratory score of 40', () => {
      const res = calculateArtistInterestFactor(
        [{ id: 'canon-unknown-99', name: 'Unknown Indie Band' }],
        preferences,
      );
      expect(res.factorScore.score).toBe(UNMARKED_ARTIST_SCORE);
      expect(res.factorScore.fieldStatus).toBe('neutral_missing');
      expect(res.isExploratory).toBe(true);
      expect(res.isSuppressed).toBe(false);
      expect(res.matchedArtist).toBeUndefined();
    });

    it('suppresses event when an artist is marked Not Interested (dislike)', () => {
      const res = calculateArtistInterestFactor(
        [{ id: 'canon-disliked-4', name: 'Bad Band' }],
        preferences,
      );
      expect(res.factorScore.score).toBe(0);
      expect(res.factorScore.fieldStatus).toBe('suppressed');
      expect(res.isSuppressed).toBe(true);
      expect(res.suppressionReason).toContain('Not Interested');
    });

    it('handles multi-artist lineups by picking highest affinity without double-counting', () => {
      // Lineup has Liked artist (Aurora, 75) and Favorite artist (The Cure, 100)
      const res = calculateArtistInterestFactor(
        [
          {
            id: 'canon-aurora-2',
            name: 'Aurora',
            billingPosition: 'headliner',
          },
          { id: 'canon-cure-1', name: 'The Cure', billingPosition: 'support' },
        ],
        preferences,
      );
      // Invariant: highest affinity determines score (100, NOT 100+75=175)
      expect(res.factorScore.score).toBe(100);
      expect(res.matchedArtist?.name).toBe('The Cure');
      expect(res.factorScore.explanation).toContain('+1 more on lineup');
    });

    it('suppresses multi-artist lineup if any artist on the bill is Disliked', () => {
      // Favorite headliner, but disliked support
      const res = calculateArtistInterestFactor(
        [
          {
            id: 'canon-cure-1',
            name: 'The Cure',
            billingPosition: 'headliner',
          },
          {
            id: 'canon-disliked-4',
            name: 'Bad Band',
            billingPosition: 'support',
          },
        ],
        preferences,
      );
      expect(res.factorScore.score).toBe(0);
      expect(res.isSuppressed).toBe(true);
      expect(res.suppressionReason).toContain('Bad Band');
    });

    it('disambiguates identical artist names using canonical artist IDs strictly', () => {
      // Two different artists named "John Smith"
      // User has marked "canon-samename-rock" as Favorite
      const rockRes = calculateArtistInterestFactor(
        [{ id: 'canon-samename-rock', name: 'John Smith' }],
        preferences,
      );
      expect(rockRes.factorScore.score).toBe(100);
      expect(rockRes.isExploratory).toBe(false);

      // "canon-samename-jazz" has the same name, but is NOT in user preferences
      const jazzRes = calculateArtistInterestFactor(
        [{ id: 'canon-samename-jazz', name: 'John Smith' }],
        preferences,
      );
      expect(jazzRes.factorScore.score).toBe(UNMARKED_ARTIST_SCORE);
      expect(jazzRes.isExploratory).toBe(true);
    });

    it('gives precedence to recent explicit preference changes over earlier ones', () => {
      const conflictingPreferences: UserArtistPreference[] = [
        {
          id: 'pref-old',
          userId: 'u1',
          artistId: 'artist-dynamic-1',
          artistName: 'Dynamic Artist',
          normalizedArtistName: 'dynamic artist',
          preferenceLevel: 'dislike',
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        },
        {
          id: 'pref-new',
          userId: 'u1',
          artistId: 'artist-dynamic-1',
          artistName: 'Dynamic Artist',
          normalizedArtistName: 'dynamic artist',
          preferenceLevel: 'favorite',
          createdAt: '2026-10-15T00:00:00Z',
          updatedAt: '2026-10-15T00:00:00Z',
        },
      ];

      const res = calculateArtistInterestFactor(
        [{ id: 'artist-dynamic-1', name: 'Dynamic Artist' }],
        conflictingPreferences,
      );

      // Recent 'favorite' must override earlier 'dislike'
      expect(res.factorScore.score).toBe(100);
      expect(res.isSuppressed).toBe(false);
      expect(res.matchedArtist?.preferenceLevel).toBe('favorite');
    });
  });

  describe('Factor 2: Distance & Travel Practicality', () => {
    const userLat = 39.7392;
    const userLng = -104.9903; // Denver center

    it('returns documented neutral score (50) when user coordinates are missing', () => {
      const res = calculateDistanceFactor({
        userLat: null,
        userLng: null,
        venueLat: 39.6654,
        venueLng: -105.2057,
      });
      expect(res.factorScore.score).toBe(NEUTRAL_DISTANCE_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(res.factorScore.fieldStatus).toBe('neutral_missing');
      expect(res.distanceMiles).toBeNull();
    });

    it('returns documented neutral score (50) when venue coordinates are missing', () => {
      const res = calculateDistanceFactor({
        userLat,
        userLng,
        venueLat: null,
        venueLng: null,
      });
      expect(res.factorScore.score).toBe(NEUTRAL_DISTANCE_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(res.distanceMiles).toBeNull();
    });

    it('scores 100 for event at user location (0 miles)', () => {
      const res = calculateDistanceFactor({
        userLat,
        userLng,
        venueLat: userLat,
        venueLng: userLng,
        preferredRadiusMiles: 25,
      });
      expect(res.factorScore.score).toBe(100);
      expect(res.distanceMiles).toBe(0);
    });

    it('scales smoothly within preferred radius', () => {
      // Red Rocks is ~12.5 miles from user
      const res = calculateDistanceFactor({
        userLat,
        userLng,
        venueLat: 39.6654,
        venueLng: -105.2057,
        preferredRadiusMiles: 25,
      });
      expect(res.distanceMiles).toBeGreaterThan(11);
      expect(res.distanceMiles).toBeLessThan(14);
      // Roughly half of 25 mi radius, score should be between 80 and 85
      expect(res.factorScore.score).toBeGreaterThan(80);
      expect(res.factorScore.score).toBeLessThan(85);
      expect(res.factorScore.explanation).toContain('Close to home');
    });

    it('decays beyond preferred radius', () => {
      // Colorado Springs is ~52 miles from user (well beyond 25 mi radius)
      const res = calculateDistanceFactor({
        userLat,
        userLng,
        venueLat: 38.995,
        venueLng: -104.81,
        preferredRadiusMiles: 25,
        isFavoriteArtist: false,
      });
      expect(res.distanceMiles).toBeGreaterThan(50);
      expect(res.factorScore.score).toBeLessThan(40);
      expect(res.factorScore.explanation).toContain(
        'beyond your 25 mi preferred radius',
      );
    });

    it('supports favorite artist distance elasticity for shows farther away', () => {
      // Colorado Springs with Favorite artist vs Non-favorite
      const normalRes = calculateDistanceFactor({
        userLat,
        userLng,
        venueLat: 38.995,
        venueLng: -104.81,
        preferredRadiusMiles: 25,
        isFavoriteArtist: false,
      });

      const favoriteRes = calculateDistanceFactor({
        userLat,
        userLng,
        venueLat: 38.995,
        venueLng: -104.81,
        preferredRadiusMiles: 25,
        isFavoriteArtist: true,
      });

      // Favorite artist must receive a higher distance utility score for the same distance
      expect(favoriteRes.factorScore.score).toBeGreaterThan(
        normalRes.factorScore.score,
      );
    });

    it('operates correctly across arbitrary non-Colorado coordinates (London to Oxford)', () => {
      // London (51.5074, -0.1278) to Oxford (51.7520, -1.2577) ~ 51.7 miles
      const dist = calculateHaversineDistanceMiles(
        51.5074,
        -0.1278,
        51.752,
        -1.2577,
      );
      expect(dist).toBeGreaterThan(50);
      expect(dist).toBeLessThan(55);
    });
  });

  describe('Factor 3: Ticket Price Affordability', () => {
    it('returns documented neutral score (50) when price is missing (never treated as free)', () => {
      const res = calculatePriceFactor({
        minPrice: null,
        maxPrice: null,
      });
      // Invariant: Missing price is NEVER 100 or 0
      expect(res.factorScore.score).toBe(NEUTRAL_PRICE_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(res.factorScore.fieldStatus).toBe('neutral_missing');
      expect(res.factorScore.explanation).toContain('Price TBA');
    });

    it('scores free events (minPrice === 0) as 100', () => {
      const res = calculatePriceFactor({
        minPrice: 0,
        maxPrice: 0,
      });
      expect(res.factorScore.score).toBe(100);
      expect(res.factorScore.explanation).toContain('Free event');
    });

    it('scores free event by eventKind', () => {
      const res = calculatePriceFactor({
        minPrice: null,
        eventKind: 'free_event',
      });
      expect(res.factorScore.score).toBe(100);
      expect(res.factorScore.explanation).toContain('Free event');
    });

    it('scores comfortably under budget tickets with high affordability (100)', () => {
      const res = calculatePriceFactor({
        minPrice: 20,
        maxNormalTicketPrice: 60,
        artistPreferenceLevel: 'like',
      });
      // 20 is <= 0.5 * 60 = 30
      expect(res.factorScore.score).toBe(100);
      expect(res.factorScore.explanation).toContain('Exceptional value');
    });

    it('scales within normal budget', () => {
      const res = calculatePriceFactor({
        minPrice: 50,
        maxNormalTicketPrice: 60,
        artistPreferenceLevel: 'like',
      });
      // 50 is between 30 and 60
      expect(res.factorScore.score).toBeGreaterThanOrEqual(75);
      expect(res.factorScore.score).toBeLessThan(100);
    });

    it('uses higher budget ceiling for Favorite artists', () => {
      // Ticket is $120. For normal artist with budget $60, this is 2x budget!
      const normalRes = calculatePriceFactor({
        minPrice: 120,
        maxNormalTicketPrice: 60,
        maxFavoriteArtistPrice: 150,
        artistPreferenceLevel: 'like',
      });

      // For favorite artist with budget ceiling $150, $120 is within budget!
      const favoriteRes = calculatePriceFactor({
        minPrice: 120,
        maxNormalTicketPrice: 60,
        maxFavoriteArtistPrice: 150,
        artistPreferenceLevel: 'favorite',
      });

      expect(favoriteRes.factorScore.score).toBeGreaterThan(
        normalRes.factorScore.score,
      );
      expect(favoriteRes.factorScore.score).toBeGreaterThanOrEqual(75);
      expect(normalRes.factorScore.score).toBeLessThanOrEqual(40);
    });
  });

  describe('Factor 4: Event Timing Suitability', () => {
    it('returns documented neutral score (50) when user has no custom timing preferences', () => {
      const res = calculateTimingFactor({
        localStartDate: '2026-11-15',
        referenceDate: '2026-11-01',
        preferredDays: null,
      });
      // Invariant: Never invents weekend preferences
      expect(res.factorScore.score).toBe(NEUTRAL_TIMING_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(res.factorScore.explanation).toContain('no custom availability');
      expect(res.isPast).toBe(false);
    });

    it('correctly determines day of week from date string deterministically', () => {
      // 2026-11-15 is Sunday
      expect(getDayOfWeekFromDateString('2026-11-15')).toBe('sunday');
      // 2026-11-14 is Saturday
      expect(getDayOfWeekFromDateString('2026-11-14')).toBe('saturday');
      // 2026-11-13 is Friday
      expect(getDayOfWeekFromDateString('2026-11-13')).toBe('friday');
    });

    it('scores preferred days with high convenience (90)', () => {
      const res = calculateTimingFactor({
        localStartDate: '2026-11-14', // Saturday
        referenceDate: '2026-11-01',
        preferredDays: ['friday', 'saturday'],
      });
      expect(res.factorScore.score).toBe(90);
      expect(res.factorScore.isAvailable).toBe(true);
      expect(res.factorScore.explanation).toContain('Convenient timing');
    });

    it('scores non-preferred days lower (40)', () => {
      const res = calculateTimingFactor({
        localStartDate: '2026-11-16', // Monday
        referenceDate: '2026-11-01',
        preferredDays: ['friday', 'saturday'],
      });
      expect(res.factorScore.score).toBe(40);
      expect(res.factorScore.isAvailable).toBe(true);
      expect(res.factorScore.explanation).toContain(
        'outside your preferred days',
      );
    });

    it('flags past events as isPast=true', () => {
      const res = calculateTimingFactor({
        localStartDate: '2026-10-15',
        referenceDate: '2026-11-01',
      });
      expect(res.isPast).toBe(true);
    });
  });
});
