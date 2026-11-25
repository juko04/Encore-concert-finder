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
/** Batches fetched concurrently while walking the catalog. */
export const NEAR_SCAN_CONCURRENCY = 4;

export interface NearListRepository {
  listEvents(filters?: EventListFilters): Promise<CanonicalEventSummary[]>;
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
  { at: number; matches: CanonicalEventSummary[] }
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
  let all: CanonicalEventSummary[] | undefined;
  if (ttl > 0) {
    const hit = scanCache.get(key);
    if (hit && Date.now() - hit.at < ttl) all = hit.matches;
  }
  if (!all) {
    all = await listAllEventsWithinRadius(
      repo,
      filters,
      home,
      radiusMiles,
      opts.batchSize ?? NEAR_BATCH_SIZE,
      Number.POSITIVE_INFINITY,
      opts.concurrency ?? 1,
    );
    if (ttl > 0) {
      scanCache.delete(key);
      scanCache.set(key, { at: Date.now(), matches: all });
      while (scanCache.size > SCAN_CACHE_MAX_ENTRIES) {
        const oldest = scanCache.keys().next().value;
        if (oldest === undefined) break;
        scanCache.delete(oldest);
      }
    }
  }
  const events = all.slice(page.offset, page.offset + page.limit);
  return {
    events,
    totalCount: all.length,
    hasMore: page.offset + events.length < all.length,
  };
}
