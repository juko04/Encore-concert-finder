import { describe, expect, it } from 'vitest';
import {
  PRESET_WEIGHTS,
  applyArtistWeight,
  isValidArtistWeight,
  validateWeightsSum,
} from '@/lib/recommendation/presets';
import { parsePreferencesInput } from '@/lib/preferences/validate';
import {
  eventDistanceMiles,
  filterEventsWithinRadius,
} from '@/lib/location/radius';

const DENVER = { lat: 39.7392, lng: -104.9903 };

describe('applyArtistWeight', () => {
  it('returns the preset unchanged when no custom weight is set', () => {
    expect(applyArtistWeight(PRESET_WEIGHTS.balanced, null)).toEqual(
      PRESET_WEIGHTS.balanced,
    );
    expect(applyArtistWeight(PRESET_WEIGHTS.balanced, undefined)).toEqual(
      PRESET_WEIGHTS.balanced,
    );
  });

  it('ignores out-of-range or non-integer weights', () => {
    for (const bad of [0, 19, 81, 100, 55.5, Number.NaN, -10]) {
      expect(applyArtistWeight(PRESET_WEIGHTS.balanced, bad)).toEqual(
        PRESET_WEIGHTS.balanced,
      );
    }
  });

  it('always sums to exactly 100 for every preset and every allowed weight', () => {
    for (const preset of Object.values(PRESET_WEIGHTS)) {
      for (let w = 20; w <= 80; w += 1) {
        const out = applyArtistWeight(preset, w);
        expect(out.artist).toBe(w);
        expect(validateWeightsSum(out)).toBe(true);
        expect(out.distance).toBeGreaterThanOrEqual(0);
        expect(out.price).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps the preset distance:price character when re-weighting', () => {
    const nearby = applyArtistWeight(PRESET_WEIGHTS.nearby, 30);
    expect(nearby.distance).toBeGreaterThan(nearby.price);
    const value = applyArtistWeight(PRESET_WEIGHTS.value, 30);
    expect(value.price).toBeGreaterThan(value.distance);
  });

  it('moving the slider toward artists raises artist weight and lowers the rest', () => {
    const low = applyArtistWeight(PRESET_WEIGHTS.balanced, 30);
    const high = applyArtistWeight(PRESET_WEIGHTS.balanced, 75);
    expect(high.artist).toBeGreaterThan(low.artist);
    expect(high.distance + high.price).toBeLessThan(low.distance + low.price);
  });

  it('validates the allowed range', () => {
    expect(isValidArtistWeight(20)).toBe(true);
    expect(isValidArtistWeight(80)).toBe(true);
    expect(isValidArtistWeight(19)).toBe(false);
    expect(isValidArtistWeight(81)).toBe(false);
    expect(isValidArtistWeight('50')).toBe(false);
  });
});

describe('parsePreferencesInput', () => {
  const valid = {
    defaultRadiusMiles: 50,
    maxNormalTicketPrice: 40,
    maxFavoriteArtistPrice: 120,
    maxSpontaneousPrice: 25,
    recommendationPreset: 'balanced',
    artistWeight: 60,
  };

  it('accepts a complete valid payload', () => {
    const res = parsePreferencesInput(valid);
    expect(res).toEqual({ ok: true, value: valid });
  });

  it('treats blank/null prices as "no limit" and null weight as "use preset"', () => {
    const res = parsePreferencesInput({
      ...valid,
      maxNormalTicketPrice: '',
      maxFavoriteArtistPrice: null,
      maxSpontaneousPrice: undefined,
      artistWeight: null,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.maxNormalTicketPrice).toBeNull();
      expect(res.value.maxFavoriteArtistPrice).toBeNull();
      expect(res.value.maxSpontaneousPrice).toBeNull();
      expect(res.value.artistWeight).toBeNull();
    }
  });

  it('accepts numeric strings (form inputs) and rounds prices to cents', () => {
    const res = parsePreferencesInput({
      ...valid,
      defaultRadiusMiles: '75',
      maxNormalTicketPrice: '39.999',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.defaultRadiusMiles).toBe(75);
      expect(res.value.maxNormalTicketPrice).toBe(40);
    }
  });

  it.each([
    ['radius too small', { defaultRadiusMiles: 4 }],
    ['radius too large', { defaultRadiusMiles: 501 }],
    ['radius not an integer', { defaultRadiusMiles: 10.5 }],
    ['radius missing', { defaultRadiusMiles: '' }],
    ['zero budget', { maxNormalTicketPrice: 0 }],
    ['negative budget', { maxFavoriteArtistPrice: -5 }],
    ['absurd budget', { maxSpontaneousPrice: 5000 }],
    ['non-numeric budget', { maxNormalTicketPrice: 'cheap' }],
    ['Infinity budget', { maxNormalTicketPrice: Infinity }],
    ['unknown preset', { recommendationPreset: 'hacker' }],
    ['prototype-key preset', { recommendationPreset: 'constructor' }],
    ['artist weight below range', { artistWeight: 10 }],
    ['artist weight above range', { artistWeight: 95 }],
    ['artist weight not a number', { artistWeight: 'lots' }],
  ])('rejects %s', (_name, patch) => {
    const res = parsePreferencesInput({ ...valid, ...patch });
    expect(res.ok).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(parsePreferencesInput(null).ok).toBe(false);
    expect(parsePreferencesInput('x').ok).toBe(false);
    expect(parsePreferencesInput(undefined).ok).toBe(false);
  });
});

describe('radius filtering', () => {
  const events = [
    { id: 'denver', city: 'Denver', region: 'CO' },
    { id: 'morrison', city: 'Morrison', region: 'CO' },
    { id: 'boulder', city: 'Boulder', region: 'CO' },
    { id: 'springs', city: 'Colorado Springs', region: 'CO' },
    { id: 'la', city: 'Los Angeles', region: 'CA' },
    { id: 'unknown-city', city: 'Nowhereville', region: 'CO' },
    { id: 'no-city' },
    { id: 'coords-near', lat: 39.75, lng: -105.0 },
  ];

  it('uses the city centroid when a venue has no coordinates', () => {
    const d = eventDistanceMiles({ city: 'Boulder', region: 'CO' }, DENVER);
    expect(d).not.toBeNull();
    expect(d as number).toBeGreaterThan(20);
    expect(d as number).toBeLessThan(35);
  });

  it('prefers real venue coordinates over the city centroid', () => {
    const d = eventDistanceMiles(
      { lat: 39.75, lng: -105.0, city: 'Los Angeles', region: 'CA' },
      DENVER,
    );
    expect(d as number).toBeLessThan(2);
  });

  it('returns null (unknown) rather than guessing for unlocatable events', () => {
    expect(
      eventDistanceMiles({ city: 'Nowhereville', region: 'CO' }, DENVER),
    ).toBeNull();
    expect(eventDistanceMiles({}, DENVER)).toBeNull();
  });

  it('keeps only known-location events inside the radius', () => {
    const within25 = filterEventsWithinRadius(events, DENVER, 25).map(
      (e) => e.id,
    );
    expect(within25).toEqual(
      expect.arrayContaining(['denver', 'morrison', 'coords-near']),
    );
    expect(within25).not.toContain('springs');
    expect(within25).not.toContain('la');
    expect(within25).not.toContain('unknown-city');
    expect(within25).not.toContain('no-city');
  });

  it('a larger radius includes more shows (monotonic)', () => {
    const r25 = filterEventsWithinRadius(events, DENVER, 25).length;
    const r50 = filterEventsWithinRadius(events, DENVER, 50).length;
    const r100 = filterEventsWithinRadius(events, DENVER, 100).length;
    expect(r50).toBeGreaterThanOrEqual(r25);
    expect(r100).toBeGreaterThanOrEqual(r50);
    expect(
      filterEventsWithinRadius(events, DENVER, 100).map((e) => e.id),
    ).toContain('springs');
  });
});
