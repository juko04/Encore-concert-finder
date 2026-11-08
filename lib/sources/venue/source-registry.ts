import crypto from 'node:crypto';
import type { Source } from '@/lib/domain/source';
import type { ISourceRepository } from '@/lib/repositories/interfaces';
import type { VenueSourceConfig } from './types';

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
