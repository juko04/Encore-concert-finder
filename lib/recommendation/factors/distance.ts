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
 * Validates decimal latitude: must be a finite number between -90 and 90 degrees.
 */
export function isValidLatitude(lat: unknown): lat is number {
  return (
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90
  );
}

/**
 * Validates decimal longitude: must be a finite number between -180 and 180 degrees.
 */
export function isValidLongitude(lng: unknown): lng is number {
  return (
    typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180
  );
}

/**
 * Validates a coordinate pair (latitude, longitude).
 */
export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  return isValidLatitude(lat) && isValidLongitude(lng);
}

/**
 * Validates travel radius: must be a finite number strictly greater than 0.
 */
export function isValidRadius(radius: unknown): radius is number {
  return typeof radius === 'number' && Number.isFinite(radius) && radius > 0;
}

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
  const dist = EARTH_RADIUS_MILES * c;
  return Number.isFinite(dist) ? dist : 0;
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

  // Validate travel radius: must be finite and positive, otherwise default to 25 miles
  const radius = isValidRadius(preferredRadiusMiles)
    ? preferredRadiusMiles
    : DEFAULT_RADIUS_MILES;

  // Strict coordinate validation: reject null, undefined, NaN, Infinity, and out-of-range degrees
  const hasValidUserCoords = isValidCoordinate(userLat, userLng);
  const hasValidVenueCoords = isValidCoordinate(venueLat, venueLng);

  if (!hasValidUserCoords || !hasValidVenueCoords) {
    return {
      factorScore: {
        factor: 'distance',
        score: NEUTRAL_DISTANCE_SCORE,
        isAvailable: false,
        fieldStatus: 'neutral_missing',
        explanation:
          'Location neutral (approximate venue or home coordinates unavailable or invalid)',
        diagnostics: {
          hasUserCoords: hasValidUserCoords,
          hasVenueCoords: hasValidVenueCoords,
          fallbackScore: NEUTRAL_DISTANCE_SCORE,
        },
      },
      distanceMiles: null,
    };
  }

  // Type narrowing holds true due to isValidCoordinate checks above
  const distance = calculateHaversineDistanceMiles(
    userLat as number,
    userLng as number,
    venueLat as number,
    venueLng as number,
  );
  const roundedDist = Math.round(distance * 10) / 10;

  // Effective radius: Favorite artists justify higher travel willingness (1.5x effective radius)
  const effectiveRadius = isFavoriteArtist ? radius * 1.5 : radius;

  let score: number;
  let explanation: string;

  if (distance <= radius) {
    // Within user's explicit preferred radius: smooth decay from 100 at 0mi to 65 at radius
    const ratio = radius > 0 ? distance / radius : 0;
    score = 100 - 35 * ratio;
    explanation = `Close to home (${Math.round(distance)} mi, within your ${radius} mi radius)`;
  } else if (isFavoriteArtist && distance <= effectiveRadius) {
    // Beyond standard radius, but within extended favorite travel willingness (1.5x radius)
    // Smooth decay from 65 at radius down to 50 at 1.5x radius
    const favoriteDenom = effectiveRadius - radius;
    const favoriteRatio =
      favoriteDenom > 0 ? (distance - radius) / favoriteDenom : 0;
    score = 65 - 15 * favoriteRatio;
    explanation = `Within extended travel radius for a favorite artist (${Math.round(distance)} mi)`;
  } else {
    // Beyond effective radius: steep decay down towards floor of 5
    const overflow = distance - (isFavoriteArtist ? effectiveRadius : radius);
    const maxOverflow = 1.5 * radius;
    const decayRatio =
      maxOverflow > 0 ? Math.min(1, overflow / maxOverflow) : 1;
    score = Math.max(5, 50 - 45 * decayRatio);
    explanation = `${Math.round(distance)} mi away (beyond your ${radius} mi preferred radius)`;
  }

  const safeScore = Number.isFinite(score) ? score : NEUTRAL_DISTANCE_SCORE;
  const boundedScore = Math.min(
    100,
    Math.max(0, Math.round(safeScore * 10) / 10),
  );

  return {
    factorScore: {
      factor: 'distance',
      score: boundedScore,
      isAvailable: true,
      fieldStatus: 'verified',
      explanation,
      diagnostics: {
        distanceMiles: Number.isFinite(roundedDist) ? roundedDist : null,
        preferredRadiusMiles: radius,
        effectiveRadiusMiles: effectiveRadius,
        isFavoriteArtist: !!isFavoriteArtist,
      },
    },
    distanceMiles: Number.isFinite(roundedDist) ? roundedDist : null,
  };
}
