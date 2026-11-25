/**
 * Exact "near me" catalog search.
 *
 * The catalog has no geo query and most venues have no coordinates, so distance is computed
 * per event (venue coordinate, else city centroid; unknown locations excluded; see ./radius).
 * To keep filtering, counts, sorting and paging correct for the WHOLE catalog (never a
 * first-N cap), every matching event is considered and the qualifying ones are kept in the
 * requested sort order before the page is sliced. When the repository offers the light scan
 * (listEventLocations + getEventsByIds) only ids and locations are read for the whole catalog
 * and just the requested page is hydrated; otherwise the catalog is walked in full batches.
 * All non-geographic filters (query, price, dates, genre, ...) still run in the database.
 */

import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type {
  EventListFilters,
  EventLocationRow,
} from '@/lib/repositories/interfaces';
import { filterEventsWithinRadius, type HomePoint } from './radius';

/** Rows requested per repository call (below the PostgREST 1000-row response cap). */
export const NEAR_BATCH_SIZE = 500;
/** Batches fetched concurrently while walking the catalog. */
export const NEAR_SCAN_CONCURRENCY = 4;

export interface NearListRepository {
  listEvents(filters?: EventListFilters): Promise<CanonicalEventSummary[]>;
  /**
   * Optional fast path (see SupabaseCatalogRepository): a LIGHT scan of every matching event's
   * id + location in sort order, and hydration of just the requested ids. When both exist the
   * scan never loads artists/tickets/sources for events outside the requested page.
   */
  listEventLocations?(filters?: EventListFilters): Promise<EventLocationRow[]>;
  getEventsByIds?(ids: string[]): Promise<CanonicalEventSummary[]>;
}

export interface NearScanOptions {
  batchSize?: number;
  /** Batches requested in parallel per wave (results are still merged in offset order). */
  concurrency?: number;
  /**
   * When > 0, the full ordered match list is memoised in-process for this many ms (keyed by
   * filters + home + radius) so Load More does not re-walk the catalog. Default 0 = off.
   */
  cacheTtlMs?: number;
}

const SCAN_CACHE_MAX_ENTRIES = 16;
const scanCache = new Map<
  string,
  { at: number; matches: CanonicalEventSummary[] | null; ids: string[] | null }
>();

/** Test hook. */
export function clearNearScanCache(): void {
  scanCache.clear();
}

function scanCacheKey(
  filters: EventListFilters,
  home: HomePoint,
  radiusMiles: number,
): string {
  // limit/offset belong to the page, not the result set.
  const rest: Record<string, unknown> = { ...filters };
  delete rest.limit;
  delete rest.offset;
  delete rest.referenceNowIso; // changes every request; the date window already encodes it
  return JSON.stringify([
    Object.keys(rest)
      .sort()
      .map((k) => [k, rest[k]]),
    home.lat,
    home.lng,
    radiusMiles,
  ]);
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
  concurrency: number = 1,
): Promise<CanonicalEventSummary[]> {
  const matches: CanonicalEventSummary[] = [];
  const seen = new Set<string>();
  const wave = Math.max(1, Math.floor(concurrency));
  for (let offset = 0; ; offset += batchSize * wave) {
    const batches = await Promise.all(
      Array.from({ length: wave }, (_, i) =>
        repo.listEvents({
          ...filters,
          limit: batchSize,
          offset: offset + i * batchSize,
        }),
      ),
    );
    let exhausted = false;
    for (const batch of batches) {
      for (const e of filterEventsWithinRadius(batch, home, radiusMiles)) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        matches.push(e);
      }
      // A short batch is the end of the catalog; later batches in the wave are empty.
      if (batch.length < batchSize) {
        exhausted = true;
        break;
      }
    }
    // Early exit is still exact: results are in repository sort order, so the first
    // `stopAfter` matches are the first `stopAfter` of the full catalog.
    if (matches.length >= stopAfter) return matches.slice(0, stopAfter);
    if (exhausted) break;
  }
  return matches;
}

export interface NearPage {
  events: CanonicalEventSummary[];
  totalCount: number;
  hasMore: boolean;
}

/**
 * Ids (in sort order) of every event matching `filters` within the radius, from the light
 * scan. Same radius rule as the full scan (venue coordinate, else city centroid; unknown
 * locations excluded).
 */
export async function listEventIdsWithinRadius(
  repo: Required<Pick<NearListRepository, 'listEventLocations'>>,
  filters: EventListFilters,
  home: HomePoint,
  radiusMiles: number,
): Promise<string[]> {
  const rows = await repo.listEventLocations({
    ...filters,
    limit: undefined,
    offset: undefined,
  });
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const e of filterEventsWithinRadius(rows, home, radiusMiles)) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    ids.push(e.id);
  }
  return ids;
}

/** One page of the exact within-radius result set plus the true total. */
export async function listEventsNearHome(
  repo: NearListRepository,
  filters: EventListFilters,
  home: HomePoint,
  radiusMiles: number,
  page: { limit: number; offset: number },
  batchSizeOrOptions: number | NearScanOptions = NEAR_BATCH_SIZE,
): Promise<NearPage> {
  const opts: NearScanOptions =
    typeof batchSizeOrOptions === 'number'
      ? { batchSize: batchSizeOrOptions }
      : batchSizeOrOptions;
  const ttl = opts.cacheTtlMs ?? 0;
  const key = ttl > 0 ? scanCacheKey(filters, home, radiusMiles) : '';
  const fast =
    typeof repo.listEventLocations === 'function' &&
    typeof repo.getEventsByIds === 'function';
  let all: CanonicalEventSummary[] | null = null;
  let ids: string[] | null = null;
  if (ttl > 0) {
    const hit = scanCache.get(key);
    if (hit && Date.now() - hit.at < ttl && (fast ? hit.ids : hit.matches)) {
      all = hit.matches;
      ids = hit.ids;
    }
  }
  if (!all && !ids) {
    if (fast) {
      ids = await listEventIdsWithinRadius(
        { listEventLocations: repo.listEventLocations!.bind(repo) },
        filters,
        home,
        radiusMiles,
      );
    } else {
      all = await listAllEventsWithinRadius(
        repo,
        filters,
        home,
        radiusMiles,
        opts.batchSize ?? NEAR_BATCH_SIZE,
        Number.POSITIVE_INFINITY,
        opts.concurrency ?? 1,
      );
    }
    if (ttl > 0) {
      scanCache.delete(key);
      scanCache.set(key, { at: Date.now(), matches: all, ids });
      while (scanCache.size > SCAN_CACHE_MAX_ENTRIES) {
        const oldest = scanCache.keys().next().value;
        if (oldest === undefined) break;
        scanCache.delete(oldest);
      }
    }
  }
  if (fast && ids) {
    const pageIds = ids.slice(page.offset, page.offset + page.limit);
    const events = await repo.getEventsByIds!(pageIds);
    return {
      events,
      totalCount: ids.length,
      hasMore: page.offset + pageIds.length < ids.length,
    };
  }
  const list = all ?? [];
  const events = list.slice(page.offset, page.offset + page.limit);
  return {
    events,
    totalCount: list.length,
    hasMore: page.offset + events.length < list.length,
  };
}
