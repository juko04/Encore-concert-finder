import type { VenueHttpClient } from '../http-client';
import type { VenueSourceConfig } from '../types';

export interface MishawakaParseContext {
  sourceId: string;
  rawIngestId?: string;
  sourceUrl: string;
  fetchedAt: string;
  contentHash: string;
  parserVersion: string;
  defaultVenueConfig?: VenueSourceConfig;
}

export interface MishawakaAdapterOptions {
  httpClient?: VenueHttpClient;
  calendarUrl?: string;
}
