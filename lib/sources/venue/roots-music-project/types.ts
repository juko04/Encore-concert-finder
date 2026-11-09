import type { VenueSourceConfig } from '../types';

export interface RootsMusicProjectParseContext {
  sourceId: string;
  rawIngestId?: string;
  sourceUrl?: string;
  fetchedAt?: string;
  contentHash?: string;
  parserVersion?: string;
  defaultVenueConfig?: VenueSourceConfig;
}
