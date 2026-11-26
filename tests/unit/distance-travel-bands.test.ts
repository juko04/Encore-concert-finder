import { describe, it, expect } from 'vitest';
import {
  calculateDistanceFactor,
  travelBands,
} from '@/lib/recommendation/factors/distance';
import { buildRecommendationExplanation } from '@/lib/recommendation/explainer';
import type { FactorScore } from '@/lib/recommendation/types';

// Test fixtures only; the scoring itself knows no places.
const BOULDER = { userLat: 40.015, userLng: -105.2705 };
const RED_ROCKS = { venueLat: 39.6654, venueLng: -105.2057 }; // ~24 mi
const FORT_COLLINS = { venueLat: 40.5853, venueLng: -105.0844 }; // ~41 mi
const COLORADO_SPRINGS = { venueLat: 38.8339, venueLng: -104.8214 }; // ~85 mi
const SALT_LAKE_CITY = { venueLat: 40.7608, venueLng: -111.891 }; // ~350 mi
const MIAMI = { venueLat: 25.7617, venueLng: -80.1918 }; // ~1,700 mi

function score(venue: { venueLat: number; venueLng: number }, radius = 15) {
  return calculateDistanceFactor({
    ...BOULDER,
    ...venue,
    preferredRadiusMiles: radius,
  }).factorScore;
}

describe('distance travel bands', () => {
  it('gives a major boost inside the radius', () => {
    const inside = score(RED_ROCKS, 30);
    expect(inside.score).toBeGreaterThanOrEqual(80);
    expect(inside.diagnostics?.travelBand).toBe('within_radius');
  });

  it('keeps a venue just past the radius (Boulder -> Red Rocks) high, far above a flight', () => {
    const miami = score(MIAMI);
    const redRocks = score(RED_ROCKS);
    expect(redRocks.diagnostics?.travelBand).toBe('just_outside');
    expect(redRocks.score).toBeGreaterThan(55);
    expect(redRocks.score).toBeGreaterThan(miami.score * 10);
    expect(redRocks.explanation).toContain('Just outside your 15 mi radius');
    expect(miami.diagnostics?.travelBand).toBe('flight');
    expect(miami.score).toBe(5);
    expect(miami.explanation).toContain('likely a flight');
  });

  it('treats a day trip as still worth considering', () => {
    const springs = score(COLORADO_SPRINGS);
    expect(springs.diagnostics?.travelBand).toBe('day_trip');
    expect(springs.score).toBeGreaterThan(25);
    expect(springs.score).toBeLessThan(40);
    expect(springs.explanation).toContain('Day trip');
  });

  it('ranks strictly by how far the trip is', () => {
    const ordered = [
      RED_ROCKS,
      FORT_COLLINS,
      COLORADO_SPRINGS,
      SALT_LAKE_CITY,
      MIAMI,
    ].map((v) => score(v).score);
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i]).toBeLessThan(ordered[i - 1]);
    }
    expect(score(SALT_LAKE_CITY).diagnostics?.travelBand).toBe('road_trip');
  });

  it('lets favorite artists travel further', () => {
    for (const venue of [RED_ROCKS, COLORADO_SPRINGS, SALT_LAKE_CITY]) {
      const fav = calculateDistanceFactor({
        ...BOULDER,
        ...venue,
        preferredRadiusMiles: 15,
        isFavoriteArtist: true,
      }).factorScore.score;
      expect(fav).toBeGreaterThan(score(venue).score);
    }
  });

  it('steps down at the radius edge: inside is a clear boost', () => {
    const { knots } = travelBands(25, false);
    const atEdge = calculateDistanceFactor({
      userLat: 0,
      userLng: 0,
      venueLat: 0,
      venueLng: 24.9 / 69.17,
      preferredRadiusMiles: 25,
    }).factorScore.score;
    const pastEdge = calculateDistanceFactor({
      userLat: 0,
      userLng: 0,
      venueLat: 0,
      venueLng: 25.2 / 69.17,
      preferredRadiusMiles: 25,
    }).factorScore.score;
    expect(knots.filter(([miles]) => miles === 25)).toHaveLength(2);
    expect(atEdge - pastEdge).toBeGreaterThanOrEqual(7);
  });

  it('keeps bands in order for any radius, including very large ones', () => {
    for (const radius of [1, 5, 25, 100, 300, 2000]) {
      for (const fav of [false, true]) {
        const { knots } = travelBands(radius, fav);
        for (let i = 1; i < knots.length; i += 1) {
          expect(knots[i][0]).toBeGreaterThanOrEqual(knots[i - 1][0]);
          expect(knots[i][1]).toBeLessThan(knots[i - 1][1]);
        }
      }
    }
  });
});

describe('reason line names the trip', () => {
  const flat = (factor: FactorScore['factor'], score: number): FactorScore =>
    ({
      factor,
      score,
      weight: 30,
      weightedContribution: 0,
      isAvailable: false,
      fieldStatus: 'neutral_missing',
      explanation: '',
    }) as FactorScore;

  function reason(venue: { venueLat: number; venueLng: number }) {
    const distance = {
      ...score(venue),
      weight: 30,
      weightedContribution: 0,
    } as FactorScore;
    return buildRecommendationExplanation({
      artistFactor: flat('artist', 50),
      distanceFactor: distance,
      priceFactor: flat('price', 50),
      isSuppressed: false,
      isExploratory: false,
    });
  }

  it('never calls a show past the radius "close to home"', () => {
    expect(reason(RED_ROCKS)).toContain('Just outside your radius (24 mi)');
    expect(reason(RED_ROCKS)).not.toContain('Close to home');
    expect(reason(COLORADO_SPRINGS)).toContain('Day trip (85 mi)');
    expect(reason(SALT_LAKE_CITY)).toContain('Road trip');
    expect(reason(MIAMI)).toContain('1747 mi away');
  });
});
