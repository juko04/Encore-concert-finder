import type { Venue } from '@/lib/domain/catalog';
import { normalizeName } from '@/lib/domain/value-objects';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';

export interface ResolveVenueInput {
  name: string;
  city: string;
  region?: string;
  countryCode?: string;
  timezone?: string;
  website?: string;
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

export class VenueResolver {
  async resolve(
    catalogRepo: ICatalogRepository,
    input: ResolveVenueInput,
  ): Promise<Venue> {
    const rawName = input.name.trim();
    const city = input.city.trim();
    const normalized = normalizeName(rawName);

    // 1. Direct match on normalized name and city
    const existing = await catalogRepo.findVenueByNameAndCity(normalized, city);
    if (existing) {
      return existing;
    }

    // 2. Bidirectional alias match
    // Case A: Incoming has suffix ("Red Rocks Amphitheatre"), existing is stripped ("Red Rocks")
    const simplified = stripVenueSuffixes(normalized);
    if (simplified.length > 2 && simplified !== normalized) {
      const aliasMatch = await catalogRepo.findVenueByNameAndCity(
        simplified,
        city,
      );
      if (aliasMatch) {
        return aliasMatch;
      }
    }

    // Case B: Incoming is stripped ("Red Rocks"), existing has suffix ("Red Rocks Amphitheatre")
    for (const suffix of COMMON_VENUE_SUFFIXES) {
      const withSuffix = `${simplified} ${suffix}`;
      const match = await catalogRepo.findVenueByNameAndCity(withSuffix, city);
      if (match) {
        return match;
      }
    }

    // 3. Create new canonical venue
    return catalogRepo.createVenue({
      name: rawName,
      normalizedName: normalized,
      city,
      region: input.region ?? null,
      countryCode: input.countryCode ?? 'US',
      timezone: input.timezone ?? null,
      website: input.website ?? null,
    });
  }
}
