import type {
  AcquisitionMethod,
  CrawlContext,
  EventSourceAdapter,
  RawIngest,
  SourceProvenance,
  SourceType,
} from '@/lib/domain/source';
import type { EventCandidate } from '@/lib/domain/event-candidate';
import fixtureData from './fake-source-response.json';

interface RawEventPayload {
  id: string;
  name: string;
  artists: string[];
  venue: string;
  city?: string;
  state?: string;
  country?: string;
  timezone?: string;
  startsAt?: string;
  endsAt?: string;
  doorsOpenAt?: string;
  ticketUrl?: string;
  price?: {
    min?: number;
    max?: number;
    currency: string;
  };
  isFestival?: boolean;
  billing?: Array<{
    artistName: string;
    billingPosition?:
      'headliner' | 'subheadliner' | 'mid_card' | 'support' | 'unknown';
    stage?: string;
  }>;
}

interface RawPagePayload {
  page: number;
  url: string;
  events: RawEventPayload[];
}

interface FixturePayload {
  sourceId: string;
  pages: RawPagePayload[];
}

export class FakeVenueSourceAdapter implements EventSourceAdapter {
  readonly id = 'fake-venue-adapter';
  readonly name = 'Fake Venue Source Adapter';
  readonly sourceType: SourceType = 'venue';
  readonly acquisitionMethod: AcquisitionMethod = 'structured_json';
  readonly parserVersion = '1.1.0';

  private readonly fixture: FixturePayload;

  constructor(payload?: FixturePayload) {
    this.fixture = payload ?? (fixtureData as unknown as FixturePayload);
  }

  async fetch(context: CrawlContext): Promise<RawIngest[]> {
    return this.fixture.pages.map((page, index) => ({
      id: `raw_${this.id}_page_${page.page}`,
      sourceId: context.sourceId || this.id,
      sourceUrl: page.url,
      acquisitionMethod: context.acquisitionMethod || this.acquisitionMethod,
      fetchedAt: context.crawlStartedAt,
      contentHash: `hash_page_${index + 1}_deterministic`,
      contentType: 'application/json',
      rawContent: JSON.stringify(page),
      httpStatus: 200,
      parserVersion: this.parserVersion,
    }));
  }

  async parse(rawIngests: RawIngest[]): Promise<EventCandidate[]> {
    const candidates: EventCandidate[] = [];

    for (const raw of rawIngests) {
      const parsed = JSON.parse(raw.rawContent || '{}') as RawPagePayload;

      for (const evt of parsed.events) {
        const provenance: SourceProvenance = {
          sourceId: raw.sourceId,
          sourceType: this.sourceType,
          acquisitionMethod: raw.acquisitionMethod,
          sourceUrl: raw.sourceUrl,
          sourceEventId: evt.id,
          rawIngestId: raw.id,
          fetchedAt: raw.fetchedAt,
          contentHash: raw.contentHash,
          parserVersion: raw.parserVersion,
          confidence: 0.95,
        };

        const candidate: EventCandidate = {
          id: `candidate_${evt.id}`,
          provenance,
          title: evt.name,
          artistNames: evt.artists,
          venueName: evt.venue,
          city: evt.city,
          state: evt.state,
          country: evt.country,
          timezone: evt.timezone,
          startsAt: evt.startsAt,
          endsAt: evt.endsAt,
          doorsOpenAt: evt.doorsOpenAt,
          ticketUrl: evt.ticketUrl,
          price: evt.price,
          isFestival: evt.isFestival ?? false,
          performances: evt.billing?.map((b) => ({
            artistName: b.artistName,
            billingPosition: b.billingPosition ?? 'unknown',
            stage: b.stage,
          })),
          confidence: 0.95,
          verificationStatus: 'unverified',
          rawPayload: { originalId: evt.id },
        };

        candidates.push(candidate);
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
