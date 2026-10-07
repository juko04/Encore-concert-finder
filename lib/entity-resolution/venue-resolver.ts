/**
 * Venue Entity Resolution
 * Resolves candidate venue references to canonical Venue records.
 */

import type { Venue } from '@/lib/domain/catalog';
import { normalizeName } from '@/lib/domain/value-objects';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';

export interface ResolveVenueInput {
  name: string;
  city: string;
  region?: string | null;
  countryCode?: string | null;
  timezone?: string | null;
  website?: string | null;
}

const COMMON_VENUE_SUFFIXES = [
  'amphitheatre',
  'amphitheater',
  'theatre',
  'theater',
  'auditorium',
  'ballroom',
  'arena',
  'center',
  'pavilion',
  'hall',
];

function stripVenueSuffixes(normName: string): string {
  const pattern = new RegExp(`\\b(${COMMON_VENUE_SUFFIXES.join('|')})\\b`, 'g');
  return normName.replace(pattern, '').replace(/\s+/g, ' ').trim();
}

export interface VenuePreparationResult {
  venue?: Venue;
  venueToCreate?: {
    id?: string;
    name: string;
    normalizedName: string;
    city: string;
    region?: string | null;
    countryCode?: string | null;
    timezone?: string | null;
    website?: string | null;
  };
  isNew: boolean;
}

export class VenueResolver {
  /**
   * Resolves existing venue or prepares atomic creation specification without writing to database.
   */
  async resolveOrPrepare(
    catalogRepo: ICatalogRepository,
    input: ResolveVenueInput,
  ): Promise<VenuePreparationResult> {
    const rawName = input.name?.trim();
    const city = input.city?.trim();
    if (!rawName) {
      throw new Error('Venue name is required');
    }
    if (!city) {
      throw new Error('Venue city is required and cannot be empty');
    }
    const normalized = normalizeName(rawName);

    // 1. Direct match on normalized name, city, region, and country
    const existing = await catalogRepo.findVenue(
      normalized,
      city,
      input.region,
      input.countryCode,
    );
    if (existing) {
      return { venue: existing, isNew: false };
    }

    // 2. Bidirectional alias match
    // Case A: Incoming has suffix ("Red Rocks Amphitheatre"), existing is stripped ("Red Rocks")
    const simplified = stripVenueSuffixes(normalized);
    if (simplified.length > 2 && simplified !== normalized) {
      const aliasMatch = await catalogRepo.findVenue(
        simplified,
        city,
        input.region,
        input.countryCode,
      );
      if (aliasMatch) {
        return { venue: aliasMatch, isNew: false };
      }
    }

    // Case B: Incoming is stripped ("Red Rocks"), existing has suffix ("Red Rocks Amphitheatre")
    for (const suffix of COMMON_VENUE_SUFFIXES) {
      const withSuffix = `${simplified} ${suffix}`;
      const match = await catalogRepo.findVenue(
        withSuffix,
        city,
        input.region,
        input.countryCode,
      );
      if (match) {
        return { venue: match, isNew: false };
      }
    }

    // 3. New canonical venue specification (deferred atomic creation)
    const newVenueId = crypto.randomUUID();
    const newVenue: Venue = {
      id: newVenueId,
      name: rawName,
      normalizedName: normalized,
      city,
      region: input.region ?? null,
      countryCode: input.countryCode ?? null,
      timezone: input.timezone ?? null,
      website: input.website ?? null,
    };

    return {
      venue: newVenue,
      venueToCreate: {
        id: newVenueId,
        name: rawName,
        normalizedName: normalized,
        city,
        region: input.region ?? null,
        countryCode: input.countryCode ?? null,
        timezone: input.timezone ?? null,
        website: input.website ?? null,
      },
      isNew: true,
    };
  }

  /**
   * Standalone resolution method that creates the venue immediately if not existing.
   */
  async resolve(
    catalogRepo: ICatalogRepository,
    input: ResolveVenueInput,
  ): Promise<Venue> {
    const outcome = await this.resolveOrPrepare(catalogRepo, input);
    if (!outcome.isNew && outcome.venue) {
      return outcome.venue;
    }

    return catalogRepo.createVenue(outcome.venueToCreate!);
  }
}
