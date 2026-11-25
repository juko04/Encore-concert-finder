import crypto from 'node:crypto';
import type { EventCandidate } from '@/lib/domain/event-candidate';
import type {
  AcquisitionMethod,
  CrawlContext,
  RawIngest,
  SourceType,
} from '@/lib/domain/source';
import { VenueHttpClient } from '../http-client';
import { POLITE_VENUE_USER_AGENT } from '../tribe-events/adapter';
import type { IVenueSourceAdapter, VenueSourceConfig } from '../types';
import { parseMishawakaEvents } from './parser';
import type { MishawakaAdapterOptions } from './types';

export const MISHAWAKA_LIST_URL =
  'https://www.themishawaka.com/events/?view=list';

export class MishawakaAdapter implements IVenueSourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly sourceType: SourceType = 'venue';
  readonly acquisitionMethod: AcquisitionMethod = 'html_http';
  readonly parserVersion = '1.0.0';

  private readonly httpClient: VenueHttpClient;
  private readonly calendarUrl: string;

  constructor(
    private readonly config: VenueSourceConfig,
    options?: MishawakaAdapterOptions,
  ) {
    this.id = config.id ?? config.slug;
    this.name = `${config.name} Adapter`;
    this.httpClient =
      options?.httpClient ??
      new VenueHttpClient({ userAgent: POLITE_VENUE_USER_AGENT });
    this.calendarUrl = options?.calendarUrl ?? MISHAWAKA_LIST_URL;
  }

  async fetch(context: CrawlContext): Promise<RawIngest[]> {
    // The default /events/ page is a JS calendar grid; list view carries the event rows.
    const url = context.targetUrl?.includes('view=list')
      ? context.targetUrl
      : this.calendarUrl;
    const response = await this.httpClient.get(url);
    return [
      {
        sourceId: context.sourceId,
        sourceUrl: url,
        acquisitionMethod: this.acquisitionMethod,
        fetchedAt: response.fetchedAt,
        contentHash: crypto
          .createHash('sha256')
          .update(response.body)
          .digest('hex'),
        contentType: response.contentType,
        rawContent: response.body,
        httpStatus: response.status,
        parserVersion: this.parserVersion,
      },
    ];
  }

  async parse(rawIngests: RawIngest[]): Promise<EventCandidate[]> {
    const candidates: EventCandidate[] = [];
    const seen = new Set<string>();
    for (const ingest of rawIngests) {
      if (!ingest.rawContent) continue;
      const parsed = parseMishawakaEvents(ingest.rawContent, {
        sourceId: ingest.sourceId,
        rawIngestId: ingest.id,
        sourceUrl: ingest.sourceUrl,
        fetchedAt: ingest.fetchedAt,
        contentHash: ingest.contentHash,
        parserVersion: ingest.parserVersion || this.parserVersion,
        defaultVenueConfig: this.config,
      });
      for (const c of parsed) {
        const key =
          c.provenance.sourceEventId ??
          `${c.title}|${c.localStartDate}|${c.startsAt ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(c);
      }
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
