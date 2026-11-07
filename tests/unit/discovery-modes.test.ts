import { describe, expect, it } from 'vitest';
import {
  calculateWeekendWindow,
  getModeScoringWeights,
  isEventEligibleForMode,
  isValidDiscoveryMode,
  normalizeDiscoveryMode,
} from '@/lib/recommendation/modes';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';

function makeStubEvent(
  overrides?: Partial<CanonicalEventSummary>,
): CanonicalEventSummary {
  return {
    id: 'test-event-1',
    title: 'Test Concert',
    venueName: 'Test Venue',
    venueId: 'v1',
    city: 'Denver',
    region: 'CO',
    lat: 39.7392,
    lng: -104.9903,
    localStartDate: '2026-10-30',
    startsAt: '2026-10-31T02:00:00Z',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    eventKind: 'concert',
    artists: [{ id: 'a1', name: 'Khruangbin', billingPosition: 'headliner' }],
    ticketUrl: 'https://example.com/tickets',
    minPrice: 45,
    maxPrice: 65,
    currency: 'USD',
    ...overrides,
  };
}

describe('Discovery Modes Domain Logic', () => {
  it('validates and normalizes discovery mode values', () => {
    expect(isValidDiscoveryMode('all')).toBe(true);
    expect(isValidDiscoveryMode('this_weekend')).toBe(true);
    expect(isValidDiscoveryMode('cheap_and_nearby')).toBe(true);
    expect(isValidDiscoveryMode('worth_planning_for')).toBe(true);
    expect(isValidDiscoveryMode('invalid')).toBe(false);

    expect(normalizeDiscoveryMode('this_weekend')).toBe('this_weekend');
    expect(normalizeDiscoveryMode('bogus')).toBe('all');
    expect(normalizeDiscoveryMode(undefined)).toBe('all');
  });

  describe('calculateWeekendWindow', () => {
    it('calculates Friday through Sunday window from Wednesday', () => {
      // 2026-10-28 is a Wednesday
      const window = calculateWeekendWindow('2026-10-28');
      expect(window.startDate).toBe('2026-10-30'); // Friday
      expect(window.endDate).toBe('2026-11-01'); // Sunday
    });

    it('calculates current weekend window from Friday', () => {
      // 2026-10-30 is Friday
      const window = calculateWeekendWindow('2026-10-30');
      expect(window.startDate).toBe('2026-10-30'); // Today (Friday)
      expect(window.endDate).toBe('2026-11-01'); // Sunday
    });

    it('calculates Friday through Sunday window from Saturday', () => {
      // 2026-10-31 is Saturday
      const window = calculateWeekendWindow('2026-10-31');
      expect(window.startDate).toBe('2026-10-30');
      expect(window.endDate).toBe('2026-11-01');
    });

    it('calculates Friday through Sunday window from Sunday', () => {
      // 2026-11-01 is Sunday
      const window = calculateWeekendWindow('2026-11-01');
      expect(window.startDate).toBe('2026-10-30');
      expect(window.endDate).toBe('2026-11-01');
    });

    it('correctly handles Saturday evening in Denver across UTC midnight (FIX 3)', () => {
      // Saturday 2026-10-31 at 20:00 MDT is 2026-11-01T02:00:00Z in UTC
      const window = calculateWeekendWindow({
        referenceInstant: new Date('2026-11-01T02:00:00Z'),
        timeZone: 'America/Denver',
      });
      // In Denver, this is Saturday night of the Oct 30 - Nov 01 weekend
      expect(window.startDate).toBe('2026-10-30');
      expect(window.endDate).toBe('2026-11-01');
    });

    it('correctly handles Sunday evening in Denver across UTC midnight (FIX 3)', () => {
      // Sunday 2026-11-01 at 20:00 MST is 2026-11-02T03:00:00Z in UTC
      const window = calculateWeekendWindow({
        referenceInstant: new Date('2026-11-02T03:00:00Z'),
        timeZone: 'America/Denver',
      });
      // In Denver, this is STILL Sunday of the current weekend, NOT next weekend
      expect(window.startDate).toBe('2026-10-30');
      expect(window.endDate).toBe('2026-11-01');
    });

    it('handles Daylight Saving Time transitions gracefully (fall back & spring forward)', () => {
      // DST Fall Back weekend in US: first Sunday in November (Nov 1, 2026)
      const dstFallBack = calculateWeekendWindow({
        referenceInstant: new Date('2026-11-01T12:00:00Z'),
        timeZone: 'America/Denver',
      });
      expect(dstFallBack.startDate).toBe('2026-10-30');
      expect(dstFallBack.endDate).toBe('2026-11-01');

      // DST Spring Forward weekend in US: second Sunday in March (March 8, 2026)
      const dstSpringForward = calculateWeekendWindow({
        referenceInstant: new Date('2026-03-08T18:00:00Z'),
        timeZone: 'America/Denver',
      });
      expect(dstSpringForward.startDate).toBe('2026-03-06');
      expect(dstSpringForward.endDate).toBe('2026-03-08');
    });

    it('supports user and event in different timezones (America/New_York vs America/Denver)', () => {
      // Friday 16:30 in Denver is 18:30 (6:30 PM) in New York
      const windowNY = calculateWeekendWindow({
        referenceInstant: new Date('2026-10-30T22:30:00Z'),
        timeZone: 'America/New_York',
      });
      expect(windowNY.startDate).toBe('2026-10-30');
      expect(windowNY.endDate).toBe('2026-11-01');
    });

    it('correctly calculates date-only weekend window for Asia/Tokyo on Friday, October 30, 2026 (SHOULD FIX 5)', () => {
      const windowTokyo = calculateWeekendWindow({
        referenceDate: '2026-10-30',
        timeZone: 'Asia/Tokyo',
      });
      expect(windowTokyo.startDate).toBe('2026-10-30');
      expect(windowTokyo.endDate).toBe('2026-11-01');
    });
  });

  describe('isEventEligibleForMode', () => {
    it('allows all scheduled events in "all" mode', () => {
      const event = makeStubEvent();
      expect(isEventEligibleForMode(event, 'all', {})).toBe(true);
    });

    it('filters events strictly to weekend dates in "this_weekend" mode', () => {
      // Reference date: Wednesday 2026-10-28 (Weekend is 2026-10-30 to 2026-11-01)
      const fridayShow = makeStubEvent({
        localStartDate: '2026-10-30',
        startsAt: '2026-10-31T01:30:00Z', // 7:30 PM MDT
        timezone: 'America/Denver',
      });
      const saturdayShow = makeStubEvent({ localStartDate: '2026-10-31' });
      const nextTuesdayShow = makeStubEvent({ localStartDate: '2026-11-03' });

      const context = { referenceDate: '2026-10-28' };
      expect(isEventEligibleForMode(fridayShow, 'this_weekend', context)).toBe(
        true,
      );
      expect(
        isEventEligibleForMode(saturdayShow, 'this_weekend', context),
      ).toBe(true);
      expect(
        isEventEligibleForMode(nextTuesdayShow, 'this_weekend', context),
      ).toBe(false);
    });

    it('enforces Friday 5 PM (17:00) local cutoff in "this_weekend" mode (FIX 3)', () => {
      // 2026-10-30 is Friday.
      // Friday 14:00 (2:00 PM) MDT is before 17:00 -> NOT eligible for weekend
      const fridayAfternoonShow = makeStubEvent({
        localStartDate: '2026-10-30',
        startsAt: '2026-10-30T20:00:00Z', // 14:00 (2 PM) MDT
        timezone: 'America/Denver',
        startTimePrecision: 'instant',
      });

      // Friday 19:30 (7:30 PM) MDT is after 17:00 -> eligible
      const fridayEveningShow = makeStubEvent({
        localStartDate: '2026-10-30',
        startsAt: '2026-10-31T01:30:00Z', // 19:30 (7:30 PM) MDT
        timezone: 'America/Denver',
        startTimePrecision: 'instant',
      });

      // Friday date-only concert (no explicit time) -> eligible
      const fridayDateOnlyShow = makeStubEvent({
        localStartDate: '2026-10-30',
        startsAt: '2026-10-30T00:00:00Z',
        timezone: 'America/Denver',
        startTimePrecision: 'date_only',
      });

      const context = { referenceDate: '2026-10-28' };
      expect(
        isEventEligibleForMode(fridayAfternoonShow, 'this_weekend', context),
      ).toBe(false);
      expect(
        isEventEligibleForMode(fridayEveningShow, 'this_weekend', context),
      ).toBe(true);
      expect(
        isEventEligibleForMode(fridayDateOnlyShow, 'this_weekend', context),
      ).toBe(true);
    });

    it('enforces strict price ceiling, $35 default, and rejects unknown price in "cheap_and_nearby" (FIX 5)', () => {
      const affordable = makeStubEvent({
        minPrice: 30,
        lat: 39.74,
        lng: -104.99,
        city: 'Denver',
      });
      const aboveDefaultCeiling = makeStubEvent({
        minPrice: 40,
        lat: 39.74,
        lng: -104.99,
        city: 'Denver',
      });
      const unknownPrice = makeStubEvent({
        minPrice: null,
        maxPrice: null,
        lat: 39.74,
        lng: -104.99,
        city: 'Denver',
        eventKind: 'concert',
      });
      const freeEvent = makeStubEvent({
        minPrice: null,
        maxPrice: null,
        lat: 39.74,
        lng: -104.99,
        city: 'Denver',
        eventKind: 'free_event',
      });
      const contradictoryFreeEvent = makeStubEvent({
        minPrice: 75,
        maxPrice: 120,
        lat: 39.74,
        lng: -104.99,
        city: 'Denver',
        eventKind: 'free_event',
      });

      const contextWithCityAnchor = { city: 'Denver' };

      expect(
        isEventEligibleForMode(
          affordable,
          'cheap_and_nearby',
          contextWithCityAnchor,
        ),
      ).toBe(true);
      expect(
        isEventEligibleForMode(
          aboveDefaultCeiling,
          'cheap_and_nearby',
          contextWithCityAnchor,
        ),
      ).toBe(false);
      expect(
        isEventEligibleForMode(
          unknownPrice,
          'cheap_and_nearby',
          contextWithCityAnchor,
        ),
      ).toBe(false);
      expect(
        isEventEligibleForMode(
          freeEvent,
          'cheap_and_nearby',
          contextWithCityAnchor,
        ),
      ).toBe(true);

      // MUST FIX 3: Contradictory pricing check - positive price evidence (> 0) overrides free_event marker
      expect(
        isEventEligibleForMode(
          contradictoryFreeEvent,
          'cheap_and_nearby',
          contextWithCityAnchor,
        ),
      ).toBe(false);

      // MUST FIX 3: Do not claim an event is nearby when guest/user has no location anchor
      expect(isEventEligibleForMode(affordable, 'cheap_and_nearby', {})).toBe(
        false,
      );
    });

    it('enforces strict travel radius, 35-mile default, and rejects unknown distance in "cheap_and_nearby" (FIX 5)', () => {
      const userProfile = {
        id: 'u1',
        homeLatApprox: 39.7392,
        homeLngApprox: -104.9903,
        defaultRadiusMiles: 35,
        maxNormalTicketPrice: 35,
        maxFavoriteArtistPrice: 150,
        maxSpontaneousPrice: 40,
        travelWillingness: 'moderate',
        recommendationPreset: 'balanced' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const nearbyShow = makeStubEvent({
        minPrice: 25,
        lat: 39.74,
        lng: -104.99,
      }); // ~0.1 mi
      const tooFarShow = makeStubEvent({
        minPrice: 25,
        lat: 38.83,
        lng: -104.82,
      }); // Colorado Springs ~64 mi
      const unknownCoordsShow = makeStubEvent({
        minPrice: 25,
        lat: null,
        lng: null,
      });

      expect(
        isEventEligibleForMode(nearbyShow, 'cheap_and_nearby', { userProfile }),
      ).toBe(true);
      expect(
        isEventEligibleForMode(tooFarShow, 'cheap_and_nearby', { userProfile }),
      ).toBe(false);
      expect(
        isEventEligibleForMode(unknownCoordsShow, 'cheap_and_nearby', {
          userProfile,
        }),
      ).toBe(false);
    });

    it('supports guest city matching in "cheap_and_nearby" (FIX 5)', () => {
      const denverShow = makeStubEvent({ city: 'Denver', minPrice: 20 });
      const boulderShow = makeStubEvent({ city: 'Boulder', minPrice: 20 });

      expect(
        isEventEligibleForMode(denverShow, 'cheap_and_nearby', {
          city: 'Denver',
        }),
      ).toBe(true);
      expect(
        isEventEligibleForMode(boulderShow, 'cheap_and_nearby', {
          city: 'Denver',
        }),
      ).toBe(false);
    });

    it('enforces 14-day minimum advance planning horizon in "worth_planning_for" (FIX 5)', () => {
      const refDate = '2026-10-01';
      const userPrefs = [
        {
          id: 'pref-1',
          userId: 'u1',
          artistId: 'a1',
          artistName: 'Khruangbin',
          normalizedArtistName: 'khruangbin',
          preferenceLevel: 'favorite' as const,
          createdAt: '2026-10-01',
          updatedAt: '2026-10-01',
        },
      ];

      // 7 days out (< 14 days) -> fails advance horizon
      const soonShow = makeStubEvent({
        localStartDate: '2026-10-08',
        artists: [
          { id: 'a1', name: 'Khruangbin', billingPosition: 'headliner' },
        ],
      });
      // 20 days out (>= 14 days) -> passes
      const futureShow = makeStubEvent({
        localStartDate: '2026-10-21',
        artists: [
          { id: 'a1', name: 'Khruangbin', billingPosition: 'headliner' },
        ],
      });

      expect(
        isEventEligibleForMode(soonShow, 'worth_planning_for', {
          referenceDate: refDate,
          artistPreferences: userPrefs,
        }),
      ).toBe(false);
      expect(
        isEventEligibleForMode(futureShow, 'worth_planning_for', {
          referenceDate: refDate,
          artistPreferences: userPrefs,
        }),
      ).toBe(true);
    });

    it('provides meaningful discovery for guests in "worth_planning_for" (FIX 5)', () => {
      const refDate = '2026-10-01';

      // Guest with no preferences:
      // Regular cheap club show 20 days out -> false
      const clubShow = makeStubEvent({
        localStartDate: '2026-10-21',
        minPrice: 25,
        eventKind: 'concert',
      });
      // Festival 20 days out -> true
      const festivalShow = makeStubEvent({
        localStartDate: '2026-10-21',
        minPrice: 120,
        eventKind: 'festival',
      });
      // Major concert ($80) 20 days out -> true
      const majorShow = makeStubEvent({
        localStartDate: '2026-10-21',
        minPrice: 85,
        eventKind: 'concert',
      });

      expect(
        isEventEligibleForMode(clubShow, 'worth_planning_for', {
          referenceDate: refDate,
        }),
      ).toBe(false);
      expect(
        isEventEligibleForMode(festivalShow, 'worth_planning_for', {
          referenceDate: refDate,
        }),
      ).toBe(true);
      expect(
        isEventEligibleForMode(majorShow, 'worth_planning_for', {
          referenceDate: refDate,
        }),
      ).toBe(true);
    });

    it('prioritizes favorite/liked artists in "worth_planning_for" mode', () => {
      const favoriteShow = makeStubEvent({
        artists: [
          { id: 'a1', name: 'Khruangbin', billingPosition: 'headliner' },
        ],
      });
      const unknownArtistShow = makeStubEvent({
        artists: [
          { id: 'a99', name: 'Random Band', billingPosition: 'headliner' },
        ],
      });

      const context = {
        referenceDate: '2026-10-01',
        artistPreferences: [
          {
            id: 'p1',
            userId: 'u1',
            artistId: 'a1',
            artistName: 'Khruangbin',
            normalizedArtistName: 'khruangbin',
            preferenceLevel: 'favorite' as const,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      };

      expect(
        isEventEligibleForMode(favoriteShow, 'worth_planning_for', context),
      ).toBe(true);
      expect(
        isEventEligibleForMode(
          unknownArtistShow,
          'worth_planning_for',
          context,
        ),
      ).toBe(false);
    });
  });

  describe('getModeScoringWeights', () => {
    it('returns custom weights prioritizing each mode while preserving base weights for "all"', () => {
      const base = { artist: 25, distance: 25, price: 25, timing: 25 };
      expect(getModeScoringWeights('all', base)).toEqual(base);

      const weekend = getModeScoringWeights('this_weekend', base);
      expect(weekend.timing).toBeGreaterThan(weekend.artist);

      const cheap = getModeScoringWeights('cheap_and_nearby', base);
      expect(cheap.price).toBeGreaterThan(cheap.artist);

      const planning = getModeScoringWeights('worth_planning_for', base);
      expect(planning.artist).toBeGreaterThan(planning.timing);
    });
  });
});
