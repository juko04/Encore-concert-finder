import crypto from 'node:crypto';
import type { EventCandidate } from '@/lib/domain/event-candidate';
import type {
  AcquisitionMethod,
  CrawlContext,
  EventSourceAdapter,
  RawIngest,
  SourceType,
} from '@/lib/domain/source';
import { VenueHttpClient } from '../http-client';
import type { VenueSourceConfig } from '../types';
import { parseRootsMusicProjectEvents } from './parser';

export class RootsMusicProjectAdapter implements EventSourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly sourceType: SourceType = 'venue';
  readonly acquisitionMethod: AcquisitionMethod = 'html_http';
  readonly parserVersion = '1.0.0';

  private readonly config: VenueSourceConfig;
  private readonly httpClient: VenueHttpClient;
  private readonly calendarUrl: string;

  constructor(
    config: VenueSourceConfig,
    options?: {
      httpClient?: VenueHttpClient;
      calendarUrl?: string;
    },
  ) {
    this.config = config;
    this.id = `${config.slug}-adapter`;
    this.name = `${config.name} Adapter`;
    this.httpClient = options?.httpClient ?? new VenueHttpClient();
    this.calendarUrl = options?.calendarUrl ?? config.calendarUrl;
  }

  async fetch(context: CrawlContext): Promise<RawIngest[]> {
    const targetUrl = context.targetUrl || this.calendarUrl;
    const response = await this.httpClient.get(targetUrl);

    const contentHash = crypto
      .createHash('sha256')
      .update(response.body)
      .digest('hex');

    const rawIngest: RawIngest = {
      sourceId: context.sourceId,
      sourceUrl: targetUrl,
      acquisitionMethod: this.acquisitionMethod,
      fetchedAt: response.fetchedAt,
      contentHash,
      contentType: response.contentType,
      rawContent: response.body,
      httpStatus: response.status,
      parserVersion: this.parserVersion,
    };

    return [rawIngest];
  }

  async parse(rawIngests: RawIngest[]): Promise<EventCandidate[]> {
    const candidates: EventCandidate[] = [];

    for (const ingest of rawIngests) {
      if (!ingest.rawContent) continue;

      const parsed = parseRootsMusicProjectEvents(ingest.rawContent, {
        sourceId: ingest.sourceId,
        rawIngestId: ingest.id,
        sourceUrl: ingest.sourceUrl,
        fetchedAt: ingest.fetchedAt,
        contentHash: ingest.contentHash,
        parserVersion: ingest.parserVersion || this.parserVersion,
        defaultVenueConfig: this.config,
      });

      candidates.push(...parsed);
    }

    return candidates;
  }

  async crawl(
    context: CrawlContext,
  ): Promise<{ rawIngests: RawIngest[]; candidates: EventCandidate[] }> {
    const rawIngests = await this.fetch(context);
    const candidates = await this.parse(rawIngests);
    return { rawIngests, candidates };
  }
}
