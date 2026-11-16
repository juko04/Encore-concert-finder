import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSpotifyAffinityCache,
  getSpotifyAffinityCacheSize,
  _setAffinityCacheForTesting,
} from '@/lib/sources/spotify/affinity-service';

describe('SpotifyAffinityService - In-Memory Cache Management', () => {
  beforeEach(() => {
    clearSpotifyAffinityCache();
  });

  it('starts with an empty cache after clearSpotifyAffinityCache()', () => {
    expect(getSpotifyAffinityCacheSize()).toBe(0);
  });

  it('invalidates all time-range entries for a specified user while preserving other users', () => {
    const userA = 'user-alpha-123';
    const userB = 'user-beta-456';

    _setAffinityCacheForTesting(userA, 'short_term', []);
    _setAffinityCacheForTesting(userA, 'medium_term', []);
    _setAffinityCacheForTesting(userA, 'long_term', []);
    _setAffinityCacheForTesting(userB, 'short_term', []);
    _setAffinityCacheForTesting(userB, 'long_term', []);

    expect(getSpotifyAffinityCacheSize()).toBe(5);

    // Clear userA only
    clearSpotifyAffinityCache(userA);

    // userA entries (short, medium, long) must all be removed, userB must remain
    expect(getSpotifyAffinityCacheSize()).toBe(2);

    // Clearing userA again is idempotent
    clearSpotifyAffinityCache(userA);
    expect(getSpotifyAffinityCacheSize()).toBe(2);

    // Clearing without arguments flushes everything
    clearSpotifyAffinityCache();
    expect(getSpotifyAffinityCacheSize()).toBe(0);
  });
});
