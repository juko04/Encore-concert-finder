/**
 * Factor 2: Distance and Travel Practicality Scoring
 * Computes great-circle (Haversine) distance and scores it by travel band (close to home, just
 * outside the radius, day trip, road trip, flight), respecting the user's preferred radius
 * (default_radius_miles) and favorite-artist elasticity.
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
 * How far is "far"? Distance is scored by how a trip feels:
 *
 *   within radius    100 -> 80   close to home
 *   just outside      72 -> 40   up to 2x the radius (at least radius + 30 mi): still an easy drive
 *   day trip          40 -> 25   up to 150 mi: there and back in a day
 *   road trip         25 -> 10   up to 400 mi: an overnight or weekend
 *   flight            10 -> 5    1,000 mi and beyond: you would fly
 *
 * Being inside the radius is a clear boost (the 80 -> 72 step at the edge), yet a venue just past
 * the radius still ranks far above one that needs a flight. Mile bands are generic travel
 * distances, not tied to any region; each band starts at or after the previous one, so a large
 * personal radius pushes the later bands out. Favorite artists use the same bands (a 65 mi trip is
 * still a day trip) with somewhat higher scores (85, 74 -> 44, 32, 16, 7), while a local show still
 * beats a favorite past the radius when the viewer picks the Nearby preset.
 */
export const DAY_TRIP_MILES = 150;
export const ROAD_TRIP_MILES = 400;
export const FLIGHT_MILES = 1000;

export type TravelBand =
  'within_radius' | 'just_outside' | 'day_trip' | 'road_trip' | 'flight';

interface TravelBands {
  stretch: number;
  dayTrip: number;
  roadTrip: number;
  /** [miles, score] knots: miles never decrease (the radius repeats for the step), scores always drop. */
  knots: Array<[number, number]>;
}

export function travelBands(radius: number, isFavorite: boolean): TravelBands {
  const stretch = Math.max(radius * 2, radius + 30);
  const dayTrip = Math.max(DAY_TRIP_MILES, stretch + 30);
  const roadTrip = Math.max(ROAD_TRIP_MILES, dayTrip + 100);
  const flight = Math.max(FLIGHT_MILES, roadTrip + 200);
  // The radius appears twice: the score steps down as you leave it.
  const knots: Array<[number, number]> = isFavorite
    ? [
        [0, 100],
        [radius, 85],
        [radius, 74],
        [stretch, 44],
        [dayTrip, 32],
        [roadTrip, 16],
        [flight, 7],
      ]
    : [
        [0, 100],
        [radius, 80],
        [radius, 72],
        [stretch, 40],
        [dayTrip, 25],
        [roadTrip, 10],
        [flight, 5],
      ];
  return { stretch, dayTrip, roadTrip, knots };
}

function interpolateBands(
  distance: number,
  knots: Array<[number, number]>,
): number {
  if (distance <= knots[0][0]) return knots[0][1];
  for (let k = 1; k < knots.length; k += 1) {
    const [x1, y1] = knots[k];
    if (distance <= x1) {
      const [x0, y0] = knots[k - 1];
      const t = x1 > x0 ? (distance - x0) / (x1 - x0) : 1;
      return y0 + (y1 - y0) * t;
    }
  }
  return knots[knots.length - 1][1];
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

  const bands = travelBands(radius, !!isFavoriteArtist);
  const score = interpolateBands(distance, bands.knots);
  const miles = Math.round(distance).toLocaleString('en-US');
  let explanation: string;
  let travelBand: TravelBand;
  if (distance <= radius) {
    travelBand = 'within_radius';
    explanation = `Close to home (${miles} mi, within your ${radius} mi radius)`;
  } else if (distance <= bands.stretch) {
    travelBand = 'just_outside';
    explanation = isFavoriteArtist
      ? `Within extended travel radius for a favorite artist (${miles} mi)`
      : `Just outside your ${radius} mi radius (${miles} mi)`;
  } else if (distance <= bands.dayTrip) {
    travelBand = 'day_trip';
    explanation = `Day trip (${miles} mi away)`;
  } else if (distance <= bands.roadTrip) {
    travelBand = 'road_trip';
    explanation = `Road trip (${miles} mi away)`;
  } else {
    travelBand = 'flight';
    explanation = `${miles} mi away, likely a flight`;
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
        travelBand,
      },
    },
    distanceMiles: Number.isFinite(roundedDist) ? roundedDist : null,
  };
}
