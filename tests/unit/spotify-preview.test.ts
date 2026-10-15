import { describe, expect, it } from 'vitest';
import {
  getSyntheticRecencyComparisons,
  getSyntheticTopArtists,
  SYNTHETIC_USER_PROFILE,
} from '@/lib/sources/spotify/synthetic-preview';

describe('Synthetic Spotify Preview Provider', () => {
  it('returns valid user profile for synthetic demo mode', () => {
    expect(SYNTHETIC_USER_PROFILE.accountId).toBe('synthetic_demo_account');
    expect(SYNTHETIC_USER_PROFILE.displayName).toBe('Encore Preview Listener');
  });

  it('returns artists ordered by rank for short_term window', () => {
    const shortTerm = getSyntheticTopArtists('short_term');
    expect(shortTerm.length).toBeGreaterThan(0);
    expect(shortTerm[0].name).toBe('Chappell Roan');
    expect(shortTerm[0].rank).toBe(1);
    expect(shortTerm[0].trend).toBe('rising');
    expect(shortTerm[0].timeRange).toBe('short_term');

    // Ranks should be monotonically increasing
    for (let i = 1; i < shortTerm.length; i++) {
      expect(shortTerm[i].rank).toBeGreaterThan(shortTerm[i - 1].rank);
    }
  });

  it('returns artists ordered by rank for medium_term window', () => {
    const mediumTerm = getSyntheticTopArtists('medium_term');
    expect(mediumTerm.length).toBeGreaterThan(0);
    expect(mediumTerm[0].name).toBe('Tame Impala');
    expect(mediumTerm[0].rank).toBe(1);
    expect(mediumTerm[0].timeRange).toBe('medium_term');
  });

  it('returns artists ordered by rank for long_term window', () => {
    const longTerm = getSyntheticTopArtists('long_term');
    expect(longTerm.length).toBeGreaterThan(0);
    expect(longTerm[0].name).toBe('Tame Impala');
    expect(longTerm[0].rank).toBe(1);
    expect(longTerm[0].trend).toBe('fading'); // Long-term #1, but fading in short-term
    expect(longTerm[0].timeRange).toBe('long_term');
  });

  it('provides recency comparisons illustrating rising, consistent, and fading trends', () => {
    const comparisons = getSyntheticRecencyComparisons();
    expect(comparisons.length).toBeGreaterThan(0);

    const rising = comparisons.filter((c) => c.trend === 'rising');
    const consistent = comparisons.filter((c) => c.trend === 'consistent');
    const fading = comparisons.filter((c) => c.trend === 'fading');

    expect(rising.length).toBeGreaterThan(0);
    expect(consistent.length).toBeGreaterThan(0);
    expect(fading.length).toBeGreaterThan(0);

    // Verify rationale is non-empty string
    for (const c of comparisons) {
      expect(typeof c.rationale).toBe('string');
      expect(c.rationale.length).toBeGreaterThan(10);
    }
  });
});

