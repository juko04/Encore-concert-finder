/**
 * Recommendation Scoring Presets & Fixed Priority Weights
 * Users choose one of four intuitive presets rather than configuring
 * raw numerical decimals directly.
 * Invariant: Weights for every preset must sum exactly to 100%.
 */

import { VALID_RECOMMENDATION_PRESETS } from '@/lib/domain/profile';
import type { ScoringPreset, ScoringWeights } from './types';

export const PRESET_WEIGHTS: Record<ScoringPreset, ScoringWeights> = {
  balanced: {
    artist: 50,
    distance: 20,
    price: 20,
    timing: 10,
  },
  artist_first: {
    artist: 65,
    distance: 15,
    price: 10,
    timing: 10,
  },
  nearby: {
    artist: 40,
    distance: 35,
    price: 15,
    timing: 10,
  },
  value: {
    artist: 40,
    distance: 15,
    price: 35,
    timing: 10,
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

/**
 * Validates that weights sum to exactly 100%.
 */
export function validateWeightsSum(weights: ScoringWeights): boolean {
  const sum =
    weights.artist + weights.distance + weights.price + weights.timing;
  return Math.abs(sum - 100) < 0.001;
}
