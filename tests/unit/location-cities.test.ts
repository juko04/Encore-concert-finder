import { describe, expect, it } from 'vitest';
import {
  CITIES,
  findCityByName,
  findCityBySlug,
  findNearestCity,
  searchCities,
} from '@/lib/location/cities';
import {
  HOME_LOCATION_COOKIE,
  homeLocationInputSchema,
  readHomeLocationFromCookieString,
  resolveHomeLocation,
  serializeHomeLocation,
} from '@/lib/location/home-location';
import { calculateHaversineDistanceMiles } from '@/lib/recommendation/factors/distance';

describe('city table', () => {
  it('has unique slugs and valid coordinates', () => {
    const slugs = new Set<string>();
    for (const c of CITIES) {
      expect(slugs.has(c.slug)).toBe(false);
      slugs.add(c.slug);
      expect(c.lat).toBeGreaterThan(30);
      expect(c.lat).toBeLessThan(46);
      expect(c.lng).toBeGreaterThan(-118);
      expect(c.lng).toBeLessThan(-94);
      expect(c.state).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('puts Colorado first and includes the regional hubs', () => {
    expect(CITIES[0].name).toBe('Denver');
    for (const slug of [
      'denver-co',
      'boulder-co',
      'salt-lake-city-ut',
      'cheyenne-wy',
      'albuquerque-nm',
      'santa-fe-nm',
      'boise-id',
      'wichita-ks',
      'topeka-ks',
    ]) {
      expect(findCityBySlug(slug)).not.toBeNull();
    }
  });

  it('yields plausible real-world distances', () => {
    const d = (a: string, b: string) => {
      const x = findCityBySlug(a)!;
      const y = findCityBySlug(b)!;
      return calculateHaversineDistanceMiles(x.lat, x.lng, y.lat, y.lng);
    };
    expect(d('denver-co', 'boulder-co')).toBeGreaterThan(22);
    expect(d('denver-co', 'boulder-co')).toBeLessThan(32);
    expect(d('denver-co', 'colorado-springs-co')).toBeGreaterThan(55);
    expect(d('denver-co', 'colorado-springs-co')).toBeLessThan(75);
    expect(d('denver-co', 'salt-lake-city-ut')).toBeGreaterThan(340);
    expect(d('denver-co', 'salt-lake-city-ut')).toBeLessThan(400);
  });

  it('matches names without guessing between same-named cities', () => {
    expect(findCityByName('Boulder')?.slug).toBe('boulder-co');
    expect(findCityByName(' boulder ', 'co')?.slug).toBe('boulder-co');
    expect(findCityByName('Kansas City')).toBeNull();
    expect(findCityByName('Kansas City', 'KS')?.slug).toBe('kansas-city-ks');
    expect(findCityByName('Nowhereville', 'CO')).toBeNull();
    expect(findCityByName(null)).toBeNull();
  });

  it('finds the nearest known city only within range', () => {
    const nearBoulder = findNearestCity(40.02, -105.27);
    expect(nearBoulder?.city.slug).toBe('boulder-co');
    expect(findNearestCity(36.0, -112.0)).toBeNull();
  });

  it('filters cities by text', () => {
    expect(searchCities('boul').map((c) => c.name)).toContain('Boulder');
    expect(searchCities('ut').some((c) => c.state === 'UT')).toBe(true);
    expect(searchCities('zzzz')).toHaveLength(0);
  });
});

describe('home location cookie', () => {
  it('round-trips a city', () => {
    const value = serializeHomeLocation({ kind: 'city', slug: 'boulder-co' });
    expect(value).toBe('city:boulder-co');
    const loc = resolveHomeLocation(value);
    expect(loc).toMatchObject({
      kind: 'city',
      label: 'Boulder',
      city: 'Boulder',
      state: 'CO',
    });
  });

  it('rounds coordinates and labels the nearest city', () => {
    const value = serializeHomeLocation({
      kind: 'geo',
      lat: 39.739236,
      lng: -104.990251,
    });
    expect(value).toBe('geo:39.74|-104.99');
    const loc = resolveHomeLocation(value);
    expect(loc?.kind).toBe('geo');
    expect(loc?.lat).toBe(39.74);
    expect(loc?.lng).toBe(-104.99);
    expect(loc?.label).toBe('Denver');
  });

  it('labels a far-away coordinate as "Your area" without a city', () => {
    const loc = resolveHomeLocation('geo:36|-112');
    expect(loc?.label).toBe('Your area');
    expect(loc?.city).toBeUndefined();
  });

  it('rejects unknown slugs and malformed values', () => {
    expect(
      serializeHomeLocation({ kind: 'city', slug: 'atlantis' }),
    ).toBeNull();
    for (const bad of [
      '',
      null,
      undefined,
      'city:atlantis',
      'geo:abc|def',
      'geo:91|0',
      'geo:0|181',
      'geo:39.7',
      'geo:1|2|3',
      'nonsense',
      '%E0%A4%A',
    ]) {
      expect(resolveHomeLocation(bad as string | null | undefined)).toBeNull();
    }
  });

  it('validates action input strictly', () => {
    expect(
      homeLocationInputSchema.safeParse({ kind: 'geo', lat: 95, lng: 0 })
        .success,
    ).toBe(false);
    expect(
      homeLocationInputSchema.safeParse({ kind: 'geo', lat: NaN, lng: 0 })
        .success,
    ).toBe(false);
    expect(
      homeLocationInputSchema.safeParse({ kind: 'city', slug: '' }).success,
    ).toBe(false);
    expect(
      homeLocationInputSchema.safeParse({ kind: 'user', id: 'x' }).success,
    ).toBe(false);
  });

  it('reads the cookie from a document.cookie string', () => {
    const str = `a=1; ${HOME_LOCATION_COOKIE}=city%3Aboulder-co; b=2`;
    expect(readHomeLocationFromCookieString(str)?.label).toBe('Boulder');
    expect(readHomeLocationFromCookieString('a=1; b=2')).toBeNull();
  });
});
