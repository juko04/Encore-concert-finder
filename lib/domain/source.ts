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
  sourceUrl: string;
  sourceEventId?: string;
  fetchedAt: string;
  contentHash: string;
  parserVersion: string;
  confidence: number;
}

export interface CrawlContext {
  sourceId: string;
  sourceType: SourceType;
  targetUrl: string;
  crawlStartedAt: string;
  metadata?: Record<string, unknown>;
}

export interface RawIngest {
  id?: string;
  sourceId: string;
  sourceUrl: string;
  fetchedAt: string;
  contentHash: string;
  contentType: string;
  rawContent: string;
  httpStatus: number;
  parserVersion: string;
}

export interface EventSourceAdapter {
  readonly name: string;
  readonly sourceType: SourceType;
  readonly parserVersion: string;

  fetchRaw(context: CrawlContext): Promise<RawIngest>;
  parseCandidates(raw: RawIngest): Promise<EventCandidate[]>;
  crawl(
    context: CrawlContext,
  ): Promise<{ raw: RawIngest; candidates: EventCandidate[] }>;
}
