/**
 * Factor 2: Distance and Travel Practicality Scoring
 * Computes great-circle (Haversine) distance and bounded utility decay
 * respecting user preferred radius (default_radius_miles) and favorite elasticity.
 *
 * Invariants:
 * 1. Missing coordinates return documented neutral score (50).
 * 2. Does not assume Denver, Colorado, or hardcoded geographies.
 * 3. Favorite artists farther away benefit from higher travel willingness elasticity.
 * 4. Bounded strictly to [0, 100].
 */

import type { FactorScore } from '../types';

export interface DistanceFactorInput {
  userLat?: number | null;
  userLng?: number | null;
  venueLat?: number | null;
  venueLng?: number | null;
  preferredRadiusMiles?: number | null;
  isFavoriteArtist?: boolean;
}

export interface DistanceFactorResult {
  factorScore: Omit<FactorScore, 'weight' | 'weightedContribution'>;
  distanceMiles: number | null;
}

const EARTH_RADIUS_MILES = 3958.8;
export const DEFAULT_RADIUS_MILES = 25;
export const NEUTRAL_DISTANCE_SCORE = 50;

/**
 * Computes great-circle distance between two decimal coordinates in miles using the Haversine formula.
 */
export function calculateHaversineDistanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRadians = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

/**
 * Evaluates the distance utility factor based on user coordinates and venue coordinates.
 */
export function calculateDistanceFactor(
  input: DistanceFactorInput,
): DistanceFactorResult {
  const {
    userLat,
    userLng,
    venueLat,
    venueLng,
    preferredRadiusMiles,
    isFavoriteArtist,
  } = input;

  const radius =
    preferredRadiusMiles && preferredRadiusMiles > 0
      ? preferredRadiusMiles
      : DEFAULT_RADIUS_MILES;

  // Missing coordinates fallback
  if (
    userLat === null ||
    userLat === undefined ||
    userLng === null ||
    userLng === undefined ||
    venueLat === null ||
    venueLat === undefined ||
    venueLng === null ||
    venueLng === undefined
  ) {
    return {
      factorScore: {
        factor: 'distance',
        score: NEUTRAL_DISTANCE_SCORE,
        isAvailable: false,
        fieldStatus: 'neutral_missing',
        explanation:
          'Location neutral (approximate venue or home coordinates unavailable)',
        diagnostics: {
          hasUserCoords: userLat !== null && userLat !== undefined,
          hasVenueCoords: venueLat !== null && venueLat !== undefined,
          fallbackScore: NEUTRAL_DISTANCE_SCORE,
        },
      },
      distanceMiles: null,
    };
  }

  const distance = calculateHaversineDistanceMiles(
    userLat,
    userLng,
    venueLat,
    venueLng,
  );
  const roundedDist = Math.round(distance * 10) / 10;

  // Effective radius: Favorite artists justify higher travel willingness (1.5x effective radius)
  const effectiveRadius = isFavoriteArtist ? radius * 1.5 : radius;

  let score: number;
  let explanation: string;

  if (distance <= radius) {
    // Within user's explicit preferred radius: smooth decay from 100 at 0mi to 65 at radius
    const ratio = distance / radius;
    score = 100 - 35 * ratio;
    explanation = `Close to home (${Math.round(distance)} mi, within your ${radius} mi radius)`;
  } else if (isFavoriteArtist && distance <= effectiveRadius) {
    // Beyond standard radius, but within extended favorite travel willingness
    const favoriteRatio = (distance - radius) / (effectiveRadius - radius);
    score = 65 - 15 * favoriteRatio;
    explanation = `Within extended travel radius for a favorite artist (${Math.round(distance)} mi)`;
  } else {
    // Beyond radius: decay smoothly down towards 10 at 3x radius
    const overflow = distance - effectiveRadius;
    const maxOverflow = 2 * radius;
    const decayRatio = Math.min(1, overflow / maxOverflow);
    score = Math.max(10, 65 - 55 * decayRatio);
    explanation = `${Math.round(distance)} mi away (beyond your ${radius} mi preferred radius)`;
  }

  const boundedScore = Math.min(100, Math.max(0, Math.round(score * 10) / 10));

  return {
    factorScore: {
      factor: 'distance',
      score: boundedScore,
      isAvailable: true,
      fieldStatus: 'verified',
      explanation,
      diagnostics: {
        distanceMiles: roundedDist,
        preferredRadiusMiles: radius,
        effectiveRadiusMiles: effectiveRadius,
        isFavoriteArtist: !!isFavoriteArtist,
      },
    },
    distanceMiles: roundedDist,
  };
}
