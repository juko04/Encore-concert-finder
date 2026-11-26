import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { HomeLocation } from '@/lib/location/home-location';

const getAuthenticatedUser = vi.fn();
const getProfile = vi.fn();
const getHomeLocation = vi.fn();

vi.mock('@/lib/auth/session', () => ({
  getAuthenticatedUser: () => getAuthenticatedUser(),
}));
vi.mock('@/lib/repositories/profile-repository', () => ({
  SupabaseProfileRepository: vi.fn().mockImplementation(() => ({
    getProfile: (id: string) => getProfile(id),
  })),
}));
vi.mock('@/lib/location/server', () => ({
  getHomeLocation: (id?: string) => getHomeLocation(id),
}));

import {
  DEFAULT_RADIUS_MILES,
  resolveNearContext,
} from '@/lib/location/near-context';

const user = { id: 'user-1', email: 'a@example.test' } as unknown as User;
const SEATTLE: HomeLocation = {
  kind: 'city',
  label: 'Seattle',
  city: 'Seattle',
  state: 'WA',
  lat: 47.6062,
  lng: -122.3321,
};
const DENVER: HomeLocation = {
  kind: 'city',
  label: 'Denver',
  city: 'Denver',
  state: 'CO',
  lat: 39.7392,
  lng: -104.9903,
};

describe('resolveNearContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUser.mockResolvedValue(null);
    getProfile.mockResolvedValue(null);
    getHomeLocation.mockResolvedValue(null);
  });

  it('signed-in user with a profile radius and a home: scope uses the profile radius', async () => {
    getProfile.mockResolvedValue({ defaultRadiusMiles: 60 });
    getHomeLocation.mockResolvedValue(DENVER);
    const ctx = await resolveNearContext(user);
    expect(ctx.radiusMiles).toBe(60);
    expect(ctx.scope).toEqual({
      home: { lat: DENVER.lat, lng: DENVER.lng },
      radiusMiles: 60,
    });
    expect(getProfile).toHaveBeenCalledWith('user-1');
    expect(getHomeLocation).toHaveBeenCalledWith('user-1');
  });

  it('signed-in user without a profile gets the default radius', async () => {
    getProfile.mockResolvedValue(null);
    getHomeLocation.mockResolvedValue(DENVER);
    const ctx = await resolveNearContext(user);
    expect(ctx.profile).toBeNull();
    expect(ctx.radiusMiles).toBe(DEFAULT_RADIUS_MILES);
    expect(ctx.scope?.radiusMiles).toBe(DEFAULT_RADIUS_MILES);
  });

  it('a profile that has no saved radius also falls back to the default', async () => {
    getProfile.mockResolvedValue({ defaultRadiusMiles: null });
    getHomeLocation.mockResolvedValue(DENVER);
    expect((await resolveNearContext(user)).radiusMiles).toBe(
      DEFAULT_RADIUS_MILES,
    );
  });

  it('a profile load failure does not break the context (default radius, home still used)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getProfile.mockRejectedValue(new Error('db down'));
    getHomeLocation.mockResolvedValue(DENVER);
    const ctx = await resolveNearContext(user);
    expect(ctx.profile).toBeNull();
    expect(ctx.radiusMiles).toBe(DEFAULT_RADIUS_MILES);
    expect(ctx.scope).not.toBeNull();
    spy.mockRestore();
  });

  it('uses whatever home getHomeLocation resolved (cookie wins over the saved profile home)', async () => {
    // getHomeLocation reads the cookie first and only then the profile coordinate, so a cookie
    // home (Seattle) is what the scope must use even if the profile home were Denver.
    getProfile.mockResolvedValue({
      defaultRadiusMiles: 30,
      homeLatApprox: DENVER.lat,
      homeLngApprox: DENVER.lng,
    });
    getHomeLocation.mockResolvedValue(SEATTLE);
    const ctx = await resolveNearContext(user);
    expect(ctx.home).toEqual(SEATTLE);
    expect(ctx.scope?.home).toEqual({ lat: SEATTLE.lat, lng: SEATTLE.lng });

    // No cookie: getHomeLocation falls back to the profile coordinate.
    getHomeLocation.mockResolvedValue(DENVER);
    const ctx2 = await resolveNearContext(user);
    expect(ctx2.scope?.home).toEqual({ lat: DENVER.lat, lng: DENVER.lng });
  });

  it('signed-in user with no home location: scope is null (radius never guessed)', async () => {
    getProfile.mockResolvedValue({ defaultRadiusMiles: 40 });
    getHomeLocation.mockResolvedValue(null);
    const ctx = await resolveNearContext(user);
    expect(ctx.home).toBeNull();
    expect(ctx.scope).toBeNull();
    expect(ctx.radiusMiles).toBe(40);
  });

  it('guest: no user, no profile lookup, no home, scope null, default radius', async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const ctx = await resolveNearContext();
    expect(ctx).toMatchObject({
      user: null,
      profile: null,
      home: null,
      scope: null,
      radiusMiles: DEFAULT_RADIUS_MILES,
    });
    expect(getProfile).not.toHaveBeenCalled();
    expect(getHomeLocation).not.toHaveBeenCalled();
  });

  it('an explicit null user (already authenticated as guest) skips the session lookup', async () => {
    await resolveNearContext(null);
    expect(getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it('looks the user up from the session when none is passed', async () => {
    getAuthenticatedUser.mockResolvedValue(user);
    getHomeLocation.mockResolvedValue(DENVER);
    const ctx = await resolveNearContext();
    expect(ctx.user).toBe(user);
    expect(ctx.scope).not.toBeNull();
  });

  it('takes no client input: the signature carries no coordinates or radius, so client values cannot reach the scope', async () => {
    getProfile.mockResolvedValue({ defaultRadiusMiles: 25 });
    getHomeLocation.mockResolvedValue(DENVER);
    // Extra (client-style) arguments are ignored: only the session user + server state count.
    const fn = resolveNearContext as unknown as (
      ...a: unknown[]
    ) => ReturnType<typeof resolveNearContext>;
    const ctx = await fn(user, { lat: 1, lng: 2, radiusMiles: 5000 });
    expect(ctx.scope).toEqual({
      home: { lat: DENVER.lat, lng: DENVER.lng },
      radiusMiles: 25,
    });
    expect(resolveNearContext.length).toBeLessThanOrEqual(1);
  });
});
