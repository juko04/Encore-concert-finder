import type { EventCandidate } from '@/lib/domain/event-candidate';
import type {
  AcquisitionMethod,
  CrawlContext,
  RawIngest,
  SourceType,
} from '@/lib/domain/source';
import { VenueHttpClient } from '../http-client';
import {
  buildVenueParseContext,
  buildVenueRawIngest,
  dedupeBy,
} from '../adapter-helpers';
import type { IVenueSourceAdapter, VenueSourceConfig } from '../types';
import { parseTribeEvents } from './parser';
import type { TribeAdapterOptions, TribeEventsResponse } from './types';

/**
 * Some venue hosts reject browser-impersonating user agents; an honest, plain client
 * identifier is accepted and is what we want to send anyway.
 */
export const POLITE_VENUE_USER_AGENT =
  'EncoreConcertFinder/1.0 (+https://encore.live)';

/**
 * Adapter for venues publishing The Events Calendar (Tribe) public REST API
 * (`/wp-json/tribe/events/v1/events`). Used by Bohemian Live Music (Washington's, The Armory)
 * and 10 Mile Music Hall.
 */
export class TribeEventsAdapter implements IVenueSourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly sourceType: SourceType = 'venue';
  readonly acquisitionMethod: AcquisitionMethod = 'html_http';
  readonly parserVersion = '1.0.0';

  private readonly httpClient: VenueHttpClient;
  private readonly maxPages: number;
  private readonly perPage: number;
  private readonly requestDelayMs: number;

  constructor(
    private readonly config: VenueSourceConfig,
    private readonly options: TribeAdapterOptions,
  ) {
    this.id = config.id ?? config.slug;
    this.name = `${config.name} Adapter`;
    this.httpClient =
      options.httpClient ??
      new VenueHttpClient({ userAgent: POLITE_VENUE_USER_AGENT });
    this.maxPages = options.maxPages ?? 5;
    this.perPage = options.perPage ?? 50;
    this.requestDelayMs = options.requestDelayMs ?? 1000;
  }

  private firstPageUrl(): string {
    const url = new URL(this.options.apiUrl);
    url.searchParams.set('per_page', String(this.perPage));
    url.searchParams.set(
      'start_date',
      this.options.startDate ?? new Date().toISOString().slice(0, 10),
    );
    return url.toString();
  }

  async fetch(context: CrawlContext): Promise<RawIngest[]> {
    const rawIngests: RawIngest[] = [];
    const visited = new Set<string>();
    let currentUrl: string | null = this.firstPageUrl();
    let pages = 0;

    while (currentUrl && pages < this.maxPages && !visited.has(currentUrl)) {
      visited.add(currentUrl);
      if (pages > 0 && this.requestDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.requestDelayMs));
      }
      pages++;
      const response = await this.httpClient.get(currentUrl);
      rawIngests.push(
        buildVenueRawIngest({
          context,
          sourceUrl: currentUrl,
          response,
          acquisitionMethod: this.acquisitionMethod,
          parserVersion: this.parserVersion,
        }),
      );

      currentUrl = null;
      try {
        const next = (JSON.parse(response.body) as TribeEventsResponse)
          .next_rest_url;
        if (typeof next === 'string' && /^https?:\/\//i.test(next)) {
          // Only follow pagination on the same host as the configured API.
          if (new URL(next).host === new URL(this.options.apiUrl).host) {
            currentUrl = next;
          }
        }
      } catch {
        currentUrl = null;
      }
    }
    return rawIngests;
  }

  async parse(rawIngests: RawIngest[]): Promise<EventCandidate[]> {
    const candidates: EventCandidate[] = [];
    for (const ingest of rawIngests) {
      if (!ingest.rawContent) continue;
      const parsed = parseTribeEvents(ingest.rawContent, {
        ...buildVenueParseContext(ingest, this.parserVersion),
        defaultVenueConfig: this.config,
        useConfigVenueFallback: this.options.useConfigVenueFallback,
      });
      candidates.push(...parsed);
    }
    return dedupeBy(
      candidates,
      (c) => c.provenance.sourceEventId ?? `${c.title}|${c.localStartDate}`,
    );
  }

  async crawl(
    context: CrawlContext,
  ): Promise<{ rawIngests: RawIngest[]; candidates: EventCandidate[] }> {
    const rawIngests = await this.fetch(context);
    const candidates = await this.parse(rawIngests);
    return { rawIngests, candidates };
  }
}
