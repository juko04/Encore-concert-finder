/**
 * Recommendation Scoring Presets & Fixed Priority Weights
 * Users choose one of four intuitive presets rather than configuring
 * raw numerical decimals directly.
 * Invariant: Weights for every preset must sum exactly to 100%.
 */

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

export function getPresetWeights(
  preset?: ScoringPreset | null,
): ScoringWeights {
  if (!preset || !(preset in PRESET_WEIGHTS)) {
    return PRESET_WEIGHTS[DEFAULT_PRESET];
  }
  return PRESET_WEIGHTS[preset];
}

/**
 * Validates that weights sum to exactly 100%.
 */
export function validateWeightsSum(weights: ScoringWeights): boolean {
  const sum =
    weights.artist + weights.distance + weights.price + weights.timing;
  return Math.abs(sum - 100) < 0.001;
}
