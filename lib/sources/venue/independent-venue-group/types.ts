import type { VenueSourceConfig } from '../types';

export interface IndependentVenueParseContext {
  sourceId: string;
  rawIngestId?: string;
  sourceUrl: string;
  fetchedAt?: string;
  contentHash?: string;
  parserVersion?: string;
  defaultVenueConfig?: VenueSourceConfig;
}
