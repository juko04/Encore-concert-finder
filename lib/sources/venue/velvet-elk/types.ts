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
