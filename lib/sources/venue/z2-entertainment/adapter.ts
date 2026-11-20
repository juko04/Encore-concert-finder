import crypto from 'node:crypto';
import type { EventCandidate } from '@/lib/domain/event-candidate';
import type {
  AcquisitionMethod,
  CrawlContext,
  RawIngest,
  SourceType,
} from '@/lib/domain/source';
import { VenueHttpClient } from '../http-client';
import type { IVenueSourceAdapter, VenueSourceConfig } from '../types';
import { extractZ2NextPageUrl, parseZ2Events } from './parser';
import type { Z2AdapterOptions } from './types';

export const Z2_DEFAULT_CALENDAR_URL = 'https://z2ent.com/events';
export const Z2_DEFAULT_SOURCE_ID = 'b0000000-0000-0000-0000-000000000010';

export class Z2EntertainmentAdapter implements IVenueSourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly sourceType: SourceType = 'venue';
  readonly acquisitionMethod: AcquisitionMethod = 'html_http';
  readonly parserVersion = '1.0.0';

  private readonly config?: VenueSourceConfig;
  private readonly httpClient: VenueHttpClient;
  private readonly calendarUrl: string;
  private readonly maxPages: number;

  constructor(config?: VenueSourceConfig, options?: Z2AdapterOptions) {
    this.config = config ?? options?.config;
    this.id = this.config?.id ?? Z2_DEFAULT_SOURCE_ID;
    this.name = this.config?.name
      ? `${this.config.name} Adapter`
      : 'Z2 Entertainment Adapter';
    this.httpClient = options?.httpClient ?? new VenueHttpClient();
    this.calendarUrl =
      options?.calendarUrl ??
      this.config?.calendarUrl ??
      Z2_DEFAULT_CALENDAR_URL;
    this.maxPages = options?.maxPages ?? 1;
  }

  async fetch(context: CrawlContext): Promise<RawIngest[]> {
    const rawIngests: RawIngest[] = [];
    let currentUrl: string | null = context.targetUrl || this.calendarUrl;
    let pageCount = 0;
    const visitedUrls = new Set<string>();

    while (
      currentUrl &&
      pageCount < this.maxPages &&
      !visitedUrls.has(currentUrl)
    ) {
      visitedUrls.add(currentUrl);
      pageCount++;

      const response = await this.httpClient.get(currentUrl);

      const contentHash = crypto
        .createHash('sha256')
        .update(response.body)
        .digest('hex');

      const ingest: RawIngest = {
        sourceId: context.sourceId,
        sourceUrl: currentUrl,
        acquisitionMethod: this.acquisitionMethod,
        fetchedAt: response.fetchedAt,
        contentHash,
        contentType: response.contentType,
        rawContent: response.body,
        httpStatus: response.status,
        parserVersion: this.parserVersion,
      };

      rawIngests.push(ingest);

      // Check for next page URL if more pages allowed
      if (pageCount < this.maxPages && response.body) {
        currentUrl = extractZ2NextPageUrl(response.body, currentUrl);
      } else {
        currentUrl = null;
      }
    }

    return rawIngests;
  }

  async parse(rawIngests: RawIngest[]): Promise<EventCandidate[]> {
    const candidates: EventCandidate[] = [];
    const seenEventKeys = new Set<string>();

    for (const ingest of rawIngests) {
      if (!ingest.rawContent) continue;

      const parsed = parseZ2Events(ingest.rawContent, {
        sourceId: ingest.sourceId,
        rawIngestId: ingest.id,
        sourceUrl: ingest.sourceUrl,
        fetchedAt: ingest.fetchedAt,
        contentHash: ingest.contentHash,
        parserVersion: ingest.parserVersion || this.parserVersion,
        defaultVenueConfig: this.config,
      });

      for (const candidate of parsed) {
        const key =
          candidate.sourceEventId ||
          `${candidate.venueName}|${candidate.localStartDate}|${candidate.title.toLowerCase()}`;

        if (!seenEventKeys.has(key)) {
          seenEventKeys.add(key);
          candidates.push(candidate);
        }
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
