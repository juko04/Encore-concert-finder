import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESET,
  getPresetWeights,
  PRESET_WEIGHTS,
  validateWeightsSum,
  isValidScoringPreset,
  normalizeScoringPreset,
  InvalidScoringPresetError,
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

  it('falls back to default Balanced preset for null or undefined input', () => {
    expect(getPresetWeights(null)).toEqual(PRESET_WEIGHTS[DEFAULT_PRESET]);
    expect(getPresetWeights(undefined)).toEqual(PRESET_WEIGHTS[DEFAULT_PRESET]);
  });

  it('rejects invalid or malformed presets with InvalidScoringPresetError', () => {
    expect(() => getPresetWeights('unknown_preset' as ScoringPreset)).toThrow(
      InvalidScoringPresetError,
    );
    expect(() => normalizeScoringPreset('malicious_injection')).toThrow(
      InvalidScoringPresetError,
    );
  });

  it('strictly validates presets with own-property checks, rejecting prototype pollution', () => {
    expect(isValidScoringPreset('balanced')).toBe(true);
    expect(isValidScoringPreset('artist_first')).toBe(true);
    expect(isValidScoringPreset('nearby')).toBe(true);
    expect(isValidScoringPreset('value')).toBe(true);

    // Reject prototype properties and non-allowlisted strings
    expect(isValidScoringPreset('toString')).toBe(false);
    expect(isValidScoringPreset('valueOf')).toBe(false);
    expect(isValidScoringPreset('__proto__')).toBe(false);
    expect(isValidScoringPreset('constructor')).toBe(false);
    expect(isValidScoringPreset('')).toBe(false);
    expect(isValidScoringPreset(null)).toBe(false);
    expect(isValidScoringPreset(123)).toBe(false);
  });

  it('supports artist alias as a valid mapping to artist_first', () => {
    expect(normalizeScoringPreset('artist')).toBe('artist_first');
    expect(getPresetWeights('artist')).toEqual(PRESET_WEIGHTS.artist_first);
  });
});
