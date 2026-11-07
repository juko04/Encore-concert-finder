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

    it('calculates Saturday through Sunday window from Saturday', () => {
      // 2026-10-31 is Saturday
      const window = calculateWeekendWindow('2026-10-31');
      expect(window.startDate).toBe('2026-10-31');
      expect(window.endDate).toBe('2026-11-01');
    });

    it('calculates Sunday window from Sunday', () => {
      // 2026-11-01 is Sunday
      const window = calculateWeekendWindow('2026-11-01');
      expect(window.startDate).toBe('2026-11-01');
      expect(window.endDate).toBe('2026-11-01');
    });
  });

  describe('isEventEligibleForMode', () => {
    it('allows all scheduled events in "all" mode', () => {
      const event = makeStubEvent();
      expect(isEventEligibleForMode(event, 'all', {})).toBe(true);
    });

    it('filters events strictly to weekend dates in "this_weekend" mode', () => {
      // Reference date: Wednesday 2026-10-28 (Weekend is 2026-10-30 to 2026-11-01)
      const fridayShow = makeStubEvent({ localStartDate: '2026-10-30' });
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

    it('filters events by budget and distance in "cheap_and_nearby" mode', () => {
      const affordableNearby = makeStubEvent({
        minPrice: 35,
        lat: 39.74,
        lng: -104.99,
      });
      const tooExpensive = makeStubEvent({
        minPrice: 120,
        lat: 39.74,
        lng: -104.99,
      });
      const tooFar = makeStubEvent({
        minPrice: 30,
        lat: 37.93, // Telluride ~200 miles away from Denver
        lng: -107.81,
      });

      const context = {
        userProfile: {
          id: 'u1',
          homeLatApprox: 39.7392,
          homeLngApprox: -104.9903,
          defaultRadiusMiles: 30,
          maxNormalTicketPrice: 60,
          maxFavoriteArtistPrice: 150,
          maxSpontaneousPrice: 40,
          travelWillingness: 'moderate',
          recommendationPreset: 'balanced' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      expect(
        isEventEligibleForMode(affordableNearby, 'cheap_and_nearby', context),
      ).toBe(true);
      expect(
        isEventEligibleForMode(tooExpensive, 'cheap_and_nearby', context),
      ).toBe(false);
      expect(isEventEligibleForMode(tooFar, 'cheap_and_nearby', context)).toBe(
        false,
      );
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
