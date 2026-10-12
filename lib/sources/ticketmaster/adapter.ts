import crypto from 'node:crypto';
import type {
  AcquisitionMethod,
  CrawlContext,
  EventSourceAdapter,
  RawIngest,
  SourceType,
} from '@/lib/domain/source';
import type { EventCandidate } from '@/lib/domain/event-candidate';
import { TicketmasterApiClient, TicketmasterClientOptions } from './client';
import { parseTicketmasterEvent } from './parser';
import {
  TicketmasterEventQueryParams,
  TicketmasterEventsResponseSchema,
} from './types';

export class TicketmasterDiscoveryAdapter implements EventSourceAdapter {
  readonly id = 'b0000000-0000-0000-0000-000000000002';
  readonly slug = 'ticketmaster-discovery';
  readonly name = 'Ticketmaster Discovery API';
  readonly sourceType: SourceType = 'ticketing';
  readonly acquisitionMethod: AcquisitionMethod = 'api';
  readonly parserVersion = '1.0.0';

  private readonly client: TicketmasterApiClient;

  constructor(options?: TicketmasterClientOptions) {
    this.client = new TicketmasterApiClient(options);
  }

  /**
   * Fetches raw JSON page snapshots from Ticketmaster Discovery API.
   */
  async fetch(context: CrawlContext): Promise<RawIngest[]> {
    const metadata = (context.metadata || {}) as TicketmasterEventQueryParams;
    const queryParams: TicketmasterEventQueryParams = {
      stateCode: metadata.stateCode,
      marketId: metadata.marketId,
      city: metadata.city,
      keyword: metadata.keyword,
      attractionId: metadata.attractionId,
      venueId: metadata.venueId,
      startDateTime: metadata.startDateTime,
      endDateTime: metadata.endDateTime,
      classificationName: metadata.classificationName ?? 'Music',
      size: metadata.size ?? 20,
      page: metadata.page ?? 0,
      sort: metadata.sort ?? 'date,asc',
    };

    const { rawJson, url } = await this.client.fetchEvents(queryParams);

    const contentHash = crypto
      .createHash('sha256')
      .update(rawJson)
      .digest('hex');

    const rawIngest: RawIngest = {
      id: crypto.randomUUID(),
      sourceId: context.sourceId || this.id,
      sourceUrl: url,
      acquisitionMethod: this.acquisitionMethod,
      fetchedAt: context.crawlStartedAt,
      contentHash,
      contentType: 'application/json',
      rawContent: rawJson,
      httpStatus: 200,
      parserVersion: this.parserVersion,
    };

    return [rawIngest];
  }

  /**
   * Parses raw JSON page snapshots into structured EventCandidate observations.
   */
  async parse(rawIngests: RawIngest[]): Promise<EventCandidate[]> {
    const candidates: EventCandidate[] = [];
    for (const raw of rawIngests) {
      if (!raw.rawContent || raw.rawContent.trim().length === 0) {
        if (raw.externalStorageRef) {
          throw new Error(
            `Ticketmaster raw ingest content is stored in external storage (${raw.externalStorageRef}), which requires asynchronous retrieval not supported in PR 1.`,
          );
        }
        throw new Error(
          `Ticketmaster raw ingest content is missing or unavailable for source ${raw.sourceId} (rawIngestId: ${raw.id || 'unpersisted'}).`,
        );
      }

      let json: unknown;
      try {
        json = JSON.parse(raw.rawContent);
      } catch (err) {
        throw new Error(
          `Failed to parse Ticketmaster raw ingest JSON for source ${raw.sourceId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      const parseResult = TicketmasterEventsResponseSchema.safeParse(json);
      if (!parseResult.success) {
        const errorDetails = parseResult.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw new Error(
          `Ticketmaster raw ingest schema validation failed for source ${raw.sourceId}: ${errorDetails}`,
        );
      }

      const events = parseResult.data._embedded?.events || [];
      for (const event of events) {
        const candidate = parseTicketmasterEvent(event, {
          sourceId: raw.sourceId,
          rawIngestId: raw.id || crypto.randomUUID(),
          sourceUrl: raw.sourceUrl,
          fetchedAt: raw.fetchedAt,
          contentHash: raw.contentHash,
          parserVersion: raw.parserVersion,
        });

        candidates.push(candidate);
      }
    }

    return candidates;
  }

  /**
   * End-to-end crawl fetching raw payloads and extracting parsed candidates.
   */
  async crawl(
    context: CrawlContext,
  ): Promise<{ rawIngests: RawIngest[]; candidates: EventCandidate[] }> {
    const rawIngests = await this.fetch(context);
    const candidates = await this.parse(rawIngests);
    return { rawIngests, candidates };
  }
}
