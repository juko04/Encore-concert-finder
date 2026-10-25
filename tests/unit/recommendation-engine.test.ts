import { describe, expect, it } from 'vitest';
import {
  compareScoredEvents,
  rankEvents,
  scoreEvent,
} from '@/lib/recommendation/engine';
import {
  ARTIST_ID_THE_CURE,
  FIXTURE_ARTIST_PREFERENCES,
  FIXTURE_EVENTS,
  FIXTURE_REFERENCE_DATE,
  FIXTURE_USER_PROFILE,
} from '@/tests/fixtures/recommendation-fixtures';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { ScoringContext } from '@/lib/recommendation/types';

describe('Recommendation Scoring Engine', () => {
  const baseContext: ScoringContext = {
    userProfile: FIXTURE_USER_PROFILE,
    artistPreferences: FIXTURE_ARTIST_PREFERENCES,
    referenceDate: FIXTURE_REFERENCE_DATE,
    presetOverride: 'balanced',
  };

  it('ranks eligible events deterministically and produces structured outputs', () => {
    const result = rankEvents(FIXTURE_EVENTS, baseContext);

    expect(result.preset).toBe('balanced');
    expect(result.weights).toEqual({
      artist: 50,
      distance: 20,
      price: 20,
      timing: 10,
    });

    // 1 past event must be filtered as ineligible
    expect(result.ineligibleCount).toBe(1);

    // 1 disliked event must be partitioned into suppressed
    expect(result.suppressed.length).toBe(1);
    expect(result.suppressed[0].eventId).toBe('ev-disliked-artist-suppressed');
    expect(result.suppressed[0].isSuppressed).toBe(true);

    // Unmarked exploratory events must be in exploratory pool
    expect(result.exploratory.length).toBeGreaterThan(0);
    const exploratoryIds = result.exploratory.map((e) => e.eventId);
    expect(exploratoryIds).toContain('ev-local-indie-cheap');
    expect(exploratoryIds).toContain('ev-samename-jazz-unmarked');

    // Primary recommendations must contain matched artist events
    expect(result.recommendations.length).toBeGreaterThan(0);
    const topRec = result.recommendations[0];
    expect(topRec.score).toBeGreaterThan(70);
    expect(topRec.factors.artist.score).toBeGreaterThanOrEqual(75);
    expect(topRec.explanation).toBeDefined();
    expect(topRec.explanation.length).toBeGreaterThan(10);
  });

  it('demonstrates that switching priority presets changes rankings in the expected direction', () => {
    // 1. Run Balanced preset
    const balancedResult = rankEvents(FIXTURE_EVENTS, {
      ...baseContext,
      presetOverride: 'balanced',
    });

    // 2. Run Nearby preset (Distance weight 35% vs 20%)
    const nearbyResult = rankEvents(FIXTURE_EVENTS, {
      ...baseContext,
      presetOverride: 'nearby',
    });

    // 3. Run Value preset (Price weight 35% vs 20%)
    const valueResult = rankEvents(FIXTURE_EVENTS, {
      ...baseContext,
      presetOverride: 'value',
    });

    // 4. Run Artist-First preset (Artist weight 65% vs 50%)
    const artistFirstResult = rankEvents(FIXTURE_EVENTS, {
      ...baseContext,
      presetOverride: 'artist_first',
    });

    // Compare two specific events:
    // Event A: The Cure (Favorite) but farther away (~52 mi, price $75) -> 'ev-cure-far-away'
    // Event B: Aurora (Liked) very close (~2.5 mi, price $35) -> 'ev-aurora-bluebird'

    const balancedCureFar = balancedResult.recommendations.find(
      (r) => r.eventId === 'ev-cure-far-away',
    )!;
    const balancedAuroraClose = balancedResult.recommendations.find(
      (r) => r.eventId === 'ev-aurora-bluebird',
    )!;

    const artistFirstCureFar = artistFirstResult.recommendations.find(
      (r) => r.eventId === 'ev-cure-far-away',
    )!;
    const artistFirstAuroraClose = artistFirstResult.recommendations.find(
      (r) => r.eventId === 'ev-aurora-bluebird',
    )!;

    const nearbyAuroraClose = nearbyResult.recommendations.find(
      (r) => r.eventId === 'ev-aurora-bluebird',
    )!;
    const nearbyCureFar = nearbyResult.recommendations.find(
      (r) => r.eventId === 'ev-cure-far-away',
    )!;

    // In Artist-First, the Favorite artist farther away gets a larger boost relative to Liked artist
    const diffArtistFirst =
      artistFirstCureFar.score - artistFirstAuroraClose.score;
    const diffBalanced = balancedCureFar.score - balancedAuroraClose.score;
    expect(diffArtistFirst).toBeGreaterThan(diffBalanced);

    // In Nearby, the very close Aurora show achieves a larger advantage over the farther Cure show
    const diffNearby = nearbyAuroraClose.score - nearbyCureFar.score;
    expect(diffNearby).toBeGreaterThan(
      balancedAuroraClose.score - balancedCureFar.score,
    );
  });

  it('deduplicates duplicate canonical events in the candidate pool', () => {
    const duplicateList = [
      FIXTURE_EVENTS[0],
      FIXTURE_EVENTS[0], // Exact duplicate
      FIXTURE_EVENTS[1],
      FIXTURE_EVENTS[1], // Exact duplicate
    ];

    const result = rankEvents(duplicateList, baseContext);
    const eventIds = [
      ...result.recommendations.map((r) => r.eventId),
      ...result.exploratory.map((r) => r.eventId),
      ...result.suppressed.map((r) => r.eventId),
    ];

    expect(new Set(eventIds).size).toBe(eventIds.length);
    expect(result.totalScored).toBe(2);
  });

  it('applies stable deterministic tie-breaking for identical composite scores', () => {
    // Construct two events with identical scores and dates, but different event IDs
    const eventA: CanonicalEventSummary = {
      id: 'event-aaa-stable',
      title: 'Band A Concert',
      venueName: 'Club A',
      localStartDate: '2026-11-15',
      timezone: 'America/Denver',
      startTimePrecision: 'instant',
      status: 'scheduled',
      artists: [
        {
          id: ARTIST_ID_THE_CURE,
          name: 'The Cure',
          billingPosition: 'headliner',
        },
      ],
      minPrice: 50,
      lat: 39.7392,
      lng: -104.9903,
    };

    const eventB: CanonicalEventSummary = {
      id: 'event-bbb-stable',
      title: 'Band B Concert',
      venueName: 'Club B',
      localStartDate: '2026-11-15',
      timezone: 'America/Denver',
      startTimePrecision: 'instant',
      status: 'scheduled',
      artists: [
        {
          id: ARTIST_ID_THE_CURE,
          name: 'The Cure',
          billingPosition: 'headliner',
        },
      ],
      minPrice: 50,
      lat: 39.7392,
      lng: -104.9903,
    };

    const scoredA = scoreEvent(eventA, baseContext).scoredEvent;
    const scoredB = scoreEvent(eventB, baseContext).scoredEvent;

    expect(scoredA.score).toBe(scoredB.score);

    // Event A should stably come before Event B by lexicographical ID tie-breaking
    const order1 = compareScoredEvents(scoredA, scoredB);
    const order2 = compareScoredEvents(scoredB, scoredA);
    expect(order1).toBeLessThan(0);
    expect(order2).toBeGreaterThan(0);
  });

  it('suppresses events when status is cancelled or postponed', () => {
    const cancelledEvent: CanonicalEventSummary = {
      ...FIXTURE_EVENTS[0],
      id: 'ev-cancelled-test',
      status: 'cancelled',
    };

    const { scoredEvent } = scoreEvent(cancelledEvent, baseContext);
    expect(scoredEvent.isSuppressed).toBe(true);
    expect(scoredEvent.score).toBe(0);
    expect(scoredEvent.suppressionReason).toContain('cancelled');
  });

  it('separates developer diagnostics from concise end-user explanations', () => {
    const { scoredEvent } = scoreEvent(FIXTURE_EVENTS[0], baseContext);

    // User explanation is clean, non-technical, human-readable
    expect(scoredEvent.explanation).not.toContain('{');
    expect(scoredEvent.explanation).not.toContain('NaN');
    expect(scoredEvent.explanation).not.toContain('weightedContribution');

    // Developer diagnostics contain deep data availability and raw values
    expect(scoredEvent.diagnostics.dataAvailability.hasArtistMatch).toBe(true);
    expect(scoredEvent.diagnostics.dataAvailability.hasPriceData).toBe(true);
    expect(scoredEvent.diagnostics.dataAvailability.hasCoordinates).toBe(true);
    expect(scoredEvent.diagnostics.rawMetrics.distanceMiles).toBeDefined();
    expect(scoredEvent.diagnostics.rawMetrics.minPrice).toBe(85);
  });
});
