/**
 * Static reference table of approximate city centroids.
 *
 * Why it exists: venues and events in the catalog mostly have no coordinates, so
 * distance fit falls back to a city-level approximation. These coordinates are
 * hand-entered, well-known approximate city centers (not scraped, not looked up
 * at runtime). Colorado first (product priority), then the regional priority
 * hubs from the product decisions doc (UT, WY, NM, ID, KS).
 *
 * Privacy: no IP lookup and no third-party calls anywhere in this module.
 * Distances computed from these centroids are approximations and must be
 * labelled as such wherever they are shown.
 */

import { calculateHaversineDistanceMiles } from '@/lib/recommendation/factors/distance';

export interface CityEntry {
  /** Stable lowercase slug, e.g. "denver-co". Safe for cookies and URLs. */
  slug: string;
  name: string;
  /** Two-letter US state code. */
  state: string;
  lat: number;
  lng: number;
  /** IANA timezone of the city (used for the viewer's "today" when no browser timezone is known). */
  timezone: string;
}

/**
 * Default IANA timezone per state in the table. States that span two zones are listed with the
 * zone of the cities actually in the table; a city in the other part of a split state must pass an
 * explicit timezone to city() (e.g. a Pacific-time Idaho panhandle city).
 */
const STATE_TIMEZONE: Readonly<Record<string, string>> = {
  CO: 'America/Denver',
  UT: 'America/Denver',
  WY: 'America/Denver',
  NM: 'America/Denver',
  // Idaho spans Mountain and Pacific: every Idaho city in the table (Boise, Ketchum, Idaho Falls)
  // is Mountain time. IANA uses America/Boise for Idaho's Mountain portion.
  ID: 'America/Boise',
  // Kansas and Missouri cities in the table are Central time (Kansas has four far-west Mountain
  // counties; none of those cities are in the table).
  KS: 'America/Chicago',
  MO: 'America/Chicago',
};

function city(
  name: string,
  state: string,
  lat: number,
  lng: number,
  timezone?: string,
): CityEntry {
  const slug = `${name}-${state}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const tz = timezone ?? STATE_TIMEZONE[state];
  if (!tz) {
    throw new Error(
      `No timezone defined for ${name}, ${state} in the city table`,
    );
  }
  return { slug, name, state, lat, lng, timezone: tz };
}

export const CITIES: readonly CityEntry[] = [
  // Colorado: Front Range
  city('Denver', 'CO', 39.7392, -104.9903),
  city('Boulder', 'CO', 40.015, -105.2705),
  city('Aurora', 'CO', 39.7294, -104.8319),
  city('Lakewood', 'CO', 39.7047, -105.0814),
  city('Golden', 'CO', 39.7555, -105.2211),
  city('Arvada', 'CO', 39.8028, -105.0875),
  city('Westminster', 'CO', 39.8367, -105.0372),
  city('Thornton', 'CO', 39.868, -104.9719),
  city('Englewood', 'CO', 39.6478, -104.9878),
  city('Littleton', 'CO', 39.6133, -105.0166),
  city('Greenwood Village', 'CO', 39.6172, -104.9503),
  city('Centennial', 'CO', 39.5792, -104.8769),
  city('Lone Tree', 'CO', 39.5434, -104.8919),
  city('Parker', 'CO', 39.5186, -104.7614),
  city('Castle Rock', 'CO', 39.3722, -104.8561),
  city('Morrison', 'CO', 39.6536, -105.1911),
  city('Evergreen', 'CO', 39.6333, -105.3172),
  city('Broomfield', 'CO', 39.9205, -105.0867),
  city('Louisville', 'CO', 39.9778, -105.1319),
  city('Lafayette', 'CO', 39.9936, -105.0897),
  city('Longmont', 'CO', 40.1672, -105.1019),
  city('Nederland', 'CO', 39.9614, -105.5108),
  city('Loveland', 'CO', 40.3978, -105.075),
  city('Fort Collins', 'CO', 40.5853, -105.0844),
  city('Greeley', 'CO', 40.4233, -104.7091),
  city('Estes Park', 'CO', 40.3772, -105.5217),
  city('Colorado Springs', 'CO', 38.8339, -104.8214),
  city('Manitou Springs', 'CO', 38.8597, -104.9172),
  city('Pueblo', 'CO', 38.2544, -104.6091),
  // Colorado: mountains and western slope
  city('Idaho Springs', 'CO', 39.7425, -105.513),
  city('Winter Park', 'CO', 39.8917, -105.7631),
  city('Breckenridge', 'CO', 39.4817, -106.0384),
  city('Frisco', 'CO', 39.5744, -106.0975),
  city('Dillon', 'CO', 39.6303, -106.0434),
  city('Silverthorne', 'CO', 39.6297, -106.072),
  city('Vail', 'CO', 39.6403, -106.3742),
  city('Avon', 'CO', 39.6319, -106.5222),
  city('Aspen', 'CO', 39.1911, -106.8175),
  city('Snowmass Village', 'CO', 39.213, -106.9378),
  city('Carbondale', 'CO', 39.4025, -107.2111),
  city('Glenwood Springs', 'CO', 39.5505, -107.3248),
  city('Steamboat Springs', 'CO', 40.485, -106.8317),
  city('Crested Butte', 'CO', 38.8697, -106.9878),
  city('Salida', 'CO', 38.5347, -105.9989),
  city('Telluride', 'CO', 37.9375, -107.8123),
  city('Durango', 'CO', 37.2753, -107.8801),
  city('Grand Junction', 'CO', 39.0639, -108.5506),
  // Regional priority: Utah
  city('Salt Lake City', 'UT', 40.7608, -111.891),
  city('Park City', 'UT', 40.6461, -111.498),
  city('Ogden', 'UT', 41.223, -111.9738),
  city('Provo', 'UT', 40.2338, -111.6585),
  city('Moab', 'UT', 38.5733, -109.5498),
  // Regional priority: Wyoming
  city('Cheyenne', 'WY', 41.14, -104.8202),
  city('Laramie', 'WY', 41.3114, -105.5911),
  city('Casper', 'WY', 42.8666, -106.3131),
  city('Jackson', 'WY', 43.4799, -110.7624),
  // Regional priority: New Mexico
  city('Albuquerque', 'NM', 35.0844, -106.6504),
  city('Santa Fe', 'NM', 35.687, -105.9378),
  city('Taos', 'NM', 36.4072, -105.5734),
  city('Las Cruces', 'NM', 32.3199, -106.7637),
  // Regional priority: Idaho
  city('Boise', 'ID', 43.615, -116.2023),
  city('Ketchum', 'ID', 43.6807, -114.3637),
  city('Idaho Falls', 'ID', 43.4917, -112.0339),
  // Regional priority: Kansas (and Kansas City, MO)
  city('Kansas City', 'MO', 39.0997, -94.5786),
  city('Kansas City', 'KS', 39.1141, -94.6275),
  city('Overland Park', 'KS', 38.9822, -94.6708),
  city('Lawrence', 'KS', 38.9717, -95.2353),
  city('Topeka', 'KS', 39.0473, -95.6752),
  city('Wichita', 'KS', 37.6872, -97.3301),
];

const BY_SLUG = new Map(CITIES.map((c) => [c.slug, c]));

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findCityBySlug(slug: unknown): CityEntry | null {
  return typeof slug === 'string' ? (BY_SLUG.get(slug) ?? null) : null;
}

/**
 * Looks up a city by its display name (and state when known). Without a state
 * the match is only accepted when the name is unambiguous in the table, so we
 * never guess between e.g. Kansas City, MO and Kansas City, KS.
 */
export function findCityByName(
  name: string | null | undefined,
  state?: string | null,
): CityEntry | null {
  if (!name) return null;
  const target = normalizeName(name);
  if (!target) return null;
  const matches = CITIES.filter((c) => normalizeName(c.name) === target);
  if (matches.length === 0) return null;
  const st = state?.trim().toUpperCase();
  if (st) {
    const exact = matches.filter((c) => c.state === st);
    return exact.length === 1 ? exact[0] : null;
  }
  return matches.length === 1 ? matches[0] : null;
}

/** Default maximum distance for labelling a coordinate with a known city. */
export const NEAREST_CITY_MAX_MILES = 40;

export function findNearestCity(
  lat: number,
  lng: number,
  maxMiles: number = NEAREST_CITY_MAX_MILES,
): { city: CityEntry; distanceMiles: number } | null {
  let best: { city: CityEntry; distanceMiles: number } | null = null;
  for (const c of CITIES) {
    const d = calculateHaversineDistanceMiles(lat, lng, c.lat, c.lng);
    if (!best || d < best.distanceMiles) best = { city: c, distanceMiles: d };
  }
  return best && best.distanceMiles <= maxMiles ? best : null;
}

/** Text filter for the picker: matches name, state, or "name, ST". */
export function searchCities(query: string, limit = 60): CityEntry[] {
  const q = normalizeName(query);
  if (!q) return CITIES.slice(0, limit);
  return CITIES.filter((c) => {
    const hay = normalizeName(`${c.name} ${c.state}`);
    return hay.includes(q);
  }).slice(0, limit);
}
