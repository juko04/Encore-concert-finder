/**
 * Exact "near me" catalog search.
 *
 * The catalog has no geo query and most venues have no coordinates, so distance is computed
 * per event (venue coordinate, else city centroid; unknown locations excluded; see ./radius).
 * To keep filtering, counts, sorting and paging correct for the WHOLE catalog (never a
 * first-N cap), this walks the catalog server-side in repository-sorted batches until it is
 * exhausted, keeps the qualifying events in the requested sort order, then slices the page.
 * All non-geographic filters (query, price, dates, genre, ...) still run in the database.
 */

import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { EventListFilters } from '@/lib/repositories/interfaces';
import { filterEventsWithinRadius, type HomePoint } from './radius';

/** Rows requested per repository call (below the PostgREST 1000-row response cap). */
export const NEAR_BATCH_SIZE = 500;

export interface NearListRepository {
  listEvents(filters?: EventListFilters): Promise<CanonicalEventSummary[]>;
}

/**
 * Events in the catalog matching `filters` (ignoring limit/offset) within the radius, in sort
 * order. Scans the whole catalog unless `stopAfter` matches have been found.
 */
export async function listAllEventsWithinRadius(
  repo: NearListRepository,
  filters: EventListFilters,
  home: HomePoint,
  radiusMiles: number,
  batchSize: number = NEAR_BATCH_SIZE,
  stopAfter: number = Number.POSITIVE_INFINITY,
): Promise<CanonicalEventSummary[]> {
  const matches: CanonicalEventSummary[] = [];
  const seen = new Set<string>();
  for (let offset = 0; ; offset += batchSize) {
    const batch = await repo.listEvents({
      ...filters,
      limit: batchSize,
      offset,
    });
    for (const e of filterEventsWithinRadius(batch, home, radiusMiles)) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      matches.push(e);
    }
    // Early exit is still exact: results are in repository sort order, so the first
    // `stopAfter` matches are the first `stopAfter` of the full catalog.
    if (matches.length >= stopAfter) return matches.slice(0, stopAfter);
    if (batch.length < batchSize) break;
  }
  return matches;
}

export interface NearPage {
  events: CanonicalEventSummary[];
  totalCount: number;
  hasMore: boolean;
}

/** One page of the exact within-radius result set plus the true total. */
export async function listEventsNearHome(
  repo: NearListRepository,
  filters: EventListFilters,
  home: HomePoint,
  radiusMiles: number,
  page: { limit: number; offset: number },
  batchSize: number = NEAR_BATCH_SIZE,
): Promise<NearPage> {
  const all = await listAllEventsWithinRadius(
    repo,
    filters,
    home,
    radiusMiles,
    batchSize,
  );
  const events = all.slice(page.offset, page.offset + page.limit);
  return {
    events,
    totalCount: all.length,
    hasMore: page.offset + events.length < all.length,
  };
}
