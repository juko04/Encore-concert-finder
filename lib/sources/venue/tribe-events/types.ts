import type { VenueHttpClient } from '../http-client';
import type { VenueSourceConfig } from '../types';

/** Subset of The Events Calendar (Tribe) REST v1 event object that Encore reads. */
export interface TribeVenue {
  venue?: string;
  address?: string;
  city?: string;
  stateprovince?: string;
  state?: string;
  zip?: string;
  country?: string;
  geo_lat?: number | string;
  geo_lng?: number | string;
}

export interface TribeEvent {
  id: number;
  url?: string;
  title?: string;
  status?: string;
  all_day?: boolean;
  start_date?: string;
  end_date?: string;
  timezone?: string;
  cost?: string;
  cost_details?: { currency_code?: string; values?: Array<string | number> };
  website?: string;
  hide_from_listings?: boolean;
  is_virtual?: boolean;
  image?: { url?: string } | false;
  venue?: TribeVenue | unknown[];
  custom_fields?:
    Record<string, { label?: string; value?: unknown } | undefined> | unknown[];
}

export interface TribeEventsResponse {
  events?: TribeEvent[];
  next_rest_url?: string;
  total_pages?: number;
}

export interface TribeParseContext {
  sourceId: string;
  rawIngestId?: string;
  sourceUrl: string;
  fetchedAt: string;
  contentHash: string;
  parserVersion: string;
  /** Fallback venue (used only when an event carries no venue of its own). */
  defaultVenueConfig?: VenueSourceConfig;
  /** When false (multi-venue calendars) events without their own venue are skipped. */
  useConfigVenueFallback?: boolean;
}

export interface TribeAdapterOptions {
  httpClient?: VenueHttpClient;
  /** Absolute REST URL, e.g. https://example.org/wp-json/tribe/events/v1/events */
  apiUrl: string;
  maxPages?: number;
  perPage?: number;
  /** Delay between page requests (politeness: at most one request per second). */
  requestDelayMs?: number;
  /** Local ISO date (YYYY-MM-DD) to start from; defaults to today in UTC. */
  startDate?: string;
  /** Single-venue sites: use the configured venue when an event carries none. */
  useConfigVenueFallback?: boolean;
}
