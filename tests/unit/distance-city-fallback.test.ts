import { describe, expect, it } from 'vitest';
import { scoreEvent } from '@/lib/recommendation/engine';
import {
  FIXTURE_EVENTS,
  FIXTURE_REFERENCE_DATE,
} from '@/tests/fixtures/recommendation-fixtures';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { ScoringContext } from '@/lib/recommendation/types';

const denver = { lat: 39.74, lng: -104.99 };

function ctx(over?: ScoringContext['locationOverride']): ScoringContext {
  return {
    artistPreferences: [],
    referenceDate: FIXTURE_REFERENCE_DATE,
    presetOverride: 'balanced',
    locationOverride: over ?? undefined,
  };
}

function noCoords(city: string, region = 'CO'): CanonicalEventSummary {
  const base =
    FIXTURE_EVENTS.find((e) => !e.title.includes('past')) ?? FIXTURE_EVENTS[0];
  return { ...base, city, region, lat: null, lng: null };
}

describe('distance city-centroid fallback', () => {
  it('uses the city centroid and flags it as approximate', () => {
    const { scoredEvent } = scoreEvent(noCoords('Boulder'), ctx(denver));
    const f = scoredEvent.factors.distance;
    expect(f.isAvailable).toBe(true);
    expect(f.diagnostics?.locationPrecision).toBe('city_level_approximation');
    expect(Number(f.diagnostics?.distanceMiles)).toBeGreaterThan(20);
    expect(Number(f.diagnostics?.distanceMiles)).toBeLessThan(35);
    expect(scoredEvent.explanation).toContain('~');
  });

  it('stays neutral for unknown cities', () => {
    const { scoredEvent } = scoreEvent(noCoords('Nowhereville'), ctx(denver));
    expect(scoredEvent.factors.distance.score).toBe(50);
    expect(
      scoredEvent.factors.distance.diagnostics?.locationPrecision,
    ).toBeUndefined();
  });

  it('stays neutral without a user location', () => {
    const { scoredEvent } = scoreEvent(noCoords('Boulder'), ctx());
    expect(scoredEvent.factors.distance.score).toBe(50);
  });

  it('scores a same-city show above a far-away one', () => {
    const near = scoreEvent(noCoords('Denver'), ctx(denver)).scoredEvent;
    const far = scoreEvent(
      noCoords('Salt Lake City', 'UT'),
      ctx(denver),
    ).scoredEvent;
    expect(near.factors.distance.score).toBeGreaterThan(
      far.factors.distance.score,
    );
  });
});
