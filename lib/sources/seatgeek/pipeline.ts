/**
 * Market price sync: fetch SeatGeek pages, store each page as a raw ingest, match listings to
 * canonical events, and (only with `write`) append price observations.
 *
 * The dry run (default) makes no database writes at all and returns the coverage report that
 * gates any UI work (MARKET_PRICES_PLAN.md §11).
 */

import crypto from 'node:crypto';
import {
  SeatGeekAuthError,
  SeatGeekBudgetExceededError,
  redactSeatGeekSecrets,
  type SeatGeekEventsQuery,
  type SeatGeekPage,
} from './client';
import { parseSeatGeekEventsPage } from './parser';
import { matchListing } from './matcher';
import {
  SEATGEEK_PARSER_VERSION,
  type CatalogEventForMatch,
  type MarketListing,
  type MarketPriceObservationInput,
  type MatchMethod,
} from './types';

export interface SeatGeekPageFetcher {
  fetchEventsPage(query: SeatGeekEventsQuery): Promise<SeatGeekPage>;
}

export interface MarketPriceStore {
  /** Read-only: canonical events whose dates touch [fromDate, toDate]. */
  loadCatalogEvents(
    fromDate: string,
    toDate: string,
  ): Promise<CatalogEventForMatch[]>;
  /** Write mode only. Returns the raw ingest id (existing id when the page is unchanged). */
  saveRawIngest(page: {
    sourceId: string;
    sourceUrl: string;
    body: string;
    status: number;
    contentHash: string;
    fetchedAt: string;
  }): Promise<string>;
  /** Write mode only. Returns how many new rows were inserted. */
  insertObservations(rows: MarketPriceObservationInput[]): Promise<number>;
}

export interface MarketPriceSyncOptions {
  fetcher: SeatGeekPageFetcher;
  store: MarketPriceStore;
  sourceId: string;
  /** Two-letter state codes (required; no default geography). */
  states: string[];
  fromDate: string;
  toDate: string;
  maxPagesPerState?: number;
  perPage?: number;
  write?: boolean;
  now?: () => Date;
}

export interface VenueCoverage {
  venueName: string;
  unpriced: number;
  gained: number;
}

export interface MarketPriceSyncReport {
  status: 'ok' | 'partial' | 'auth_failed';
  stoppedReason: string | null;
  mode: 'dry_run' | 'write';
  states: string[];
  window: { fromDate: string; toDate: string };
  pagesFetched: number;
  listingsFetched: number;
  invalidListings: number;
  matched: number;
  matchedByMethod: Partial<Record<MatchMethod, number>>;
  skipped: Record<string, number>;
  unmatched: Record<string, number>;
  ambiguous: Record<string, number>;
  /** Listings dropped because several listings matched one event (non-festival). */
  collisions: number;
  observationsInserted: number;
  coverage: {
    upcomingUnpriced: number;
    unpricedGained: number;
    percent: number;
    festivalsUnpriced: number;
    festivalsGained: number;
    pricedEventsWithMarketPrice: number;
    topVenues: VenueCoverage[];
  };
  samples: {
    unmatched: Array<{
      title: string;
      venue: string;
      date: string | null;
      reason: string;
    }>;
  };
}

function bump(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface FetchedListing {
  listing: MarketListing;
  rawIngestId: string | null;
  observedAt: string;
}

export async function runMarketPriceSync(
  options: MarketPriceSyncOptions,
): Promise<MarketPriceSyncReport> {
  const now = options.now ?? (() => new Date());
  const write = options.write === true;
  const perPage = options.perPage ?? 100;
  const maxPages = options.maxPagesPerState ?? 10;
  const states = options.states
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (states.length === 0) {
    throw new Error('runMarketPriceSync needs at least one state code');
  }

  const report: MarketPriceSyncReport = {
    status: 'ok',
    stoppedReason: null,
    mode: write ? 'write' : 'dry_run',
    states,
    window: { fromDate: options.fromDate, toDate: options.toDate },
    pagesFetched: 0,
    listingsFetched: 0,
    invalidListings: 0,
    matched: 0,
    matchedByMethod: {},
    skipped: {},
    unmatched: {},
    ambiguous: {},
    collisions: 0,
    observationsInserted: 0,
    coverage: {
      upcomingUnpriced: 0,
      unpricedGained: 0,
      percent: 0,
      festivalsUnpriced: 0,
      festivalsGained: 0,
      pricedEventsWithMarketPrice: 0,
      topVenues: [],
    },
    samples: { unmatched: [] },
  };

  // 1. Fetch (and in write mode, store) every page before matching.
  const fetched: FetchedListing[] = [];
  const seen = new Set<string>();
  outer: for (const stateCode of states) {
    for (let page = 1; page <= maxPages; page += 1) {
      let result: SeatGeekPage;
      try {
        result = await options.fetcher.fetchEventsPage({
          stateCode,
          fromDate: options.fromDate,
          toDate: options.toDate,
          page,
          perPage,
        });
      } catch (err) {
        if (err instanceof SeatGeekAuthError) {
          report.status = 'auth_failed';
          report.stoppedReason = err.message;
          return report;
        }
        report.status = 'partial';
        report.stoppedReason =
          err instanceof SeatGeekBudgetExceededError
            ? err.message
            : redactSeatGeekSecrets((err as Error).message);
        break outer;
      }
      report.pagesFetched += 1;
      const observedAt = now().toISOString();
      const parsed = parseSeatGeekEventsPage(result.body);
      report.invalidListings += parsed.invalid;

      let rawIngestId: string | null = null;
      if (write) {
        rawIngestId = await options.store.saveRawIngest({
          sourceId: options.sourceId,
          sourceUrl: redactSeatGeekSecrets(result.sourceUrl),
          body: result.body,
          status: result.status,
          contentHash: sha256(result.body),
          fetchedAt: observedAt,
        });
      }
      for (const listing of parsed.listings) {
        if (seen.has(listing.marketplaceEventId)) continue;
        seen.add(listing.marketplaceEventId);
        fetched.push({ listing, rawIngestId, observedAt });
      }
      report.listingsFetched += parsed.listings.length;

      const total = parsed.total;
      if (parsed.listings.length + parsed.invalid < perPage) break;
      if (total !== null && page * perPage >= total) break;
    }
  }

  // 2. Match against the catalog. Festivals that began before the window can still be on.
  const catalog = await options.store.loadCatalogEvents(
    addDays(options.fromDate, -14),
    options.toDate,
  );
  const festivalIds = new Set(
    catalog
      .filter((e) =>
        e.festivalGroupId ? e.festivalGroupPrimary : e.eventKind === 'festival',
      )
      .map((e) => e.id),
  );
  const byEvent = new Map<
    string,
    Array<
      FetchedListing & {
        method: MatchMethod;
        confidence: number;
        festival: boolean;
      }
    >
  >();
  for (const item of fetched) {
    const outcome = matchListing(item.listing, catalog);
    if (outcome.kind === 'matched') {
      const list = byEvent.get(outcome.eventId) ?? [];
      list.push({
        ...item,
        method: outcome.method,
        confidence: outcome.confidence,
        festival: festivalIds.has(outcome.eventId),
      });
      byEvent.set(outcome.eventId, list);
      continue;
    }
    if (outcome.kind === 'skipped') bump(report.skipped, outcome.reason);
    else if (outcome.kind === 'ambiguous')
      bump(report.ambiguous, outcome.reason);
    else {
      bump(report.unmatched, outcome.reason);
      if (report.samples.unmatched.length < 25) {
        report.samples.unmatched.push({
          title: item.listing.title,
          venue: item.listing.venue.name,
          date: item.listing.localDate,
          reason: outcome.reason,
        });
      }
    }
  }

  // 3. One observation per event. Several day/tier passes for one festival keep the cheapest
  //    floor; several listings for one ordinary show are a conflict and are all dropped.
  const observations: MarketPriceObservationInput[] = [];
  for (const [eventId, matches] of byEvent) {
    let chosen = matches[0];
    if (matches.length > 1) {
      if (!matches.every((m) => m.festival)) {
        report.collisions += matches.length;
        bump(report.ambiguous, 'several_listings_one_event');
        continue;
      }
      chosen = matches.reduce((best, m) =>
        (m.listing.lowestPrice ?? Infinity) <
        (best.listing.lowestPrice ?? Infinity)
          ? m
          : best,
      );
    }
    report.matched += 1;
    report.matchedByMethod[chosen.method] =
      (report.matchedByMethod[chosen.method] ?? 0) + 1;
    observations.push({
      eventId,
      sourceId: options.sourceId,
      rawIngestId: chosen.rawIngestId ?? '',
      marketplaceEventId: chosen.listing.marketplaceEventId,
      marketplaceUrl: chosen.listing.url,
      lowestPrice: chosen.listing.lowestPrice,
      averagePrice: chosen.listing.averagePrice,
      highestPrice: chosen.listing.highestPrice,
      listingCount: chosen.listing.listingCount,
      currency: chosen.listing.currency,
      observedAt: chosen.observedAt,
      matchMethod: chosen.method,
      matchConfidence: chosen.confidence,
      parserVersion: SEATGEEK_PARSER_VERSION,
    });
  }

  if (write && observations.length > 0) {
    report.observationsInserted =
      await options.store.insertObservations(observations);
  }

  // 4. Coverage of what users actually see: upcoming shows in the synced states and window,
  //    one row per festival group (its primary), without a listed price.
  const gained = new Set(
    observations.filter((o) => o.currency === 'USD').map((o) => o.eventId),
  );
  const venues = new Map<string, VenueCoverage>();
  for (const event of catalog) {
    if (
      event.localStartDate < options.fromDate ||
      event.localStartDate > options.toDate
    ) {
      continue;
    }
    if (
      !event.venue.region ||
      !states.includes(event.venue.region.toUpperCase())
    )
      continue;
    if (event.festivalGroupId && !event.festivalGroupPrimary) continue;
    if (event.hasListedPrice) {
      if (gained.has(event.id))
        report.coverage.pricedEventsWithMarketPrice += 1;
      continue;
    }
    const got = gained.has(event.id);
    report.coverage.upcomingUnpriced += 1;
    if (got) report.coverage.unpricedGained += 1;
    if (event.festivalGroupId || event.eventKind === 'festival') {
      report.coverage.festivalsUnpriced += 1;
      if (got) report.coverage.festivalsGained += 1;
    }
    const key = event.venue.name ?? 'Unknown venue';
    const row = venues.get(key) ?? { venueName: key, unpriced: 0, gained: 0 };
    row.unpriced += 1;
    if (got) row.gained += 1;
    venues.set(key, row);
  }
  const { upcomingUnpriced, unpricedGained } = report.coverage;
  report.coverage.percent =
    upcomingUnpriced === 0
      ? 0
      : Math.round((unpricedGained / upcomingUnpriced) * 1000) / 10;
  report.coverage.topVenues = [...venues.values()]
    .sort(
      (a, b) =>
        b.unpriced - a.unpriced || a.venueName.localeCompare(b.venueName),
    )
    .slice(0, 10);

  return report;
}
