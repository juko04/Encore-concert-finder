/**
 * SeatGeek Platform API types (price-only enrichment source).
 * Plan: docs/phases/active/MARKET_PRICES_PLAN.md.
 *
 * Only the fields Encore reads are typed; everything else in the payload is kept verbatim in
 * raw_ingests.
 */

export const SEATGEEK_PARSER_VERSION = 'seatgeek-prices-1.0.0';

/** Raw `/2/events` response (subset). */
export interface SeatGeekEventsResponse {
  events?: SeatGeekRawEvent[];
  meta?: { total?: number; page?: number; per_page?: number };
}

export interface SeatGeekRawEvent {
  id?: number | string;
  title?: string;
  short_title?: string;
  url?: string;
  type?: string;
  datetime_local?: string;
  datetime_utc?: string;
  datetime_tbd?: boolean;
  date_tbd?: boolean;
  time_tbd?: boolean;
  taxonomies?: Array<{ name?: string }>;
  performers?: Array<{ name?: string; short_name?: string; primary?: boolean }>;
  venue?: {
    id?: number | string;
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    timezone?: string;
    location?: { lat?: number; lon?: number };
  };
  stats?: {
    listing_count?: number | null;
    lowest_price?: number | null;
    average_price?: number | null;
    highest_price?: number | null;
  };
}

/** A parsed SeatGeek listing: one marketplace event with its current price stats. */
export interface MarketListing {
  marketplaceEventId: string;
  title: string;
  url: string | null;
  isFestival: boolean;
  /** Venue-local calendar date (YYYY-MM-DD) as published by SeatGeek; null when TBD. */
  localDate: string | null;
  /** Start instant in UTC (ISO); null when the time is TBD. */
  startsAtUtc: string | null;
  performers: string[];
  venue: {
    name: string;
    city: string | null;
    state: string | null;
    country: string | null;
    lat: number | null;
    lng: number | null;
  };
  lowestPrice: number | null;
  averagePrice: number | null;
  highestPrice: number | null;
  listingCount: number;
  /** Only set when SeatGeek's venue is in the US (the API reports USD). Never converted. */
  currency: string | null;
}

/** A canonical event, shaped for matching. Loaded read-only from the catalog. */
export interface CatalogEventForMatch {
  id: string;
  name: string;
  eventKind: string;
  localStartDate: string;
  /** Last day covered: festival group end, multi-day end, or the start date. */
  localEndDate: string;
  startsAt: string | null;
  hasListedPrice: boolean;
  festivalGroupId: string | null;
  festivalGroupPrimary: boolean;
  venue: {
    name: string | null;
    aliases: string[];
    region: string | null;
    lat: number | null;
    lng: number | null;
  };
  artistNames: string[];
}

export type MatchMethod =
  | 'venue_date_performer'
  | 'venue_date_title'
  | 'venue_date_time_performer'
  | 'festival_dates_name';

export type MatchOutcome =
  | {
      kind: 'matched';
      eventId: string;
      method: MatchMethod;
      confidence: number;
    }
  | {
      kind: 'skipped' | 'unmatched' | 'ambiguous';
      reason: string;
      candidateIds?: string[];
    };

export interface MarketPriceObservationInput {
  eventId: string;
  sourceId: string;
  rawIngestId: string;
  marketplaceEventId: string;
  marketplaceUrl: string | null;
  lowestPrice: number | null;
  averagePrice: number | null;
  highestPrice: number | null;
  listingCount: number;
  currency: string | null;
  observedAt: string;
  matchMethod: MatchMethod;
  matchConfidence: number;
  parserVersion: string;
}
