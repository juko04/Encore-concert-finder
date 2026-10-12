import crypto from 'node:crypto';
import type { Source } from '@/lib/domain/source';
import type { ISourceRepository } from '@/lib/repositories/interfaces';

export const TICKETMASTER_SOURCE_SLUG = 'ticketmaster-discovery';
export const TICKETMASTER_DEFAULT_SOURCE_ID =
  'b0000000-0000-0000-0000-000000000003';

/**
 * Deterministically resolves or registers the Ticketmaster Discovery API source.
 * Safe to call repeatedly across fresh, seeded, or existing database environments.
 */
export async function ensureTicketmasterSource(
  sourceRepo: ISourceRepository,
  overrides?: Partial<Source>,
): Promise<Source> {
  const slug = overrides?.slug ?? TICKETMASTER_SOURCE_SLUG;

  // 1. Authoritative business identity lookup by unique slug
  const existingBySlug = await sourceRepo.getBySlug(slug);
  if (existingBySlug) {
    return existingBySlug;
  }

  // 2. Fallback check: ensure default ID is not claimed by another entity
  const preferredId = overrides?.id ?? TICKETMASTER_DEFAULT_SOURCE_ID;
  const existingById = await sourceRepo.getById(preferredId);
  const targetId = existingById ? crypto.randomUUID() : preferredId;

  // 3. Upsert deterministic source registration
  return sourceRepo.upsert({
    id: targetId,
    slug,
    name: overrides?.name ?? 'Ticketmaster Discovery API',
    sourceType: overrides?.sourceType ?? 'ticketing',
    acquisitionMethod: overrides?.acquisitionMethod ?? 'api',
    baseUrl: overrides?.baseUrl ?? 'https://app.ticketmaster.com/discovery/v2/',
    reliabilityScore: overrides?.reliabilityScore ?? 0.95,
    active: overrides?.active ?? true,
    parserVersion: overrides?.parserVersion ?? '1.0.0',
    consecutiveFailures: overrides?.consecutiveFailures ?? 0,
    lastFetchedAt: overrides?.lastFetchedAt ?? null,
  });
}
