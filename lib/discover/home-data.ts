import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';
import type { EventListFilters } from '@/lib/repositories/interfaces';
import type { ScoredEvent } from '@/lib/recommendation/types';
import type { GenreTasteSummaryItem } from '@/lib/recommendation/genre';
import { getPersonalizedDiscoverData } from '@/lib/recommendation/service';
import {
  getDiscoverDateWindows,
  type DiscoverDateWindows,
} from '@/lib/discover/dates';
import { listAllEventsWithinRadius } from '@/lib/location/near-search';

export interface DiscoverRow {
  id: string;
  title: string;
  subtitle?: string;
  events: Array<CanonicalEventSummary | ScoredEvent>;
  /** Link to /search that reproduces the row's filter. */
  seeAllHref: string;
}

export interface DiscoverChip {
  label: string;
  href: string;
  count?: number;
}

export interface DiscoverHomeData {
  totalUpcoming: number;
  rows: DiscoverRow[];
  venueChips: DiscoverChip[];
  genreChips: DiscoverChip[];
  windows: DiscoverDateWindows;
}

const ROW_LIMIT = 12;
const POOL_LIMIT = 100;
/** Matches kept for the "Near" row; the catalog is scanned until this many are found. */
const NEAR_RADIUS_MATCH_LIMIT = POOL_LIMIT;
/** Minimum verified-price events before an "Under $30" row is shown. */
const MIN_VERIFIED_PRICE_ROW = 4;
const UNDER_PRICE = 30;

interface PersonalizedPick {
  picked: ScoredEvent[];
  genreEvents: ScoredEvent[];
  genreTaste: GenreTasteSummaryItem[];
}
const EMPTY_PERSONALIZED: PersonalizedPick = {
  picked: [],
  genreEvents: [],
  genreTaste: [],
};

type CatalogReader = Pick<ICatalogRepository, 'listEvents' | 'countEvents'> &
  Partial<Pick<ICatalogRepository, 'getFacets'>>;

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[DiscoverHome] ${label} failed:`, err);
    return fallback;
  }
}

/** Cancelled shows never belong in discovery rows. */
function isVisible(e: CanonicalEventSummary | ScoredEvent): boolean {
  const summary = 'event' in e ? e.event : e;
  return summary.status !== 'cancelled';
}

function search(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `/search?${s}` : '/search';
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function topByCount(
  values: Array<string | null | undefined>,
  max: number,
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const v of values) {
    const name = v?.trim();
    if (!name || name === 'Venue TBA') continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, max);
}

/**
 * Builds the rows shown on the public Discover home from real catalog data.
 * Every row is future-only and omitted when it has no events. Nothing here
 * invents prices, availability, or recency: rows that need data the catalog
 * summary does not carry (e.g. "just announced") are intentionally absent.
 */
export async function getDiscoverHomeData(options: {
  catalogRepo: CatalogReader;
  userId?: string | null;
  now?: Date;
  /** The visitor's chosen home city/coordinates (from the city picker). */
  homeLocation?: {
    city?: string;
    state?: string;
    lat: number;
    lng: number;
  } | null;
  /**
   * The signed-in user's saved travel radius. When set together with a home location, the
   * "Near" row shows everything within that many miles instead of only the home city's shows.
   */
  homeRadiusMiles?: number | null;
}): Promise<DiscoverHomeData> {
  const { catalogRepo, userId, homeLocation, homeRadiusMiles } = options;
  const useRadius =
    typeof homeRadiusMiles === 'number' &&
    Number.isFinite(homeRadiusMiles) &&
    homeRadiusMiles > 0 &&
    Boolean(homeLocation);
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const windows = getDiscoverDateWindows(now);

  const base: EventListFilters = {
    fromDate: windows.today,
    excludePastShowtimes: true,
    referenceNowIso: nowIso,
    sortBy: 'date_asc',
  };

  const list = (extra: EventListFilters) =>
    catalogRepo.listEvents({ ...base, limit: ROW_LIMIT, ...extra });

  const nearPromise =
    useRadius && homeLocation
      ? safe(
          `within ${homeRadiusMiles} mi`,
          async () =>
            listAllEventsWithinRadius(
              { listEvents: (f) => catalogRepo.listEvents(f) },
              base,
              homeLocation,
              homeRadiusMiles as number,
              undefined,
              NEAR_RADIUS_MATCH_LIMIT,
            ),
          [] as CanonicalEventSummary[],
        )
      : homeLocation?.city
        ? safe(
            `near ${homeLocation.city}`,
            () => list({ city: homeLocation.city, limit: ROW_LIMIT * 2 }),
            [] as CanonicalEventSummary[],
          )
        : Promise.resolve([] as CanonicalEventSummary[]);

  const [
    personalized,
    pool,
    weekend,
    nextWeek,
    free,
    priced,
    planAhead,
    totalUpcoming,
    facets,
  ] = await Promise.all([
    userId
      ? safe(
          'personalized',
          async () => {
            const data = await getPersonalizedDiscoverData({
              userId,
              locationOverride: homeLocation
                ? { lat: homeLocation.lat, lng: homeLocation.lng }
                : undefined,
            });
            const ranked = [...data.recommendations, ...data.exploratory];
            return {
              picked: ranked.slice(0, ROW_LIMIT),
              // Shows that fit the user's inferred genre taste (not a direct artist match).
              genreEvents: ranked
                .filter((e) => e.genreMatch && !e.matchedArtist)
                .slice(0, ROW_LIMIT),
              genreTaste: data.genreTaste ?? [],
            } as PersonalizedPick;
          },
          EMPTY_PERSONALIZED,
        )
      : Promise.resolve(EMPTY_PERSONALIZED),
    safe(
      'pool',
      () => catalogRepo.listEvents({ ...base, limit: POOL_LIMIT }),
      [] as CanonicalEventSummary[],
    ),
    safe(
      'weekend',
      () =>
        list({
          fromDate: windows.weekend.startDate,
          toDate: windows.weekend.endDate,
        }),
      [] as CanonicalEventSummary[],
    ),
    safe(
      'next 7 days',
      // Over-fetch: the weekend's shows are removed from this row afterwards.
      () => list({ toDate: windows.nextWeekEnd, limit: ROW_LIMIT * 3 }),
      [] as CanonicalEventSummary[],
    ),
    safe('free', () => list({ freeOnly: true }), [] as CanonicalEventSummary[]),
    safe(
      'under price',
      () =>
        list({
          maxPrice: UNDER_PRICE,
          includeUnknownPrice: false,
          sortBy: 'price_asc',
          limit: 24,
        }),
      [] as CanonicalEventSummary[],
    ),
    safe(
      'plan ahead',
      () =>
        list({
          fromDate: windows.planAheadStart,
          toDate: windows.horizonEnd,
          limit: ROW_LIMIT * 3,
        }),
      [] as CanonicalEventSummary[],
    ),
    safe(
      'count',
      () =>
        typeof catalogRepo.countEvents === 'function'
          ? catalogRepo.countEvents({
              fromDate: windows.today,
              excludePastShowtimes: true,
              referenceNowIso: nowIso,
            })
          : Promise.resolve(0),
      0,
    ),
    safe(
      'facets',
      () =>
        typeof catalogRepo.getFacets === 'function'
          ? catalogRepo.getFacets()
          : Promise.resolve(undefined),
      undefined,
    ),
  ]);

  const rows: DiscoverRow[] = [];
  // Duplicate rule (keep in sync with tests/unit/review-search-home-dedupe):
  //  - TIME rows (This weekend, Next 7 days, Plan ahead) and CITY rows
  //    ("In <city>") each claim their shows: a show appears in at most one of
  //    them, in page order.
  //  - Intentional overlap is allowed for rows that answer a different
  //    question: "Near <home city>", "Picked for you", "Free shows" and
  //    "Under $30" never claim shows and never skip claimed ones.
  //  - City rows additionally skip shows already shown in "Near <home city>".
  const seen = new Set<string>();
  const nearIds = new Set<string>();
  const idOf = (e: CanonicalEventSummary | ScoredEvent) =>
    ('event' in e ? e.event : e).id;
  const take = (
    events: Array<CanonicalEventSummary | ScoredEvent>,
    max = ROW_LIMIT,
  ) => {
    const out = events.filter(isVisible).slice(0, max);
    out.forEach((e) => seen.add(idOf(e)));
    return out;
  };
  /** Like take(), but skips shows already featured in an earlier claiming row. */
  const takeFresh = (
    events: Array<CanonicalEventSummary | ScoredEvent>,
    extraSkip?: Set<string>,
  ) =>
    take(events.filter((e) => !seen.has(idOf(e)) && !extraSkip?.has(idOf(e))));
  /** Overlap-allowed rows: visible filter only, no claiming. */
  const takeShared = (
    events: Array<CanonicalEventSummary | ScoredEvent>,
    max = ROW_LIMIT,
  ) => events.filter(isVisible).slice(0, max);

  const nearEvents = await nearPromise;
  const nearRow = takeShared(nearEvents);
  nearRow.forEach((e) => nearIds.add(idOf(e)));
  if (useRadius && homeLocation && nearRow.length > 0) {
    rows.push({
      id: 'near-home',
      title: `Near ${homeLocation.city ?? 'you'}`,
      subtitle: `Within ${homeRadiusMiles} miles (approximate)`,
      events: nearRow,
      // /search reads the saved radius itself; near=1 turns the filter on.
      seeAllHref: search({ near: '1' }),
    });
  } else if (homeLocation?.city && nearRow.length > 0) {
    rows.push({
      id: 'near-home',
      title: `Near ${homeLocation.city}`,
      subtitle: 'Shows in your city',
      events: nearRow,
      seeAllHref: search({ city: homeLocation.city }),
    });
  }

  const picked = personalized.picked;
  const pickedRow = takeShared(picked);
  if (pickedRow.length > 0) {
    rows.push({
      id: 'picked',
      title: 'Picked for you',
      subtitle: 'Based on your artists and preferences',
      events: pickedRow,
      seeAllHref: '/search',
    });
  }

  // Genre taste row: dynamic per user. Only appears when the user's own listening implies a
  // genre and we hold shows that fit it; the subtitle states the assumption and its basis.
  const topTaste = personalized.genreTaste[0];
  const genreRowEvents = takeShared(personalized.genreEvents);
  if (topTaste && genreRowEvents.length >= 3) {
    rows.push({
      id: 'genre-taste',
      title: `More ${topTaste.label}`,
      subtitle: `We assume you like ${topTaste.label}, based on your listening to ${joinNames(topTaste.artists.slice(0, 3))}`,
      events: genreRowEvents,
      seeAllHref: search({ genre: topTaste.rawGenres[0] }),
    });
  }

  const weekendRow = takeFresh(weekend);
  if (weekendRow.length > 0) {
    rows.push({
      id: 'weekend',
      title: 'This weekend',
      events: weekendRow,
      seeAllHref: search({
        startDate: windows.weekend.startDate,
        endDate: windows.weekend.endDate,
      }),
    });
  }

  const nextWeekRow = takeFresh(nextWeek);
  if (nextWeekRow.length > 0) {
    rows.push({
      id: 'next-7-days',
      title: 'Next 7 days',
      events: nextWeekRow,
      seeAllHref: search({
        startDate: windows.today,
        endDate: windows.nextWeekEnd,
      }),
    });
  }

  const freeRow = takeShared(free);
  if (freeRow.length > 0) {
    rows.push({
      id: 'free',
      title: 'Free shows',
      subtitle: 'Verified free admission',
      events: freeRow,
      seeAllHref: search({ freeOnly: 'true' }),
    });
  }

  // Only verified, non-free prices count; unknown prices never qualify.
  const verifiedUnder = priced
    .filter(isVisible)
    .filter(
      (e) =>
        typeof e.minPrice === 'number' &&
        e.minPrice > 0 &&
        e.minPrice <= UNDER_PRICE,
    );
  if (verifiedUnder.length >= MIN_VERIFIED_PRICE_ROW) {
    rows.push({
      id: 'under-30',
      title: `Under $${UNDER_PRICE}`,
      subtitle: 'Shows with a listed ticket price',
      events: takeShared(verifiedUnder),
      seeAllHref: search({
        maxPrice: String(UNDER_PRICE),
        includeUnknownPrice: 'false',
        sort: 'price_asc',
      }),
    });
  }

  // City rows are derived from where the catalog actually has shows, not from
  // a hard-coded region.
  const topCities = topByCount(
    pool.map((e) => e.city),
    2,
  );
  const cityRows = await Promise.all(
    topCities.map(({ name }) =>
      safe(
        `city ${name}`,
        () => list({ city: name, limit: ROW_LIMIT * 4 }),
        [] as CanonicalEventSummary[],
      ),
    ),
  );
  topCities.forEach(({ name }, i) => {
    const cityRow = takeFresh(cityRows[i], nearIds);
    if (cityRow.length > 0) {
      rows.push({
        id: `city-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        title: `In ${name}`,
        events: cityRow,
        seeAllHref: search({ city: name }),
      });
    }
  });

  const planAheadRow = takeFresh(planAhead);
  if (planAheadRow.length > 0) {
    rows.push({
      id: 'plan-ahead',
      title: 'Plan ahead',
      subtitle: 'Shows more than a month out',
      events: planAheadRow,
      seeAllHref: search({
        startDate: windows.planAheadStart,
        endDate: windows.horizonEnd,
      }),
    });
  }

  const venueChips: DiscoverChip[] = topByCount(
    pool.map((e) => e.venueName),
    10,
  ).map(({ name, count }) => ({
    label: name,
    count,
    href: search({ venue: name }),
  }));

  const genreChips: DiscoverChip[] = (facets?.genres ?? [])
    .slice(0, 8)
    .map((g) => ({ label: g, href: search({ genre: g }) }));

  return {
    totalUpcoming,
    rows,
    venueChips,
    genreChips,
    windows,
  };
}
