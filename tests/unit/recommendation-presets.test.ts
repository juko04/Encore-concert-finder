import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESET,
  getPresetWeights,
  PRESET_WEIGHTS,
  validateWeightsSum,
} from '@/lib/recommendation/presets';
import { VALID_RECOMMENDATION_PRESETS } from '@/lib/domain/profile';
import type { ScoringPreset } from '@/lib/recommendation/types';

describe('Recommendation Presets & Weights', () => {
  it('defines the four required priority presets', () => {
    expect(VALID_RECOMMENDATION_PRESETS).toEqual([
      'balanced',
      'artist_first',
      'nearby',
      'value',
    ]);
  });

  it('verifies exact weights for every preset', () => {
    expect(PRESET_WEIGHTS.balanced).toEqual({
      artist: 50,
      distance: 20,
      price: 20,
      timing: 10,
    });

    expect(PRESET_WEIGHTS.artist_first).toEqual({
      artist: 65,
      distance: 15,
      price: 10,
      timing: 10,
    });

    expect(PRESET_WEIGHTS.nearby).toEqual({
      artist: 40,
      distance: 35,
      price: 15,
      timing: 10,
    });

    expect(PRESET_WEIGHTS.value).toEqual({
      artist: 40,
      distance: 15,
      price: 35,
      timing: 10,
    });
  });

  it('enforces weight normalization: every preset weights sum to exactly 100%', () => {
    for (const preset of VALID_RECOMMENDATION_PRESETS) {
      const weights = PRESET_WEIGHTS[preset];
      expect(validateWeightsSum(weights)).toBe(true);
      const total =
        weights.artist + weights.distance + weights.price + weights.timing;
      expect(total).toBe(100);
    }
  });

  it('falls back to default Balanced preset for null or invalid input', () => {
    expect(getPresetWeights(null)).toEqual(PRESET_WEIGHTS[DEFAULT_PRESET]);
    expect(getPresetWeights(undefined)).toEqual(PRESET_WEIGHTS[DEFAULT_PRESET]);
    expect(getPresetWeights('unknown_preset' as ScoringPreset)).toEqual(
      PRESET_WEIGHTS[DEFAULT_PRESET],
    );
  });
});
