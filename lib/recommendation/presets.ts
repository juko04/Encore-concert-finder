/**
 * Recommendation Scoring Presets & Fixed Priority Weights
 * Users choose one of four intuitive presets rather than configuring
 * raw numerical decimals directly.
 * Invariant: Weights for every preset must sum exactly to 100% (artist + distance + price;
 * timing was removed - only past-event eligibility remains).
 */

import { VALID_RECOMMENDATION_PRESETS } from '@/lib/domain/profile';
import type { ScoringPreset, ScoringWeights } from './types';

export const PRESET_WEIGHTS: Record<ScoringPreset, ScoringWeights> = {
  balanced: {
    artist: 55,
    distance: 25,
    price: 20,
  },
  artist_first: {
    artist: 70,
    distance: 15,
    price: 15,
  },
  nearby: {
    artist: 45,
    distance: 40,
    price: 15,
  },
  value: {
    artist: 45,
    distance: 15,
    price: 40,
  },
} as const;

export const DEFAULT_PRESET: ScoringPreset = 'balanced';

export class InvalidScoringPresetError extends Error {
  readonly preset: unknown;
  constructor(preset: unknown) {
    super(
      `Invalid scoring preset: ${typeof preset === 'string' ? `'${preset}'` : String(preset)}. Valid presets are: ${VALID_RECOMMENDATION_PRESETS.join(', ')}`,
    );
    this.name = 'InvalidScoringPresetError';
    this.preset = preset;
  }
}

/**
 * Strict validator checking own-property membership in PRESET_WEIGHTS
 * and explicit inclusion in VALID_RECOMMENDATION_PRESETS allowlist.
 */
export function isValidScoringPreset(value: unknown): value is ScoringPreset {
  if (typeof value !== 'string') return false;
  if (!Object.prototype.hasOwnProperty.call(PRESET_WEIGHTS, value)) {
    return false;
  }
  return (VALID_RECOMMENDATION_PRESETS as readonly string[]).includes(value);
}

/**
 * Normalizes and validates a preset input.
 * Supports 'artist' as a recognized alias for 'artist_first'.
 * Throws InvalidScoringPresetError if the value is invalid or malformed.
 */
export function normalizeScoringPreset(value: unknown): ScoringPreset {
  if (value === 'artist') {
    return 'artist_first';
  }
  if (isValidScoringPreset(value)) {
    return value;
  }
  throw new InvalidScoringPresetError(value);
}

export function getPresetWeights(preset?: unknown): ScoringWeights {
  if (preset === null || preset === undefined) {
    return PRESET_WEIGHTS[DEFAULT_PRESET];
  }
  const normalized = normalizeScoringPreset(preset);
  return PRESET_WEIGHTS[normalized];
}

/** Bounds for the optional per-user artist-importance weight (percent). */
export const MIN_ARTIST_WEIGHT = 20;
export const MAX_ARTIST_WEIGHT = 80;

export function isValidArtistWeight(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_ARTIST_WEIGHT &&
    value <= MAX_ARTIST_WEIGHT
  );
}

/**
 * Applies the user's optional artist-importance weight on top of a preset.
 * The artist factor gets exactly `artistWeight`%; the remainder is split between distance and
 * price in the same ratio as the base preset, so a preset's character (nearby / value) is kept.
 * Null/invalid input returns the base weights unchanged. The result always sums to 100.
 */
export function applyArtistWeight(
  base: ScoringWeights,
  artistWeight?: number | null,
): ScoringWeights {
  if (!isValidArtistWeight(artistWeight)) return base;
  const rest = 100 - artistWeight;
  const denom = base.distance + base.price;
  const distance =
    denom > 0
      ? Math.round((rest * base.distance) / denom)
      : Math.round(rest / 2);
  return { artist: artistWeight, distance, price: rest - distance };
}

/**
 * Validates that weights sum to exactly 100%.
 */
export function validateWeightsSum(weights: ScoringWeights): boolean {
  const sum = weights.artist + weights.distance + weights.price;
  return Math.abs(sum - 100) < 0.001;
}
