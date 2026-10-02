import type { EventCandidate } from './event-candidate';

export type SourceType =
  'api' | 'promoter' | 'venue' | 'festival' | 'ticketing' | 'social';

export type AcquisitionMethod =
  | 'api'
  | 'rss'
  | 'ics'
  | 'structured_json'
  | 'html_http'
  | 'browser_automation';

export interface SourceProvenance {
  sourceId: string;
  sourceType: SourceType;
  acquisitionMethod: AcquisitionMethod;
  sourceUrl: string;
  sourceEventId?: string;
  rawIngestId?: string;
  fetchedAt: string;
  contentHash: string;
  parserVersion: string;
  confidence: number;
}

export interface CrawlContext {
  sourceId: string;
  sourceType: SourceType;
  acquisitionMethod: AcquisitionMethod;
  targetUrl: string;
  crawlStartedAt: string;
  metadata?: Record<string, unknown>;
}

export interface RawIngest {
  id?: string;
  sourceId: string;
  sourceUrl: string;
  acquisitionMethod: AcquisitionMethod;
  fetchedAt: string;
  contentHash: string;
  contentType: string;
  rawContent: string;
  httpStatus: number;
  parserVersion: string;
}

export interface EventSourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly sourceType: SourceType;
  readonly acquisitionMethod: AcquisitionMethod;
  readonly parserVersion: string;

  fetch(context: CrawlContext): Promise<RawIngest[]>;
  parse(rawIngests: RawIngest[]): Promise<EventCandidate[]>;
  crawl(
    context: CrawlContext,
  ): Promise<{ rawIngests: RawIngest[]; candidates: EventCandidate[] }>;
}
