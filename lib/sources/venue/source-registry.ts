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

export const DENVER_INDEPENDENT_VENUE_CONFIGS: VenueSourceConfig[] = [
  LARIMER_LOUNGE_CONFIG,
  LOST_LAKE_CONFIG,
  GLOBE_HALL_CONFIG,
];

export const BOULDER_VENUE_CONFIGS: VenueSourceConfig[] = [
  VELVET_ELK_CONFIG,
  ROOTS_MUSIC_PROJECT_CONFIG,
];

export const ALL_SUPPORTED_VENUE_CONFIGS: VenueSourceConfig[] = [
  CERVANTES_CONFIG,
  LARIMER_LOUNGE_CONFIG,
  LOST_LAKE_CONFIG,
  GLOBE_HALL_CONFIG,
  VELVET_ELK_CONFIG,
  ROOTS_MUSIC_PROJECT_CONFIG,
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
  const existingById = await sourceRepo.getById(preferredId);
  const targetId = existingById ? crypto.randomUUID() : preferredId;

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
