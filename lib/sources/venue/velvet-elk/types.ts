import type { VenueHttpClient } from '../http-client';
import type { VenueSourceConfig } from '../types';

export interface VelvetElkParseContext {
  sourceId: string;
  rawIngestId?: string;
  sourceUrl?: string;
  fetchedAt?: string;
  contentHash?: string;
  parserVersion?: string;
  defaultVenueConfig?: VenueSourceConfig;
}

export interface VelvetElkAdapterOptions {
  httpClient?: VenueHttpClient;
  calendarUrl?: string;
  enrichEventDetails?: boolean;
  maxDetailPages?: number;
}
