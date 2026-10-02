import type {
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
  festivalDetails?: {
    daysCount?: number;
    lineupByDay?: Record<string, string[]>;
  };
  billing?: Array<{
    artistName: string;
    billingPosition?:
      'headliner' | 'subheadliner' | 'mid_card' | 'support' | 'unknown';
    stage?: string;
  }>;
}

export class FakeVenueSourceAdapter implements EventSourceAdapter {
  readonly name = 'fake-venue-adapter';
  readonly sourceType: SourceType = 'venue';
  readonly parserVersion = '1.0.0';

  private readonly inMemoryPayload: string;

  constructor(payload?: object) {
    this.inMemoryPayload = JSON.stringify(payload ?? fixtureData);
  }

  async fetchRaw(context: CrawlContext): Promise<RawIngest> {
    return {
      sourceId: context.sourceId,
      sourceUrl: context.targetUrl,
      fetchedAt: context.crawlStartedAt,
      contentHash: 'hash_test_deterministic_123',
      contentType: 'application/json',
      rawContent: this.inMemoryPayload,
      httpStatus: 200,
      parserVersion: this.parserVersion,
    };
  }

  async parseCandidates(raw: RawIngest): Promise<EventCandidate[]> {
    const parsed = JSON.parse(raw.rawContent) as { events: RawEventPayload[] };

    return parsed.events.map((evt) => {
      const provenance: SourceProvenance = {
        sourceId: raw.sourceId,
        sourceType: this.sourceType,
        sourceUrl: raw.sourceUrl,
        sourceEventId: evt.id,
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
        festivalDetails: evt.festivalDetails,
        performances: evt.billing?.map((b) => ({
          artistName: b.artistName,
          billingPosition: b.billingPosition ?? 'unknown',
          stage: b.stage,
        })),
        confidence: 0.95,
        verificationStatus: 'unverified',
        rawPayload: { originalId: evt.id },
      };

      return candidate;
    });
  }

  async crawl(
    context: CrawlContext,
  ): Promise<{ raw: RawIngest; candidates: EventCandidate[] }> {
    const raw = await this.fetchRaw(context);
    const candidates = await this.parseCandidates(raw);
    return { raw, candidates };
  }
}
