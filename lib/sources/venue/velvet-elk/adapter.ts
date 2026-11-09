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
import {
  extractVelvetElkDetailUrls,
  isAllowedVelvetElkDetailUrl,
  isVelvetElkDetailPage,
  parseVelvetElkEvents,
} from './parser';
import type { VelvetElkAdapterOptions } from './types';

export class VelvetElkAdapter implements EventSourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly sourceType: SourceType = 'venue';
  readonly acquisitionMethod: AcquisitionMethod = 'html_http';
  readonly parserVersion = '1.0.0';

  private readonly config: VenueSourceConfig;
  private readonly httpClient: VenueHttpClient;
  private readonly calendarUrl: string;
  private readonly enrichEventDetails: boolean;
  private readonly maxDetailPages: number;

  constructor(config: VenueSourceConfig, options?: VelvetElkAdapterOptions) {
    this.config = config;
    this.id = `${config.slug}-adapter`;
    this.name = `${config.name} Adapter`;
    this.httpClient = options?.httpClient ?? new VenueHttpClient();
    this.calendarUrl = options?.calendarUrl ?? config.calendarUrl;
    this.enrichEventDetails = options?.enrichEventDetails ?? true;
    this.maxDetailPages = options?.maxDetailPages ?? 15;
  }

  async fetch(context: CrawlContext): Promise<RawIngest[]> {
    const targetUrl = context.targetUrl || this.calendarUrl;
    const response = await this.httpClient.get(targetUrl);

    const contentHash = crypto
      .createHash('sha256')
      .update(response.body)
      .digest('hex');

    const calendarIngest: RawIngest = {
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

    const rawIngests: RawIngest[] = [calendarIngest];

    // Enrich with individual event detail pages when enabled
    if (this.enrichEventDetails && response.body) {
      const detailUrls = extractVelvetElkDetailUrls(
        response.body,
        this.config.baseUrl || 'https://www.velvetelklounge.com',
      );

      const urlsToFetch = detailUrls.slice(0, this.maxDetailPages);
      const baseUrl = this.config.baseUrl || 'https://www.velvetelklounge.com';

      for (const detailUrl of urlsToFetch) {
        // Enforce origin and path validation before issuing HTTP request
        if (!isAllowedVelvetElkDetailUrl(detailUrl, baseUrl)) {
          continue;
        }

        try {
          const detailResponse = await this.httpClient.get(detailUrl, {
            validateRedirectUrl: (targetUrl) =>
              isAllowedVelvetElkDetailUrl(targetUrl, baseUrl),
            maxRedirects: 3,
          });
          if (detailResponse.status === 200 && detailResponse.body) {
            // Defense in depth: verify final response URL also matches allowed Velvet Elk detail URL
            if (!isAllowedVelvetElkDetailUrl(detailResponse.url, baseUrl)) {
              continue;
            }

            const detailHash = crypto
              .createHash('sha256')
              .update(detailResponse.body)
              .digest('hex');

            rawIngests.push({
              sourceId: context.sourceId,
              sourceUrl: detailResponse.url || detailUrl,
              acquisitionMethod: this.acquisitionMethod,
              fetchedAt: detailResponse.fetchedAt,
              contentHash: detailHash,
              contentType: detailResponse.contentType,
              rawContent: detailResponse.body,
              httpStatus: detailResponse.status,
              parserVersion: this.parserVersion,
            });
          }
        } catch {
          // Graceful fallback: detail fetch failure retains calendar card listing
        }
      }
    }

    return rawIngests;
  }

  async parse(rawIngests: RawIngest[]): Promise<EventCandidate[]> {
    // 1. Separate listing ingests from detail page ingests
    const listingIngests: RawIngest[] = [];
    const detailIngests: RawIngest[] = [];

    for (const ingest of rawIngests) {
      if (!ingest.rawContent) continue;
      if (isVelvetElkDetailPage(ingest.rawContent)) {
        detailIngests.push(ingest);
      } else {
        listingIngests.push(ingest);
      }
    }

    // 2. Parse all detail ingests into a candidate map keyed by detail URL
    const detailCandidatesByUrl = new Map<string, EventCandidate>();
    for (const detailIngest of detailIngests) {
      const parsed = parseVelvetElkEvents(detailIngest.rawContent!, {
        sourceId: detailIngest.sourceId,
        rawIngestId: detailIngest.id,
        sourceUrl: detailIngest.sourceUrl,
        fetchedAt: detailIngest.fetchedAt,
        contentHash: detailIngest.contentHash,
        parserVersion: detailIngest.parserVersion || this.parserVersion,
        defaultVenueConfig: this.config,
      });

      for (const candidate of parsed) {
        detailCandidatesByUrl.set(detailIngest.sourceUrl, candidate);
      }
    }

    // 3. If no listing ingests were provided, return all parsed detail candidates
    if (listingIngests.length === 0) {
      return Array.from(detailCandidatesByUrl.values());
    }

    // 4. Parse listing ingests and enrich each card with detail data when available
    const finalCandidates: EventCandidate[] = [];

    for (const listingIngest of listingIngests) {
      const listingCandidates = parseVelvetElkEvents(
        listingIngest.rawContent!,
        {
          sourceId: listingIngest.sourceId,
          rawIngestId: listingIngest.id,
          sourceUrl: listingIngest.sourceUrl,
          fetchedAt: listingIngest.fetchedAt,
          contentHash: listingIngest.contentHash,
          parserVersion: listingIngest.parserVersion || this.parserVersion,
          defaultVenueConfig: this.config,
        },
      );

      for (const cardCandidate of listingCandidates) {
        const detailUrl =
          cardCandidate.provenance.sourceUrl || cardCandidate.ticketUrl;
        const enriched = detailUrl
          ? detailCandidatesByUrl.get(detailUrl)
          : undefined;

        if (enriched) {
          // Use enriched candidate containing verified showtime, Etix ticket link, and detail provenance
          finalCandidates.push(enriched);
        } else {
          // Retain listing card candidate as fallback
          finalCandidates.push(cardCandidate);
        }
      }
    }

    return finalCandidates;
  }

  async crawl(
    context: CrawlContext,
  ): Promise<{ rawIngests: RawIngest[]; candidates: EventCandidate[] }> {
    const rawIngests = await this.fetch(context);
    const candidates = await this.parse(rawIngests);
    return { rawIngests, candidates };
  }
}
