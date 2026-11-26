import crypto from 'node:crypto';
import type { Source } from '@/lib/domain/source';
import type { ISourceRepository } from '@/lib/repositories/interfaces';
import { SEATGEEK_PARSER_VERSION } from './types';

export const SEATGEEK_SOURCE_SLUG = 'seatgeek-platform';
export const SEATGEEK_DEFAULT_SOURCE_ID =
  'c0000000-0000-0000-0000-000000000001';

/**
 * Resolves or registers the SeatGeek Platform API source (price-only enrichment).
 * Lower reliability than first-party ticketing: marketplace prices are resale, not face value.
 */
export async function ensureSeatGeekSource(
  sourceRepo: ISourceRepository,
): Promise<Source> {
  const existing = await sourceRepo.getBySlug(SEATGEEK_SOURCE_SLUG);
  if (existing) return existing;

  const claimed = await sourceRepo.getById(SEATGEEK_DEFAULT_SOURCE_ID);
  return sourceRepo.upsert({
    id: claimed ? crypto.randomUUID() : SEATGEEK_DEFAULT_SOURCE_ID,
    slug: SEATGEEK_SOURCE_SLUG,
    name: 'SeatGeek Platform API',
    sourceType: 'ticketing',
    acquisitionMethod: 'api',
    baseUrl: 'https://api.seatgeek.com/2/',
    reliabilityScore: 0.7,
    active: true,
    parserVersion: SEATGEEK_PARSER_VERSION,
    consecutiveFailures: 0,
    lastFetchedAt: null,
  });
}
