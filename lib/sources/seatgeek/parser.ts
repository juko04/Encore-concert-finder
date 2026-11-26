/**
 * Parses SeatGeek `/2/events` pages into MarketListing rows. Pure; no I/O.
 * Nothing here is invented: missing values stay null.
 */

import type {
  MarketListing,
  SeatGeekEventsResponse,
  SeatGeekRawEvent,
} from './types';

const LOCAL_DATE = /^(\d{4}-\d{2}-\d{2})T/;

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** SeatGeek's `datetime_utc` has no zone suffix; it is UTC by definition. */
function utcInstant(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseSeatGeekEvent(
  raw: SeatGeekRawEvent,
): MarketListing | null {
  const id = raw.id === undefined || raw.id === null ? null : String(raw.id);
  const title = text(raw.title) ?? text(raw.short_title);
  const venueName = text(raw.venue?.name);
  if (!id || !title || !venueName) return null;

  const dateTbd = raw.date_tbd === true || raw.datetime_tbd === true;
  const timeTbd = dateTbd || raw.time_tbd === true;
  const localDateMatch = dateTbd
    ? null
    : LOCAL_DATE.exec(raw.datetime_local ?? '');

  const taxonomies = (raw.taxonomies ?? [])
    .map((t) => (t.name ?? '').toLowerCase())
    .filter(Boolean);
  const isFestival =
    (raw.type ?? '').toLowerCase() === 'music_festival' ||
    taxonomies.includes('music_festival');

  const country = text(raw.venue?.country);
  const lowest = num(raw.stats?.lowest_price);
  const highest = num(raw.stats?.highest_price);

  return {
    marketplaceEventId: id,
    title,
    url: text(raw.url),
    isFestival,
    localDate: localDateMatch ? localDateMatch[1] : null,
    startsAtUtc: timeTbd ? null : utcInstant(raw.datetime_utc),
    performers: (raw.performers ?? [])
      .slice()
      .sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)))
      .map((p) => text(p.name))
      .filter((n): n is string => Boolean(n)),
    venue: {
      name: venueName,
      city: text(raw.venue?.city),
      state: text(raw.venue?.state)?.toUpperCase() ?? null,
      country,
      lat:
        typeof raw.venue?.location?.lat === 'number'
          ? raw.venue.location.lat
          : null,
      lng:
        typeof raw.venue?.location?.lon === 'number'
          ? raw.venue.location.lon
          : null,
    },
    lowestPrice: lowest,
    averagePrice: num(raw.stats?.average_price),
    // A reversed range is a data error; keep the floor, drop the ceiling.
    highestPrice:
      lowest !== null && highest !== null && highest < lowest ? null : highest,
    listingCount: Math.max(0, Math.trunc(num(raw.stats?.listing_count) ?? 0)),
    currency: country === 'US' ? 'USD' : null,
  };
}

export interface ParsedSeatGeekPage {
  listings: MarketListing[];
  invalid: number;
  total: number | null;
}

export function parseSeatGeekEventsPage(body: string): ParsedSeatGeekPage {
  const json = JSON.parse(body) as SeatGeekEventsResponse;
  const events = Array.isArray(json.events) ? json.events : [];
  const listings: MarketListing[] = [];
  let invalid = 0;
  for (const raw of events) {
    const listing = parseSeatGeekEvent(raw);
    if (listing) listings.push(listing);
    else invalid += 1;
  }
  const total = typeof json.meta?.total === 'number' ? json.meta.total : null;
  return { listings, invalid, total };
}
