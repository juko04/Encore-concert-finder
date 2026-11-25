/**
 * The single server-side search entry point shared by /search (first page) and
 * /api/catalog/search (Load More), so both honour exactly the same filters, sort order,
 * radius, home location and counts.
 *
 * The home location and radius are NEVER taken from client input: callers pass a NearScope
 * derived on the server by resolveNearContext (session profile / home-location cookie).
 */

import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type {
  EventListFilters,
  EventLocationRow,
} from '@/lib/repositories/interfaces';
import { listEventsNearHome, type NearScanOptions } from './near-search';
import type { HomePoint } from './radius';

export interface NearScope {
  home: HomePoint;
  radiusMiles: number;
}

export interface CatalogSearchRepository {
  listEvents(filters?: EventListFilters): Promise<CanonicalEventSummary[]>;
  countEvents?(filters?: EventListFilters): Promise<number>;
  listEventLocations?(filters?: EventListFilters): Promise<EventLocationRow[]>;
  getEventsByIds?(ids: string[]): Promise<CanonicalEventSummary[]>;
}

export interface CatalogSearchPage {
  events: CanonicalEventSummary[];
  totalCount: number;
  hasMore: boolean;
  /** True when the radius filter was actually applied to this result set. */
  nearApplied: boolean;
}

/** Cache TTL so Load More after page 1 does not re-walk the catalog. */
export const NEAR_SCAN_CACHE_TTL_MS = 30_000;

/**
 * One page of catalog results. `filters.limit` / `filters.offset` select the page. With
 * `near` the whole matching catalog is scanned so the count and every page are exact;
 * without it the database paginates directly.
 */
export async function searchCatalogPage(
  repo: CatalogSearchRepository,
  filters: EventListFilters,
  near: NearScope | null,
  scan: NearScanOptions = {
    cacheTtlMs: NEAR_SCAN_CACHE_TTL_MS,
    concurrency: 4,
  },
): Promise<CatalogSearchPage> {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  if (near) {
    const page = await listEventsNearHome(
      repo,
      filters,
      near.home,
      near.radiusMiles,
      { limit, offset },
      scan,
    );
    return { ...page, nearApplied: true };
  }
  const [events, count] = await Promise.all([
    repo.listEvents(filters),
    typeof repo.countEvents === 'function'
      ? repo.countEvents(filters)
      : Promise.resolve(0),
  ]);
  const totalCount = Math.max(count, events.length);
  return {
    events,
    totalCount,
    hasMore: offset + events.length < totalCount,
    nearApplied: false,
  };
}
