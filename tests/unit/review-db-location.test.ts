import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore = new Map<string, string>();
const authState: { user: { id: string } | null } = { user: null };
const profileState: {
  profile: Record<string, unknown> | null;
  throws: boolean;
} = { profile: null, throws: false };

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) =>
      cookieStore.has(k) ? { name: k, value: cookieStore.get(k)! } : undefined,
  }),
}));
vi.mock('@/lib/auth/session', () => ({
  getAuthenticatedUser: async () => authState.user,
}));
vi.mock('@/lib/repositories/profile-repository', () => ({
  SupabaseProfileRepository: class {
    async getProfile() {
      if (profileState.throws) throw new Error('db down');
      return profileState.profile;
    }
  },
}));

import {
  getHomeLocation,
  homeLocationFromProfileCoords,
} from '@/lib/location/server';
import { GET } from '@/app/api/location/route';
import { applyLocationOverride } from '@/lib/recommendation/service';

beforeEach(() => {
  cookieStore.clear();
  authState.user = null;
  profileState.profile = null;
  profileState.throws = false;
});

describe('homeLocationFromProfileCoords', () => {
  it('maps valid coordinates to the nearest known city', () => {
    const loc = homeLocationFromProfileCoords(39.74, -104.99);
    expect(loc?.kind).toBe('geo');
    expect(loc?.city).toBe('Denver');
  });
  it.each([
    [null, null],
    [undefined, -104.99],
    [91, 0],
    [0, 181],
    [Number.NaN, 0],
    [Infinity, 0],
  ])('rejects invalid pair %s,%s', (lat, lng) => {
    expect(
      homeLocationFromProfileCoords(lat as number | null, lng as number | null),
    ).toBeNull();
  });
});

describe('getHomeLocation', () => {
  it('prefers a valid cookie over the profile', async () => {
    cookieStore.set('encore_home_city', 'city:denver-co');
    authState.user = { id: 'u1' };
    profileState.profile = { homeLatApprox: 36.17, homeLngApprox: -115.14 };
    expect((await getHomeLocation())?.city).toBe('Denver');
  });
  it('ignores a garbage cookie and falls back to the signed-in profile', async () => {
    cookieStore.set('encore_home_city', 'geo:999|abc');
    authState.user = { id: 'u1' };
    profileState.profile = { homeLatApprox: 39.74, homeLngApprox: -104.99 };
    expect((await getHomeLocation('u1'))?.city).toBe('Denver');
  });
  it('returns null for guests with no cookie (no IP lookup, no default city)', async () => {
    expect(await getHomeLocation()).toBeNull();
  });
  it('never trusts a client-supplied userId that differs from the session', async () => {
    authState.user = { id: 'u1' };
    profileState.profile = { homeLatApprox: 39.74, homeLngApprox: -104.99 };
    expect(await getHomeLocation('someone-else')).toBeNull();
  });
  it('returns null (does not throw) when the profile read fails', async () => {
    authState.user = { id: 'u1' };
    profileState.throws = true;
    expect(await getHomeLocation()).toBeNull();
  });
  it('returns null when the profile has no coordinates', async () => {
    authState.user = { id: 'u1' };
    profileState.profile = { homeLatApprox: null, homeLngApprox: null };
    expect(await getHomeLocation()).toBeNull();
  });
});

describe('GET /api/location', () => {
  it('401s for guests and sets no cookie', async () => {
    const res = await GET();
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('restores the profile location and sets the cookie', async () => {
    authState.user = { id: 'u1' };
    profileState.profile = { homeLatApprox: 39.74, homeLngApprox: -104.99 };
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.location.city).toBe('Denver');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('encore_home_city=geo');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
  });
  it('returns null location (200, no cookie) when nothing is saved', async () => {
    authState.user = { id: 'u1' };
    profileState.profile = null;
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).location).toBeNull();
    expect(res.headers.get('set-cookie')).toBeNull();
  });
  it('500s without leaking details when the profile read fails', async () => {
    authState.user = { id: 'u1' };
    profileState.throws = true;
    const res = await GET();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('db down');
  });
  it('does not accept a user id from the request', () => {
    expect(GET.length).toBe(0);
  });
});

describe('applyLocationOverride (consistent location for scoring, nearby filter, flag)', () => {
  const stored = {
    id: 'u1',
    homeLatApprox: 36.17,
    homeLngApprox: -115.14,
    defaultRadiusMiles: 40,
  } as never;

  it('override wins over stored profile coordinates and keeps other fields', () => {
    const p = applyLocationOverride(stored, { lat: 39.74, lng: -104.99 }, 'u1');
    expect(p?.homeLatApprox).toBe(39.74);
    expect(p?.homeLngApprox).toBe(-104.99);
    expect(p?.defaultRadiusMiles).toBe(40);
  });
  it('builds a minimal profile when none is stored', () => {
    const p = applyLocationOverride(null, { lat: 39.74, lng: -104.99 }, 'u1');
    expect(p?.id).toBe('u1');
    expect(p?.homeLatApprox).toBe(39.74);
  });
  it.each([
    [{ lat: Number.NaN, lng: 0 }],
    [{ lat: 95, lng: 0 }],
    [{ lat: 0, lng: -181 }],
    [null],
    [undefined],
  ])('ignores invalid override %j', (o) => {
    expect(applyLocationOverride(stored, o as never, 'u1')).toBe(stored);
    expect(applyLocationOverride(null, o as never, 'u1')).toBeNull();
  });
});
