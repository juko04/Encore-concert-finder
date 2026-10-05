/**
 * In-memory repository implementations for unit testing and offline development.
 */

import type {
  Artist,
  ArtistExternalId,
  BillingPosition,
  CandidateResolution,
  CanonicalEventDetail,
  CanonicalEventSummary,
  Event,
  EventArtist,
  EventFieldEvidence,
  EventPromoter,
  EventSourceRecord,
  EventTicketLink,
  Promoter,
  PromoterRelationshipType,
  Venue,
} from '@/lib/domain/catalog';
import type { EventCandidate } from '@/lib/domain/event-candidate';
import type { RawIngest, Source } from '@/lib/domain/source';
import type {
  EventListFilters,
  ICatalogRepository,
  IEventCandidateRepository,
  IRawIngestRepository,
  ISourceRepository,
} from './interfaces';

export class MemorySourceRepository implements ISourceRepository {
  private sources: Map<string, Source> = new Map();

  async getById(id: string): Promise<Source | null> {
    return this.sources.get(id) ?? null;
  }

  async getBySlug(slug: string): Promise<Source | null> {
    for (const source of this.sources.values()) {
      if (source.slug === slug) return source;
    }
    return null;
  }

  async listActive(): Promise<Source[]> {
    return Array.from(this.sources.values()).filter((s) => s.active);
  }

  async upsert(
    source: Omit<Source, 'createdAt' | 'updatedAt'>,
  ): Promise<Source> {
    const existing = this.sources.get(source.id);
    const now = new Date().toISOString();
    const updated: Source = {
      ...source,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.sources.set(source.id, updated);
    return updated;
  }

  async recordFailure(id: string): Promise<void> {
    const source = this.sources.get(id);
    if (source) {
      source.consecutiveFailures += 1;
      source.updatedAt = new Date().toISOString();
    }
  }

  async recordSuccess(id: string, lastFetchedAt?: string): Promise<void> {
    const source = this.sources.get(id);
    if (source) {
      source.consecutiveFailures = 0;
      source.lastFetchedAt = lastFetchedAt ?? new Date().toISOString();
      source.updatedAt = new Date().toISOString();
    }
  }
}

export class MemoryRawIngestRepository implements IRawIngestRepository {
  private ingests: Map<string, RawIngest & { id: string }> = new Map();

  async create(
    ingest: Omit<RawIngest, 'id'>,
  ): Promise<RawIngest & { id: string }> {
    const id = `raw_${Math.random().toString(36).substring(2, 11)}`;
    const record: RawIngest & { id: string } = {
      ...ingest,
      id,
    };
    this.ingests.set(id, record);
    return record;
  }

  async getByContentHash(
    contentHash: string,
  ): Promise<(RawIngest & { id: string }) | null> {
    for (const item of this.ingests.values()) {
      if (item.contentHash === contentHash) return item;
    }
    return null;
  }

  async getById(id: string): Promise<(RawIngest & { id: string }) | null> {
    return this.ingests.get(id) ?? null;
  }

  async listBySource(
    sourceId: string,
    limit = 50,
  ): Promise<Array<RawIngest & { id: string }>> {
    return Array.from(this.ingests.values())
      .filter((i) => i.sourceId === sourceId)
      .slice(0, limit);
  }
}

export class MemoryEventCandidateRepository implements IEventCandidateRepository {
  private candidates: Map<string, EventCandidate & { id: string }> = new Map();

  async create(
    candidate: EventCandidate & { rawIngestId: string; sourceId: string },
  ): Promise<
    EventCandidate & { id: string; rawIngestId: string; sourceId: string }
  > {
    const id =
      candidate.id ??
      `candidate_${Math.random().toString(36).substring(2, 11)}`;
    const record: EventCandidate & {
      id: string;
      rawIngestId: string;
      sourceId: string;
    } = {
      ...candidate,
      id,
    };
    this.candidates.set(id, record);
    return record;
  }

  async createMany(
    candidates: Array<
      EventCandidate & { rawIngestId: string; sourceId: string }
    >,
  ): Promise<
    Array<
      EventCandidate & { id: string; rawIngestId: string; sourceId: string }
    >
  > {
    const results: Array<
      EventCandidate & { id: string; rawIngestId: string; sourceId: string }
    > = [];
    for (const c of candidates) {
      results.push(await this.create(c));
    }
    return results;
  }

  async getById(id: string): Promise<(EventCandidate & { id: string }) | null> {
    return this.candidates.get(id) ?? null;
  }

  async getByRawIngestId(
    rawIngestId: string,
  ): Promise<Array<EventCandidate & { id: string }>> {
    return Array.from(this.candidates.values()).filter(
      (c) => c.rawIngestId === rawIngestId,
    );
  }

  async getBySourceEventId(
    sourceId: string,
    sourceEventId: string,
  ): Promise<(EventCandidate & { id: string }) | null> {
    for (const c of this.candidates.values()) {
      if (c.sourceId === sourceId && c.sourceEventId === sourceEventId) {
        return c;
      }
    }
    return null;
  }
}

export class MemoryCatalogRepository implements ICatalogRepository {
  public artists: Map<string, Artist> = new Map();
  public artistExternalIds: Map<string, ArtistExternalId> = new Map();
  public venues: Map<string, Venue> = new Map();
  public promoters: Map<string, Promoter> = new Map();
  public events: Map<string, Event> = new Map();
  public eventArtists: Map<string, EventArtist> = new Map();
  public eventPromoters: Map<string, EventPromoter> = new Map();
  public eventTicketLinks: Map<string, EventTicketLink> = new Map();
  public eventSources: Map<string, EventSourceRecord> = new Map();
  public eventFieldEvidence: Map<string, EventFieldEvidence> = new Map();
  public candidateResolutions: Map<string, CandidateResolution> = new Map();

  async getEventById(id: string): Promise<CanonicalEventDetail | null> {
    const event = this.events.get(id);
    if (!event) return null;

    const venue = event.venueId
      ? (this.venues.get(event.venueId) ?? null)
      : null;
    const artists: Array<{
      id: string;
      name: string;
      billingPosition: BillingPosition;
    }> = [];

    for (const ea of this.eventArtists.values()) {
      if (ea.eventId === id) {
        const artist = this.artists.get(ea.artistId);
        if (artist) {
          artists.push({
            id: artist.id,
            name: artist.name,
            billingPosition: ea.billingPosition,
          });
        }
      }
    }

    const ticketLinks: EventTicketLink[] = [];
    for (const tl of this.eventTicketLinks.values()) {
      if (tl.eventId === id) {
        ticketLinks.push(tl);
      }
    }

    const promoters: Array<{
      id: string;
      name: string;
      relationshipType: PromoterRelationshipType;
    }> = [];
    for (const ep of this.eventPromoters.values()) {
      if (ep.eventId === id) {
        const promoter = this.promoters.get(ep.promoterId);
        if (promoter) {
          promoters.push({
            id: promoter.id,
            name: promoter.name,
            relationshipType: ep.relationshipType,
          });
        }
      }
    }

    const sources: Array<{
      sourceId: string;
      sourceUrl: string;
      confidence: number;
    }> = [];
    for (const es of this.eventSources.values()) {
      if (es.eventId === id) {
        sources.push({
          sourceId: es.sourceId,
          sourceUrl: es.sourceUrl,
          confidence: es.confidence,
        });
      }
    }

    const minPrice = ticketLinks.reduce<number | null>((min, tl) => {
      if (tl.minPrice === null || tl.minPrice === undefined) return min;
      return min === null ? tl.minPrice : Math.min(min, tl.minPrice);
    }, null);

    const maxPrice = ticketLinks.reduce<number | null>((max, tl) => {
      if (tl.maxPrice === null || tl.maxPrice === undefined) return max;
      return max === null ? tl.maxPrice : Math.max(max, tl.maxPrice);
    }, null);

    const currency = ticketLinks.find((tl) => tl.currency)?.currency ?? null;

    return {
      id: event.id,
      name: event.name,
      eventKind: event.eventKind,
      status: event.status,
      venue: venue
        ? {
            id: venue.id,
            name: venue.name,
            city: venue.city,
            region: venue.region,
          }
        : null,
      artists,
      localStartDate: event.localStartDate,
      localEndDate: event.localEndDate,
      startsAt: event.startsAt,
      timezone: event.timezone,
      startTimePrecision: event.startTimePrecision,
      isMultiDay: event.isMultiDay,
      minPrice,
      maxPrice,
      currency,
      primaryTicketUrl: event.primaryTicketUrl,
      sources,
      ticketLinks,
      promoters,
      officialUrl: event.officialUrl,
      doorsAt: event.doorsAt,
      endsAt: event.endsAt,
    };
  }

  async listEvents(
    filters?: EventListFilters,
  ): Promise<CanonicalEventSummary[]> {
    const results: CanonicalEventSummary[] = [];

    for (const event of this.events.values()) {
      if (filters?.fromDate && event.localStartDate < filters.fromDate)
        continue;
      if (filters?.toDate && event.localStartDate > filters.toDate) continue;
      if (filters?.venueId && event.venueId !== filters.venueId) continue;

      const detail = await this.getEventById(event.id);
      if (detail) {
        results.push({
          id: detail.id,
          name: detail.name,
          eventKind: detail.eventKind,
          status: detail.status,
          venue: detail.venue,
          artists: detail.artists,
          localStartDate: detail.localStartDate,
          localEndDate: detail.localEndDate,
          startsAt: detail.startsAt,
          timezone: detail.timezone,
          startTimePrecision: detail.startTimePrecision,
          isMultiDay: detail.isMultiDay,
          minPrice: detail.minPrice,
          maxPrice: detail.maxPrice,
          currency: detail.currency,
          primaryTicketUrl: detail.primaryTicketUrl,
          sources: detail.sources,
        });
      }
    }

    return results;
  }

  async findArtistByName(normalizedName: string): Promise<Artist | null> {
    for (const artist of this.artists.values()) {
      if (artist.normalizedName === normalizedName) return artist;
    }
    return null;
  }

  async findArtistByExternalId(
    provider: string,
    externalId: string,
  ): Promise<Artist | null> {
    for (const ext of this.artistExternalIds.values()) {
      if (ext.provider === provider && ext.externalId === externalId) {
        return this.artists.get(ext.artistId) ?? null;
      }
    }
    return null;
  }

  async findVenueByNameAndCity(
    normalizedName: string,
    city: string,
  ): Promise<Venue | null> {
    const normCity = city.trim().toLowerCase();
    for (const venue of this.venues.values()) {
      if (
        venue.normalizedName === normalizedName &&
        venue.city.trim().toLowerCase() === normCity
      ) {
        return venue;
      }
    }
    return null;
  }

  async findEventsOnDateAtVenue(
    localStartDate: string,
    venueId: string,
  ): Promise<Event[]> {
    const matches: Event[] = [];
    for (const event of this.events.values()) {
      if (
        event.localStartDate === localStartDate &&
        event.venueId === venueId
      ) {
        matches.push(event);
      }
    }
    return matches;
  }

  async findEventByTicketUrl(
    normalizedTicketUrl: string,
  ): Promise<Event | null> {
    for (const tl of this.eventTicketLinks.values()) {
      if (tl.url === normalizedTicketUrl) {
        return this.events.get(tl.eventId) ?? null;
      }
    }
    return null;
  }

  async createArtist(artist: {
    name: string;
    normalizedName: string;
    imageUrl?: string | null;
  }): Promise<Artist> {
    const id = `art_${Math.random().toString(36).substring(2, 11)}`;
    const now = new Date().toISOString();
    const record: Artist = {
      id,
      name: artist.name,
      normalizedName: artist.normalizedName,
      imageUrl: artist.imageUrl ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.artists.set(id, record);
    return record;
  }

  async addArtistExternalId(externalId: {
    artistId: string;
    provider: string;
    externalId: string;
    providerUrl?: string | null;
  }): Promise<ArtistExternalId> {
    const id = `ext_${Math.random().toString(36).substring(2, 11)}`;
    const record: ArtistExternalId = {
      id,
      ...externalId,
      createdAt: new Date().toISOString(),
    };
    this.artistExternalIds.set(id, record);
    return record;
  }

  async createVenue(venue: {
    name: string;
    normalizedName: string;
    city: string;
    region?: string | null;
    countryCode?: string;
    lat?: number | null;
    lng?: number | null;
    timezone?: string | null;
    website?: string | null;
    capacity?: number | null;
  }): Promise<Venue> {
    const id = `ven_${Math.random().toString(36).substring(2, 11)}`;
    const now = new Date().toISOString();
    const record: Venue = {
      id,
      countryCode: venue.countryCode ?? 'US',
      ...venue,
      createdAt: now,
      updatedAt: now,
    };
    this.venues.set(id, record);
    return record;
  }

  async createPromoter(promoter: {
    name: string;
    normalizedName: string;
    website?: string | null;
    calendarUrl?: string | null;
  }): Promise<Promoter> {
    const id = `pro_${Math.random().toString(36).substring(2, 11)}`;
    const now = new Date().toISOString();
    const record: Promoter = {
      id,
      ...promoter,
      createdAt: now,
      updatedAt: now,
    };
    this.promoters.set(id, record);
    return record;
  }

  async createEvent(
    event: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Event> {
    const id = `evt_${Math.random().toString(36).substring(2, 11)}`;
    const now = new Date().toISOString();
    const record: Event = {
      ...event,
      id,
      createdAt: now,
      updatedAt: now,
    };
    this.events.set(id, record);
    return record;
  }

  async updateEvent(
    id: string,
    updates: Partial<Omit<Event, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Event> {
    const existing = this.events.get(id);
    if (!existing) {
      throw new Error(`Event ${id} not found`);
    }
    const updated: Event = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.events.set(id, updated);
    return updated;
  }

  async linkEventArtist(
    eventId: string,
    artistId: string,
    billingPosition: BillingPosition = 'unknown',
    sortOrder = 0,
  ): Promise<EventArtist> {
    const id = `ea_${Math.random().toString(36).substring(2, 11)}`;
    const record: EventArtist = {
      id,
      eventId,
      artistId,
      billingPosition,
      sortOrder,
      createdAt: new Date().toISOString(),
    };
    this.eventArtists.set(id, record);
    return record;
  }

  async linkEventPromoter(
    eventId: string,
    promoterId: string,
    relationshipType: PromoterRelationshipType = 'promoter',
  ): Promise<EventPromoter> {
    const id = `ep_${Math.random().toString(36).substring(2, 11)}`;
    const record: EventPromoter = {
      id,
      eventId,
      promoterId,
      relationshipType,
      createdAt: new Date().toISOString(),
    };
    this.eventPromoters.set(id, record);
    return record;
  }

  async addEventTicketLink(
    link: Omit<EventTicketLink, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<EventTicketLink> {
    const id = `tl_${Math.random().toString(36).substring(2, 11)}`;
    const now = new Date().toISOString();
    const record: EventTicketLink = {
      ...link,
      id,
      createdAt: now,
      updatedAt: now,
    };
    this.eventTicketLinks.set(id, record);
    return record;
  }

  async addEventSource(
    sourceRecord: Omit<EventSourceRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<EventSourceRecord> {
    const id = `es_${Math.random().toString(36).substring(2, 11)}`;
    const now = new Date().toISOString();
    const record: EventSourceRecord = {
      ...sourceRecord,
      id,
      createdAt: now,
      updatedAt: now,
    };
    this.eventSources.set(id, record);
    return record;
  }

  async findEventSource(
    eventId: string,
    sourceId: string,
    sourceEventId?: string | null,
  ): Promise<EventSourceRecord | null> {
    for (const es of this.eventSources.values()) {
      if (
        es.eventId === eventId &&
        es.sourceId === sourceId &&
        (sourceEventId ? es.sourceEventId === sourceEventId : true)
      ) {
        return es;
      }
    }
    return null;
  }

  async updateEventSourceLastSeen(
    id: string,
    lastSeenAt: string,
  ): Promise<void> {
    const record = this.eventSources.get(id);
    if (record) {
      record.lastSeenAt = lastSeenAt;
      record.updatedAt = new Date().toISOString();
    }
  }

  async addEventFieldEvidence(
    evidence: Omit<EventFieldEvidence, 'id' | 'createdAt'>,
  ): Promise<EventFieldEvidence> {
    const id = `efe_${Math.random().toString(36).substring(2, 11)}`;
    const record: EventFieldEvidence = {
      ...evidence,
      id,
      createdAt: new Date().toISOString(),
    };
    this.eventFieldEvidence.set(id, record);
    return record;
  }

  async recordCandidateResolution(
    resolution: Omit<CandidateResolution, 'id' | 'createdAt'>,
  ): Promise<CandidateResolution> {
    const id = `res_${Math.random().toString(36).substring(2, 11)}`;
    const record: CandidateResolution = {
      ...resolution,
      id,
      createdAt: new Date().toISOString(),
    };
    this.candidateResolutions.set(id, record);
    return record;
  }

  async getCandidateResolution(
    candidateId: string,
  ): Promise<CandidateResolution | null> {
    for (const res of this.candidateResolutions.values()) {
      if (res.eventCandidateId === candidateId) {
        return res;
      }
    }
    return null;
  }
}
