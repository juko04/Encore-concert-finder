import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryProfileRepository } from '@/lib/repositories/memory-repositories';
import type { UserProfileUpdateInput } from '@/lib/domain/profile';

describe('MemoryProfileRepository (Unit Tests)', () => {
  let repo: MemoryProfileRepository;

  beforeEach(() => {
    repo = new MemoryProfileRepository();
  });

  it('returns null for an uninitialized profile', async () => {
    const profile = await repo.getProfile('user-non-existent');
    expect(profile).toBeNull();
  });

  it('creates profile with default values on initial upsert', async () => {
    const profile = await repo.upsertProfile('user-1', {
      defaultRadiusMiles: 30,
    });

    expect(profile.id).toBe('user-1');
    expect(profile.defaultRadiusMiles).toBe(30);
    expect(profile.recommendationPreset).toBe('balanced');
    expect(profile.homeLatApprox).toBeNull();
    expect(profile.maxNormalTicketPrice).toBeNull();
  });

  it('updates specific profile fields while preserving existing values', async () => {
    await repo.upsertProfile('user-2', {
      homeLatApprox: 39.7392,
      homeLngApprox: -104.9903,
      maxNormalTicketPrice: 65,
    });

    const updated = await repo.upsertProfile('user-2', {
      maxFavoriteArtistPrice: 160,
    });

    expect(updated.id).toBe('user-2');
    expect(updated.homeLatApprox).toBe(39.7392);
    expect(updated.homeLngApprox).toBe(-104.9903);
    expect(updated.maxNormalTicketPrice).toBe(65);
    expect(updated.maxFavoriteArtistPrice).toBe(160);
  });

  it('updates recommendation preset via updatePreset', async () => {
    await repo.upsertProfile('user-3', {
      recommendationPreset: 'balanced',
    });

    const updated = await repo.updatePreset('user-3', 'nearby');
    expect(updated.recommendationPreset).toBe('nearby');

    const fetched = await repo.getProfile('user-3');
    expect(fetched?.recommendationPreset).toBe('nearby');
  });
});
