import crypto from 'node:crypto';
import type { Source } from '@/lib/domain/source';
import type { ISourceRepository } from '@/lib/repositories/interfaces';
import type { VenueSourceConfig } from './types';

// Cervantes' Masterpiece Ballroom (PR #13)
export const CERVANTES_SOURCE_SLUG = 'cervantes-masterpiece';
export const CERVANTES_DEFAULT_SOURCE_ID =
  'b0000000-0000-0000-0000-000000000004';

export const CERVANTES_CONFIG: VenueSourceConfig = {
  id: CERVANTES_DEFAULT_SOURCE_ID,
  slug: CERVANTES_SOURCE_SLUG,
  name: "Cervantes' Masterpiece Ballroom",
  baseUrl: 'https://cervantesmasterpiece.com',
  calendarUrl: 'https://cervantesmasterpiece.com/events/',
  city: 'Denver',
  state: 'CO',
  country: 'US',
  defaultTimezone: 'America/Denver',
  reliabilityScore: 0.98,
  parserVersion: '1.0.0',
  defaultAddress: '2637 Welton Street',
  defaultPostalCode: '80205',
  defaultCoordinates: {
    latitude: 39.7547,
    longitude: -104.9785,
  },
};

// Larimer Lounge (PR #14)
export const LARIMER_LOUNGE_SOURCE_SLUG = 'larimer-lounge';
export const LARIMER_LOUNGE_DEFAULT_SOURCE_ID =
  'b0000000-0000-0000-0000-000000000005';

export const LARIMER_LOUNGE_CONFIG: VenueSourceConfig = {
  id: LARIMER_LOUNGE_DEFAULT_SOURCE_ID,
  slug: LARIMER_LOUNGE_SOURCE_SLUG,
  name: 'Larimer Lounge',
  baseUrl: 'https://larimerlounge.com',
  calendarUrl: 'https://larimerlounge.com/events/',
  city: 'Denver',
  state: 'CO',
  country: 'US',
  defaultTimezone: 'America/Denver',
  reliabilityScore: 0.98,
  parserVersion: '1.0.0',
  defaultAddress: '2721 Larimer St',
  defaultPostalCode: '80205',
  defaultCoordinates: {
    latitude: 39.7595,
    longitude: -104.9835,
  },
};

// Lost Lake Lounge (PR #14)
export const LOST_LAKE_SOURCE_SLUG = 'lost-lake-lounge';
export const LOST_LAKE_DEFAULT_SOURCE_ID =
  'b0000000-0000-0000-0000-000000000006';

export const LOST_LAKE_CONFIG: VenueSourceConfig = {
  id: LOST_LAKE_DEFAULT_SOURCE_ID,
  slug: LOST_LAKE_SOURCE_SLUG,
  name: 'Lost Lake Lounge',
  baseUrl: 'https://lost-lake.com',
  calendarUrl: 'https://lost-lake.com/events/',
  city: 'Denver',
  state: 'CO',
  country: 'US',
  defaultTimezone: 'America/Denver',
  reliabilityScore: 0.98,
  parserVersion: '1.0.0',
  defaultAddress: '3602 E. Colfax',
  defaultPostalCode: '80206',
  defaultCoordinates: {
    latitude: 39.7402,
    longitude: -104.9453,
  },
};

// Globe Hall (PR #14)
export const GLOBE_HALL_SOURCE_SLUG = 'globe-hall';
export const GLOBE_HALL_DEFAULT_SOURCE_ID =
  'b0000000-0000-0000-0000-000000000007';

export const GLOBE_HALL_CONFIG: VenueSourceConfig = {
  id: GLOBE_HALL_DEFAULT_SOURCE_ID,
  slug: GLOBE_HALL_SOURCE_SLUG,
  name: 'Globe Hall',
  baseUrl: 'https://globehall.com',
  calendarUrl: 'https://globehall.com/events/',
  city: 'Denver',
  state: 'CO',
  country: 'US',
  defaultTimezone: 'America/Denver',
  reliabilityScore: 0.98,
  parserVersion: '1.0.0',
  defaultAddress: '4483 Logan Street',
  defaultPostalCode: '80216',
  defaultCoordinates: {
    latitude: 39.7779,
    longitude: -104.9823,
  },
};

// Velvet Elk Lounge (PR #15 - Boulder Independent Venues)
export const VELVET_ELK_SOURCE_SLUG = 'velvet-elk-lounge';
export const VELVET_ELK_DEFAULT_SOURCE_ID =
  'b0000000-0000-0000-0000-000000000008';

export const VELVET_ELK_CONFIG: VenueSourceConfig = {
  id: VELVET_ELK_DEFAULT_SOURCE_ID,
  slug: VELVET_ELK_SOURCE_SLUG,
  name: 'Velvet Elk Lounge',
  baseUrl: 'https://www.velvetelklounge.com',
  calendarUrl: 'https://www.velvetelklounge.com/events/',
  city: 'Boulder',
  state: 'CO',
  country: 'US',
  defaultTimezone: 'America/Denver',
  reliabilityScore: 0.98,
  parserVersion: '1.0.0',
  defaultAddress: '2037 13th Street',
  defaultPostalCode: '80302',
  defaultCoordinates: {
    latitude: 40.0189,
    longitude: -105.2785,
  },
};

// Roots Music Project (PR #15 - Boulder Independent Venues)
export const ROOTS_MUSIC_PROJECT_SOURCE_SLUG = 'roots-music-project';
export const ROOTS_MUSIC_PROJECT_DEFAULT_SOURCE_ID =
  'b0000000-0000-0000-0000-000000000009';

export const ROOTS_MUSIC_PROJECT_CONFIG: VenueSourceConfig = {
  id: ROOTS_MUSIC_PROJECT_DEFAULT_SOURCE_ID,
  slug: ROOTS_MUSIC_PROJECT_SOURCE_SLUG,
  name: 'Roots Music Project',
  baseUrl: 'https://www.rootsmusicproject.org',
  calendarUrl: 'https://www.eventbrite.com/o/roots-music-project-28110994095',
  city: 'Boulder',
  state: 'CO',
  country: 'US',
  defaultTimezone: 'America/Denver',
  reliabilityScore: 0.98,
  parserVersion: '1.0.0',
  defaultAddress: '4747 Pearl, Suite V3A',
  defaultPostalCode: '80301',
  defaultCoordinates: {
    latitude: 40.0262,
    longitude: -105.2418,
  },
};

// Z2 Entertainment (Shared Adapter: Boulder Theater, Fox Theatre, Aggie Theatre)
export const Z2_ENTERTAINMENT_SOURCE_SLUG = 'z2-entertainment';
export const Z2_ENTERTAINMENT_DEFAULT_SOURCE_ID =
  'b0000000-0000-0000-0000-000000000010';
export const Z2_ENTERTAINMENT_SOURCE_ID = Z2_ENTERTAINMENT_DEFAULT_SOURCE_ID;

export const Z2_ENTERTAINMENT_CONFIG: VenueSourceConfig = {
  id: Z2_ENTERTAINMENT_DEFAULT_SOURCE_ID,
  slug: Z2_ENTERTAINMENT_SOURCE_SLUG,
  name: 'Z2 Entertainment',
  baseUrl: 'https://z2ent.com',
  calendarUrl: 'https://z2ent.com/events',
  city: 'Boulder',
  state: 'CO',
  country: 'US',
  defaultTimezone: 'America/Denver',
  reliabilityScore: 0.98,
  parserVersion: '1.0.0',
  defaultAddress: '2032 14th St',
  defaultPostalCode: '80302',
  defaultCoordinates: {
    latitude: 40.0172,
    longitude: -105.2783,
  },
};

// Mishawaka Amphitheatre (Bellvue) - RHP Events list view
export const MISHAWAKA_SOURCE_SLUG = 'mishawaka-amphitheatre';
export const MISHAWAKA_DEFAULT_SOURCE_ID =
  'b0000000-0000-0000-0000-000000000011';

export const MISHAWAKA_CONFIG: VenueSourceConfig = {
  id: MISHAWAKA_DEFAULT_SOURCE_ID,
  slug: MISHAWAKA_SOURCE_SLUG,
  name: 'Mishawaka Amphitheatre',
  baseUrl: 'https://www.themishawaka.com',
  calendarUrl: 'https://www.themishawaka.com/events/?view=list',
  city: 'Bellvue',
  state: 'CO',
  country: 'US',
  defaultTimezone: 'America/Denver',
  reliabilityScore: 0.95,
  parserVersion: '1.0.0',
  defaultAddress: '13714 Poudre Canyon Highway',
  defaultPostalCode: '80512',
};

// Bohemian Live Music: Washington's and The Armory (Fort Collins) - Tribe Events REST API
export const BOHEMIAN_LIVE_MUSIC_SOURCE_SLUG = 'bohemian-live-music';
export const BOHEMIAN_LIVE_MUSIC_DEFAULT_SOURCE_ID =
  'b0000000-0000-0000-0000-000000000012';

export const BOHEMIAN_LIVE_MUSIC_CONFIG: VenueSourceConfig = {
  id: BOHEMIAN_LIVE_MUSIC_DEFAULT_SOURCE_ID,
  slug: BOHEMIAN_LIVE_MUSIC_SOURCE_SLUG,
  name: "Bohemian Live Music (Washington's & The Armory)",
  baseUrl: 'https://bohemianlivemusic.org',
  calendarUrl: 'https://bohemianlivemusic.org/calendar/',
  city: 'Fort Collins',
  state: 'CO',
  country: 'US',
  defaultTimezone: 'America/Denver',
  reliabilityScore: 0.97,
  parserVersion: '1.0.0',
};

export const BOHEMIAN_LIVE_MUSIC_API_URL =
  'https://bohemianlivemusic.org/wp-json/tribe/events/v1/events';

// 10 Mile Music Hall (Frisco) - Tribe Events REST API
export const TEN_MILE_MUSIC_HALL_SOURCE_SLUG = '10-mile-music-hall';
export const TEN_MILE_MUSIC_HALL_DEFAULT_SOURCE_ID =
  'b0000000-0000-0000-0000-000000000013';

export const TEN_MILE_MUSIC_HALL_CONFIG: VenueSourceConfig = {
  id: TEN_MILE_MUSIC_HALL_DEFAULT_SOURCE_ID,
  slug: TEN_MILE_MUSIC_HALL_SOURCE_SLUG,
  name: '10 Mile Music Hall',
  baseUrl: 'https://10milemusic.com',
  calendarUrl: 'https://10milemusic.com/show/',
  city: 'Frisco',
  state: 'CO',
  country: 'US',
  defaultTimezone: 'America/Denver',
  reliabilityScore: 0.97,
  parserVersion: '1.0.0',
};

export const TEN_MILE_MUSIC_HALL_API_URL =
  'https://10milemusic.com/wp-json/tribe/events/v1/events';

export const DENVER_INDEPENDENT_VENUE_CONFIGS: VenueSourceConfig[] = [
  LARIMER_LOUNGE_CONFIG,
  LOST_LAKE_CONFIG,
  GLOBE_HALL_CONFIG,
];

export const BOULDER_VENUE_CONFIGS: VenueSourceConfig[] = [
  VELVET_ELK_CONFIG,
  ROOTS_MUSIC_PROJECT_CONFIG,
  Z2_ENTERTAINMENT_CONFIG,
];

export const ALL_SUPPORTED_VENUE_CONFIGS: VenueSourceConfig[] = [
  CERVANTES_CONFIG,
  LARIMER_LOUNGE_CONFIG,
  LOST_LAKE_CONFIG,
  GLOBE_HALL_CONFIG,
  VELVET_ELK_CONFIG,
  ROOTS_MUSIC_PROJECT_CONFIG,
  Z2_ENTERTAINMENT_CONFIG,
  MISHAWAKA_CONFIG,
  BOHEMIAN_LIVE_MUSIC_CONFIG,
  TEN_MILE_MUSIC_HALL_CONFIG,
];

/**
 * Resolves venue configuration by slug or common alias.
 */
export function getVenueSourceConfig(
  slugOrName: string,
): VenueSourceConfig | undefined {
  const norm = slugOrName
    .toLowerCase()
    .replace(/[’'–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const config of ALL_SUPPORTED_VENUE_CONFIGS) {
    const configNorm = config.name.toLowerCase();
    const slugNorm = config.slug.replace(/-/g, ' ');

    if (
      norm === config.slug ||
      norm === slugNorm ||
      norm === configNorm ||
      (norm.length >= 4 &&
        (slugNorm.includes(norm) || configNorm.includes(norm)))
    ) {
      return config;
    }
  }

  // Short alias matching
  if (norm === 'larimer') return LARIMER_LOUNGE_CONFIG;
  if (norm === 'lostlake' || norm === 'lost lake') return LOST_LAKE_CONFIG;
  if (norm === 'globehall' || norm === 'globe hall') return GLOBE_HALL_CONFIG;
  if (norm === 'cervantes') return CERVANTES_CONFIG;
  if (
    norm === 'velvetelk' ||
    norm === 'velvet elk' ||
    norm === 'velvet elk lounge' ||
    norm === 'velvet'
  ) {
    return VELVET_ELK_CONFIG;
  }
  if (
    norm === 'roots' ||
    norm === 'rootsmusic' ||
    norm === 'roots music' ||
    norm === 'roots music project' ||
    norm === 'rmp'
  ) {
    return ROOTS_MUSIC_PROJECT_CONFIG;
  }
  if (
    norm === 'z2' ||
    norm === 'z2ent' ||
    norm === 'z2 entertainment' ||
    norm === 'z2-entertainment' ||
    norm === 'boulder theater' ||
    norm === 'bouldertheater' ||
    norm === 'fox theatre' ||
    norm === 'fox theater' ||
    norm === 'aggie theatre' ||
    norm === 'aggie theater'
  ) {
    return Z2_ENTERTAINMENT_CONFIG;
  }

  if (norm === 'mishawaka' || norm === 'the mishawaka') {
    return MISHAWAKA_CONFIG;
  }
  if (
    norm === 'bohemian' ||
    norm === 'washingtons' ||
    norm === 'washington s' ||
    norm === 'the armory'
  ) {
    return BOHEMIAN_LIVE_MUSIC_CONFIG;
  }
  if (norm === '10 mile' || norm === '10 mile music hall') {
    return TEN_MILE_MUSIC_HALL_CONFIG;
  }

  return undefined;
}

/**
 * Deterministically resolves or registers a venue source in the sources repository.
 * Safe to call repeatedly across tests, development, and live execution.
 */
export async function ensureVenueSource(
  sourceRepo: ISourceRepository,
  config: VenueSourceConfig = CERVANTES_CONFIG,
): Promise<Source> {
  const slug = config.slug;

  // 1. Authoritative business identity lookup by unique slug
  const existingBySlug = await sourceRepo.getBySlug(slug);
  if (existingBySlug) {
    return existingBySlug;
  }

  // 2. Fallback check: ensure default ID is not claimed by another entity
  const preferredId = config.id ?? crypto.randomUUID();
  let targetId = preferredId;
  try {
    const existingById = await sourceRepo.getById(preferredId);
    targetId = existingById ? crypto.randomUUID() : preferredId;
  } catch {
    // If preferredId is not a valid UUID (e.g. 'z2-entertainment') in a Postgres environment,
    // safely generate a deterministic/standard UUID for persistence.
    targetId = 'b0000000-0000-0000-0000-000000000010';
  }

  // 3. Upsert deterministic source registration
  return sourceRepo.upsert({
    id: targetId,
    slug,
    name: config.name,
    sourceType: 'venue',
    acquisitionMethod: 'html_http',
    baseUrl: config.baseUrl,
    reliabilityScore: config.reliabilityScore ?? 0.98,
    active: true,
    parserVersion: config.parserVersion ?? '1.0.0',
    consecutiveFailures: 0,
    lastFetchedAt: null,
  });
}
