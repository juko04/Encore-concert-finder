import { describe, expect, it } from 'vitest';
import { getPersonalizedDiscoverData } from '@/lib/recommendation/service';
import {
  MemoryCatalogRepository,
  MemoryProfileRepository,
  MemoryUserPreferenceRepository,
} from '@/lib/repositories/memory-repositories';

function setup() {
  const catalogRepo = new MemoryCatalogRepository();
  return {
    catalogRepo,
    profileRepo: new MemoryProfileRepository(),
    prefRepo: new MemoryUserPreferenceRepository(catalogRepo),
  };
}
const base = {
  referenceDate: '2026-11-24',
  referenceInstant: '2026-11-24T12:00:00Z',
};

describe('personalized discovery uses one location source', () => {
  it('reports no location when neither profile nor override exists', async () => {
    const r = await getPersonalizedDiscoverData({
      userId: 'u1',
      ...setup(),
      ...base,
    });
    expect(r.isLocationConfigured).toBe(false);
  });

  it('a selected/restored location (override) counts as configured even without profile coordinates', async () => {
    const r = await getPersonalizedDiscoverData({
      userId: 'u1',
      ...setup(),
      ...base,
      locationOverride: { lat: 39.74, lng: -104.99 },
    });
    expect(r.isLocationConfigured).toBe(true);
    expect(r.userProfile?.homeLatApprox).toBe(39.74);
  });

  it('override takes precedence over stale stored profile coordinates', async () => {
    const s = setup();
    await s.profileRepo.upsertProfile('u1', {
      homeLatApprox: 36.17,
      homeLngApprox: -115.14,
    });
    const r = await getPersonalizedDiscoverData({
      userId: 'u1',
      ...s,
      ...base,
      locationOverride: { lat: 39.74, lng: -104.99 },
    });
    expect(r.userProfile?.homeLatApprox).toBe(39.74);
    expect(r.userProfile?.homeLngApprox).toBe(-104.99);
  });

  it('an invalid override is ignored and the stored profile location is kept', async () => {
    const s = setup();
    await s.profileRepo.upsertProfile('u1', {
      homeLatApprox: 36.17,
      homeLngApprox: -115.14,
    });
    const r = await getPersonalizedDiscoverData({
      userId: 'u1',
      ...s,
      ...base,
      locationOverride: { lat: 999, lng: 0 },
    });
    expect(r.userProfile?.homeLatApprox).toBe(36.17);
  });
});
