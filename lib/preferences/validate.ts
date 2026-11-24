/**
 * Validation for the Preferences page (radius, ticket price ceilings, ranking emphasis).
 * Pure and shared by the server action and unit tests. Never trusts client input.
 */

import {
  MAX_ARTIST_WEIGHT,
  MIN_ARTIST_WEIGHT,
  isValidArtistWeight,
  isValidScoringPreset,
} from '@/lib/recommendation/presets';
import type { ScoringPreset } from '@/lib/recommendation/types';

export const MIN_RADIUS_MILES = 5;
export const MAX_RADIUS_MILES = 500;
export const MAX_PRICE_CEILING = 1000;

export interface PreferencesInput {
  defaultRadiusMiles: number;
  maxNormalTicketPrice: number | null;
  maxFavoriteArtistPrice: number | null;
  maxSpontaneousPrice: number | null;
  recommendationPreset: ScoringPreset;
  /** Null = use the preset's own artist weight. */
  artistWeight: number | null;
}

export type ParsePreferencesResult =
  { ok: true; value: PreferencesInput } | { ok: false; error: string };

function toNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

function parsePriceCeiling(
  value: unknown,
  label: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const n = toNumber(value);
  if (n === undefined || (n !== null && !Number.isFinite(n))) {
    return { ok: false, error: `${label} must be a number.` };
  }
  if (n === null) return { ok: true, value: null };
  if (n <= 0 || n > MAX_PRICE_CEILING) {
    return {
      ok: false,
      error: `${label} must be more than $0 and at most $${MAX_PRICE_CEILING.toLocaleString('en-US')} (leave blank for no limit).`,
    };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function parsePreferencesInput(raw: unknown): ParsePreferencesResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'Invalid preferences.' };
  }
  const input = raw as Record<string, unknown>;

  const radius = toNumber(input.defaultRadiusMiles);
  if (
    typeof radius !== 'number' ||
    !Number.isInteger(radius) ||
    radius < MIN_RADIUS_MILES ||
    radius > MAX_RADIUS_MILES
  ) {
    return {
      ok: false,
      error: `Travel radius must be a whole number between ${MIN_RADIUS_MILES} and ${MAX_RADIUS_MILES} miles.`,
    };
  }

  const normal = parsePriceCeiling(
    input.maxNormalTicketPrice,
    'Typical ticket budget',
  );
  if (!normal.ok) return normal;
  const favorite = parsePriceCeiling(
    input.maxFavoriteArtistPrice,
    'Favorite-artist budget',
  );
  if (!favorite.ok) return favorite;
  const spontaneous = parsePriceCeiling(
    input.maxSpontaneousPrice,
    'Discovery budget',
  );
  if (!spontaneous.ok) return spontaneous;

  const preset = input.recommendationPreset;
  if (!isValidScoringPreset(preset)) {
    return { ok: false, error: 'Choose one of the four ranking styles.' };
  }

  let artistWeight: number | null = null;
  const aw = toNumber(input.artistWeight);
  if (aw === undefined) {
    return { ok: false, error: 'Artist importance must be a number.' };
  }
  if (aw !== null) {
    if (!isValidArtistWeight(aw)) {
      return {
        ok: false,
        error: `Artist importance must be a whole number between ${MIN_ARTIST_WEIGHT} and ${MAX_ARTIST_WEIGHT}.`,
      };
    }
    artistWeight = aw;
  }

  return {
    ok: true,
    value: {
      defaultRadiusMiles: radius,
      maxNormalTicketPrice: normal.value,
      maxFavoriteArtistPrice: favorite.value,
      maxSpontaneousPrice: spontaneous.value,
      recommendationPreset: preset,
      artistWeight,
    },
  };
}
