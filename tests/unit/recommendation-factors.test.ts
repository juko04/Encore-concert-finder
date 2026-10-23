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
  getLocalDateInTimezone,
  isValidIanaTimezone,
  NEUTRAL_TIMING_SCORE,
} from '@/lib/recommendation/factors/timing';
import { rankEvents } from '@/lib/recommendation/engine';
import {
  FIXTURE_ARTIST_PREFERENCES,
  FIXTURE_EVENTS,
  FIXTURE_USER_PROFILE,
} from '@/tests/fixtures/recommendation-fixtures';
import type { UserArtistPreference } from '@/lib/domain/user-preference';

describe('Recommendation Factors (Independent Factor Unit Tests)', () => {
  describe('Factor 1: Artist Interest & Identity Resolution', () => {
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
      {
        id: 'pref-spotify-only',
        userId: 'u1',
        artistId: null,
        artistName: 'Spotify Underground',
        normalizedArtistName: 'spotify underground',
        preferenceLevel: 'like',
        spotifyArtistId: 'spotify-artist-underground-777',
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      },
      {
        id: 'pref-archived',
        userId: 'u1',
        artistId: null,
        archivedArtistId: 'archived-old-band-999',
        artistName: 'Archived Legacy Band',
        normalizedArtistName: 'archived legacy band',
        preferenceLevel: 'favorite',
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
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

    it('matches an unresolved Spotify preference strictly by verified spotifyArtistId', () => {
      const res = calculateArtistInterestFactor(
        [
          {
            id: 'canon-catalog-new-88',
            name: 'Spotify Underground Live',
            spotifyArtistId: 'spotify-artist-underground-777',
          },
        ],
        preferences,
      );
      expect(res.factorScore.score).toBe(75); // 'like'
      expect(res.isExploratory).toBe(false);
      expect(res.isSuppressed).toBe(false);
    });

    it('never matches an artist by display name or normalized name alone', () => {
      // Artist shares the name "The Cure", but has a completely different canonical ID and no spotifyArtistId
      const res = calculateArtistInterestFactor(
        [{ id: 'different-imposter-id-999', name: 'The Cure' }],
        preferences,
      );
      // Invariant: MUST NOT match! Must be treated as unmarked exploratory
      expect(res.factorScore.score).toBe(UNMARKED_ARTIST_SCORE);
      expect(res.isExploratory).toBe(true);
      expect(res.matchedArtist).toBeUndefined();
    });

    it('ensures archived artist preference never matches a new canonical artist sharing the same name', () => {
      const res = calculateArtistInterestFactor(
        [{ id: 'canon-new-legacy-band', name: 'Archived Legacy Band' }],
        preferences,
      );
      // Invariant: Archived record without canonical artistId must not match new artist
      expect(res.factorScore.score).toBe(UNMARKED_ARTIST_SCORE);
      expect(res.isExploratory).toBe(true);
    });

    it('suppresses event when headliner is marked Not Interested (dislike)', () => {
      const res = calculateArtistInterestFactor(
        [
          {
            id: 'canon-disliked-4',
            name: 'Bad Band',
            billingPosition: 'headliner',
          },
        ],
        preferences,
      );
      expect(res.factorScore.score).toBe(0);
      expect(res.factorScore.fieldStatus).toBe('suppressed');
      expect(res.isSuppressed).toBe(true);
      expect(res.suppressionReason).toContain('Not Interested');
    });

    it('handles multi-artist lineups by picking highest affinity without double-counting', () => {
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
      expect(res.factorScore.score).toBe(100);
      expect(res.matchedArtist?.name).toBe('The Cure');
      expect(res.factorScore.explanation).toContain('+1 more on lineup');
    });

    it('allows Favorite headliner to take precedence when a support act is Disliked', () => {
      // Favorite headliner (The Cure), but disliked opener (Bad Band)
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
      // Invariant: Show is NOT suppressed; Favorite headliner drives attendance motivation!
      expect(res.factorScore.score).toBe(100);
      expect(res.isSuppressed).toBe(false);
      expect(res.factorScore.explanation).toContain(
        'Favorite headliner: The Cure',
      );
      expect(res.factorScore.explanation).toContain(
        'support act Bad Band is marked Not Interested',
      );
    });

    it('suppresses multi-artist lineup when headliner is NOT a favorite and support is Disliked', () => {
      // Liked headliner (Aurora), and disliked opener (Bad Band)
      const res = calculateArtistInterestFactor(
        [
          {
            id: 'canon-aurora-2',
            name: 'Aurora',
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
      const rockRes = calculateArtistInterestFactor(
        [{ id: 'canon-samename-rock', name: 'John Smith' }],
        preferences,
      );
      expect(rockRes.factorScore.score).toBe(100);
      expect(rockRes.isExploratory).toBe(false);

      const jazzRes = calculateArtistInterestFactor(
        [{ id: 'canon-samename-jazz', name: 'John Smith' }],
        preferences,
      );
      expect(jazzRes.factorScore.score).toBe(UNMARKED_ARTIST_SCORE);
      expect(jazzRes.isExploratory).toBe(true);
    });
  });

  describe('Factor 2: Distance & Travel Utility', () => {
    const userLat = 39.7392;
    const userLng = -104.9903;

    it('returns documented neutral score (50) when coordinates are missing', () => {
      const res = calculateDistanceFactor({
        userLat,
        userLng,
        venueLat: null,
        venueLng: null,
        preferredRadiusMiles: 25,
      });
      expect(res.factorScore.score).toBe(NEUTRAL_DISTANCE_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(res.factorScore.fieldStatus).toBe('neutral_missing');
    });

    it('scores nearby venues with high proximity utility', () => {
      // 0 miles away
      const zeroRes = calculateDistanceFactor({
        userLat,
        userLng,
        venueLat: userLat,
        venueLng: userLng,
        preferredRadiusMiles: 25,
      });
      expect(zeroRes.factorScore.score).toBe(100);

      // 2.5 miles away
      const res = calculateDistanceFactor({
        userLat,
        userLng,
        venueLat: 39.7402,
        venueLng: -104.945,
        preferredRadiusMiles: 25,
      });
      expect(res.factorScore.score).toBeGreaterThan(95);
      expect(res.factorScore.isAvailable).toBe(true);
      expect(res.factorScore.fieldStatus).toBe('verified');
      expect(res.factorScore.explanation).toContain('Close to home');
    });

    it('provides distance elasticity (+50% radius) for Favorite artists', () => {
      // 30 miles away: beyond normal 25-mile radius, but within 37.5-mile favorite allowance
      const venueLat = 39.3;
      const venueLng = -104.9903;

      const regularRes = calculateDistanceFactor({
        userLat,
        userLng,
        venueLat,
        venueLng,
        preferredRadiusMiles: 25,
        isFavoriteArtist: false,
      });

      const favoriteRes = calculateDistanceFactor({
        userLat,
        userLng,
        venueLat,
        venueLng,
        preferredRadiusMiles: 25,
        isFavoriteArtist: true,
      });

      expect(favoriteRes.factorScore.score).toBeGreaterThan(
        regularRes.factorScore.score,
      );
      expect(favoriteRes.factorScore.explanation).toContain(
        'Within extended travel radius for a favorite artist',
      );
    });
  });

  describe('Factor 3: Ticket Price Affordability & Currency Compatibility', () => {
    it('returns documented neutral score (50) when price is missing (never treated as free)', () => {
      const res = calculatePriceFactor({
        minPrice: null,
        maxPrice: null,
        currency: 'USD',
      });
      expect(res.factorScore.score).toBe(NEUTRAL_PRICE_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(res.factorScore.fieldStatus).toBe('neutral_missing');
      expect(res.factorScore.explanation).toContain('Price unavailable');
    });

    it('treats numeric zero without verified free status as neutral (not automatically free)', () => {
      const res = calculatePriceFactor({
        minPrice: 0,
        currency: 'USD',
        eventKind: 'concert',
      });
      expect(res.factorScore.score).toBe(NEUTRAL_PRICE_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(res.factorScore.fieldStatus).toBe('neutral_missing');
      expect(res.factorScore.explanation).toContain(
        '$0 without verified free admission',
      );
    });

    it('scores verified free events (eventKind === free_event) as 100', () => {
      const res = calculatePriceFactor({
        minPrice: 0,
        currency: 'USD',
        eventKind: 'free_event',
      });
      expect(res.factorScore.score).toBe(100);
      expect(res.factorScore.isAvailable).toBe(true);
      expect(res.factorScore.fieldStatus).toBe('verified');
      expect(res.factorScore.explanation).toContain(
        'Free event (verified free admission)',
      );
    });

    it('returns neutral score (50) when event currency is not USD (e.g. CAD, EUR)', () => {
      const cadRes = calculatePriceFactor({
        minPrice: 60,
        currency: 'CAD',
        maxNormalTicketPrice: 100,
      });
      expect(cadRes.factorScore.score).toBe(NEUTRAL_PRICE_SCORE);
      expect(cadRes.factorScore.isAvailable).toBe(false);
      expect(cadRes.factorScore.explanation).toContain(
        'Currency conversion unavailable for CAD',
      );

      const eurRes = calculatePriceFactor({
        minPrice: 50,
        currency: 'EUR',
        maxNormalTicketPrice: 100,
      });
      expect(eurRes.factorScore.score).toBe(NEUTRAL_PRICE_SCORE);
      expect(eurRes.factorScore.isAvailable).toBe(false);
      expect(eurRes.factorScore.explanation).toContain(
        'Currency conversion unavailable for EUR',
      );
    });

    it('returns neutral score (50) when ticket currency is unknown or missing', () => {
      const res = calculatePriceFactor({
        minPrice: 45,
        currency: null,
        maxNormalTicketPrice: 100,
      });
      expect(res.factorScore.score).toBe(NEUTRAL_PRICE_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(res.factorScore.explanation).toContain(
        'Ticket currency unavailable',
      );
    });

    it('treats invalid or negative ticket price as unavailable / neutral, never a bargain', () => {
      const res = calculatePriceFactor({
        minPrice: -25,
        currency: 'USD',
        maxNormalTicketPrice: 60,
      });
      expect(res.factorScore.score).toBe(NEUTRAL_PRICE_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(res.factorScore.explanation).toContain('Invalid ticket price');
    });

    it('returns neutral score when user profile has no configured ticket budget', () => {
      const res = calculatePriceFactor({
        minPrice: 50,
        currency: 'USD',
        maxNormalTicketPrice: null,
        maxFavoriteArtistPrice: null,
        maxSpontaneousPrice: null,
      });
      expect(res.factorScore.score).toBe(NEUTRAL_PRICE_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(res.factorScore.explanation).toContain(
        'no ticket budget configured in profile',
      );
    });

    it('scores comfortably under budget USD tickets with high affordability (100)', () => {
      const res = calculatePriceFactor({
        minPrice: 20,
        currency: 'USD',
        maxNormalTicketPrice: 60,
        artistPreferenceLevel: 'like',
      });
      expect(res.factorScore.score).toBe(100);
      expect(res.factorScore.explanation).toContain('Exceptional value');
    });

    it('scales within normal budget in USD', () => {
      const res = calculatePriceFactor({
        minPrice: 50,
        currency: 'USD',
        maxNormalTicketPrice: 60,
        artistPreferenceLevel: 'like',
      });
      expect(res.factorScore.score).toBeGreaterThanOrEqual(75);
      expect(res.factorScore.score).toBeLessThan(100);
    });

    it('uses higher budget ceiling for Favorite artists when explicitly configured', () => {
      const normalRes = calculatePriceFactor({
        minPrice: 120,
        currency: 'USD',
        maxNormalTicketPrice: 60,
        maxFavoriteArtistPrice: 150,
        artistPreferenceLevel: 'like',
      });

      const favoriteRes = calculatePriceFactor({
        minPrice: 120,
        currency: 'USD',
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

  describe('Factor 4: Event Timing Suitability & Timezone-Aware Eligibility', () => {
    it('validates IANA timezones and formats local calendar dates correctly', () => {
      expect(isValidIanaTimezone('America/Denver')).toBe(true);
      expect(isValidIanaTimezone('America/New_York')).toBe(true);
      expect(isValidIanaTimezone('America/Los_Angeles')).toBe(true);
      expect(isValidIanaTimezone('Invalid/Zone')).toBe(false);
      expect(isValidIanaTimezone(null)).toBe(false);

      // 03:30 UTC Nov 20 is 20:30 (Nov 19) in America/Denver (MDT/MST)
      const instant = new Date('2026-11-20T03:30:00Z');
      expect(getLocalDateInTimezone(instant, 'America/Denver')).toBe(
        '2026-11-19',
      );
    });

    it('keeps Denver event occurring today eligible when UTC has advanced to tomorrow', () => {
      // 03:30 UTC Nov 20 is 8:30 PM Nov 19 in Denver
      const nowUtcTomorrow = new Date('2026-11-20T03:30:00Z');
      const res = calculateTimingFactor({
        localStartDate: '2026-11-19',
        timezone: 'America/Denver',
        startTimePrecision: 'date_only',
        referenceInstant: nowUtcTomorrow,
      });
      // Invariant: In Denver it is still Nov 19, so today's show is NOT past!
      expect(res.isPast).toBe(false);
    });

    it('keeps Los Angeles event near midnight UTC eligible', () => {
      // 00:30 UTC Oct 23 is 17:30 (5:30 PM Oct 22) in Los Angeles (PDT)
      const nowUtcAhead = new Date('2026-10-23T00:30:00Z');
      const res = calculateTimingFactor({
        localStartDate: '2026-10-22',
        timezone: 'America/Los_Angeles',
        startTimePrecision: 'date_only',
        referenceInstant: nowUtcAhead,
      });
      expect(res.isPast).toBe(false);
    });

    it('keeps New York event close to local midnight eligible on the same day', () => {
      // 03:55 UTC Oct 23 is 23:55 (11:55 PM Oct 22) in New York (EDT)
      const nowLateNight = new Date('2026-10-23T03:55:00Z');
      const res = calculateTimingFactor({
        localStartDate: '2026-10-22',
        timezone: 'America/New_York',
        startTimePrecision: 'date_only',
        referenceInstant: nowLateNight,
      });
      expect(res.isPast).toBe(false);
    });

    it('handles Daylight Saving Time transitions gracefully', () => {
      // Denver falls back from MDT to MST on Nov 1, 2026
      const instantDuringDst = new Date('2026-10-31T18:00:00Z');
      const instantAfterDst = new Date('2026-11-02T18:00:00Z');

      expect(getLocalDateInTimezone(instantDuringDst, 'America/Denver')).toBe(
        '2026-10-31',
      );
      expect(getLocalDateInTimezone(instantAfterDst, 'America/Denver')).toBe(
        '2026-11-02',
      );
    });

    it('flags event with confirmed start time as isPast=true once its start instant has passed', () => {
      const res = calculateTimingFactor({
        localStartDate: '2026-11-20',
        startsAt: '2026-11-20T20:00:00Z',
        startTimePrecision: 'instant',
        timezone: 'America/Denver',
        referenceInstant: new Date('2026-11-20T20:30:00Z'), // 30 mins after show started
      });
      expect(res.isPast).toBe(true);
    });

    it('keeps future confirmed start time as isPast=false', () => {
      const res = calculateTimingFactor({
        localStartDate: '2026-11-20',
        startsAt: '2026-11-20T20:00:00Z',
        startTimePrecision: 'instant',
        timezone: 'America/Denver',
        referenceInstant: new Date('2026-11-20T18:00:00Z'), // 2 hours before show
      });
      expect(res.isPast).toBe(false);
    });

    it('falls back conservatively to UTC when timezone metadata is invalid or missing', () => {
      const res = calculateTimingFactor({
        localStartDate: '2026-11-20',
        timezone: 'Invalid/NonExistent_Zone',
        referenceDate: '2026-11-01',
      });
      expect(res.isPast).toBe(false);
      expect(res.factorScore.diagnostics?.timezoneValid).toBe(false);
      expect(res.factorScore.diagnostics?.effectiveTimezone).toBe('UTC');
    });

    it('flags clearly past dates as isPast=true', () => {
      const res = calculateTimingFactor({
        localStartDate: '2026-10-15',
        referenceDate: '2026-11-01',
      });
      expect(res.isPast).toBe(true);
    });

    it('returns documented neutral score (50) when user has no custom timing preferences', () => {
      const res = calculateTimingFactor({
        localStartDate: '2026-11-15',
        referenceDate: '2026-11-01',
        preferredDays: null,
      });
      expect(res.factorScore.score).toBe(NEUTRAL_TIMING_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(res.factorScore.explanation).toContain('no custom availability');
      expect(res.isPast).toBe(false);
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
  });

  describe('Factor Robustness & Finite Bounds (PR #11 Review Remediation)', () => {
    it('Scenario 1: rejects userLat = NaN and returns neutral distance score', () => {
      const res = calculateDistanceFactor({
        userLat: NaN,
        userLng: -104.9903,
        venueLat: 39.7392,
        venueLng: -104.9903,
      });

      expect(res.factorScore.score).toBe(NEUTRAL_DISTANCE_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(Number.isFinite(res.factorScore.score)).toBe(true);
      expect(res.distanceMiles).toBeNull();
    });

    it('Scenario 2: rejects venueLng = Infinity and returns neutral distance score', () => {
      const res = calculateDistanceFactor({
        userLat: 39.7392,
        userLng: -104.9903,
        venueLat: 39.7392,
        venueLng: Infinity,
      });

      expect(res.factorScore.score).toBe(NEUTRAL_DISTANCE_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(Number.isFinite(res.factorScore.score)).toBe(true);
      expect(res.distanceMiles).toBeNull();
    });

    it('Scenario 3: rejects out-of-range latitude = 91 degrees and returns neutral distance score', () => {
      const res = calculateDistanceFactor({
        userLat: 91,
        userLng: -104.9903,
        venueLat: 39.7392,
        venueLng: -104.9903,
      });

      expect(res.factorScore.score).toBe(NEUTRAL_DISTANCE_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(Number.isFinite(res.factorScore.score)).toBe(true);
      expect(res.distanceMiles).toBeNull();
    });

    it('Scenario 4: rejects out-of-range longitude = -181 degrees and returns neutral distance score', () => {
      const res = calculateDistanceFactor({
        userLat: 39.7392,
        userLng: -181,
        venueLat: 39.7392,
        venueLng: -104.9903,
      });

      expect(res.factorScore.score).toBe(NEUTRAL_DISTANCE_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(Number.isFinite(res.factorScore.score)).toBe(true);
      expect(res.distanceMiles).toBeNull();
    });

    it('Scenario 5: rejects invalid preferred radius (NaN, negative, Infinity) and safely defaults to 25 mi', () => {
      const resNaN = calculateDistanceFactor({
        userLat: 39.7392,
        userLng: -104.9903,
        venueLat: 39.7392,
        venueLng: -104.9903,
        preferredRadiusMiles: NaN,
      });
      expect(resNaN.factorScore.score).toBe(100);
      expect(Number.isFinite(resNaN.factorScore.score)).toBe(true);

      const resInf = calculateDistanceFactor({
        userLat: 39.7392,
        userLng: -104.9903,
        venueLat: 39.7392,
        venueLng: -104.9903,
        preferredRadiusMiles: Infinity,
      });
      expect(resInf.factorScore.score).toBe(100);
      expect(Number.isFinite(resInf.factorScore.score)).toBe(true);

      const resNeg = calculateDistanceFactor({
        userLat: 39.7392,
        userLng: -104.9903,
        venueLat: 39.7392,
        venueLng: -104.9903,
        preferredRadiusMiles: -10,
      });
      expect(resNeg.factorScore.score).toBe(100);
      expect(Number.isFinite(resNeg.factorScore.score)).toBe(true);
    });

    it('Scenario 6: rejects minPrice = Infinity and returns neutral price score', () => {
      const res = calculatePriceFactor({
        minPrice: Infinity,
        currency: 'USD',
        maxNormalTicketPrice: 60,
      });

      expect(res.factorScore.score).toBe(NEUTRAL_PRICE_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(res.factorScore.explanation).toContain('Invalid ticket price');
      expect(Number.isFinite(res.factorScore.score)).toBe(true);
      expect(res.minPrice).toBeNull();
    });

    it('Scenario 7: rejects maxNormalTicketPrice = Infinity and returns neutral price score', () => {
      const res = calculatePriceFactor({
        minPrice: 45,
        currency: 'USD',
        maxNormalTicketPrice: Infinity,
      });

      expect(res.factorScore.score).toBe(NEUTRAL_PRICE_SCORE);
      expect(res.factorScore.isAvailable).toBe(false);
      expect(res.factorScore.explanation).toContain(
        'no ticket budget configured',
      );
      expect(Number.isFinite(res.factorScore.score)).toBe(true);
    });

    it('Scenario 8: complete rankEvents() with invalid optional numeric inputs produces finite, bounded scores without NaN or Infinity', () => {
      const corruptedEvents = FIXTURE_EVENTS.map((event, idx) => ({
        ...event,
        lat: idx === 0 ? NaN : idx === 1 ? 95 : event.lat,
        lng: idx === 2 ? Infinity : idx === 3 ? -200 : event.lng,
        minPrice: idx === 4 ? Infinity : idx === 5 ? -99 : event.minPrice,
      }));

      const corruptedContext = {
        userProfile: {
          ...FIXTURE_USER_PROFILE,
          homeLatApprox: NaN,
          homeLngApprox: Infinity,
          defaultRadiusMiles: -50,
          maxNormalTicketPrice: Infinity,
          maxFavoriteArtistPrice: NaN,
        },
        artistPreferences: FIXTURE_ARTIST_PREFERENCES,
        presetOverride: 'balanced' as const,
      };

      const result = rankEvents(corruptedEvents, corruptedContext);

      expect(result.recommendations.length).toBeGreaterThan(0);

      // Verify every single scored event in all categories has strictly finite scores in [0, 100]
      const allScored = [
        ...result.recommendations,
        ...result.exploratory,
        ...result.suppressed,
      ];

      for (const scored of allScored) {
        expect(Number.isFinite(scored.score)).toBe(true);
        expect(scored.score).toBeGreaterThanOrEqual(0);
        expect(scored.score).toBeLessThanOrEqual(100);

        for (const fKey of ['artist', 'distance', 'price', 'timing'] as const) {
          const factor = scored.factors[fKey];
          expect(Number.isFinite(factor.score)).toBe(true);
          expect(factor.score).toBeGreaterThanOrEqual(0);
          expect(factor.score).toBeLessThanOrEqual(100);

          expect(Number.isFinite(factor.weightedContribution)).toBe(true);
          expect(factor.weightedContribution).toBeGreaterThanOrEqual(0);
          expect(factor.weightedContribution).toBeLessThanOrEqual(100);
        }
      }
    });
  });
});
