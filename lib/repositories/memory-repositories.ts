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
  CanonicalizationPayload,
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
import { normalizeName, normalizeUrl } from '@/lib/domain/value-objects';
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
    const existing = await this.getBySourceAndContentHash(
      ingest.sourceId,
      ingest.contentHash,
    );
    if (existing) {
      return existing;
    }

    const id = `raw_${Math.random().toString(36).substring(2, 11)}`;
    const record: RawIngest & { id: string } = {
      ...ingest,
      id,
    };
    this.ingests.set(id, record);
    return record;
  }

  async getBySourceAndContentHash(
    sourceId: string,
    contentHash: string,
  ): Promise<(RawIngest & { id: string }) | null> {
    for (const item of this.ingests.values()) {
      if (item.sourceId === sourceId && item.contentHash === contentHash) {
        return item;
      }
    }
    return null;
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
  private candidates: Map<
    string,
    EventCandidate & { id: string; rawIngestId: string; sourceId: string }
  > = new Map();

  async create(
    candidate: EventCandidate & { rawIngestId: string; sourceId: string },
  ): Promise<
    EventCandidate & { id: string; rawIngestId: string; sourceId: string }
  > {
    const sourceEventId =
      candidate.sourceEventId ?? candidate.provenance?.sourceEventId;
    if (sourceEventId) {
      const existing = await this.getBySourceEventId(
        candidate.sourceId,
        sourceEventId,
      );
      if (existing) {
        const updated: EventCandidate & {
          id: string;
          rawIngestId: string;
          sourceId: string;
        } = {
          ...existing,
          ...candidate,
          id: existing.id,
        };
        this.candidates.set(existing.id, updated);
        return updated;
      }
    }

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

  async getById(
    id: string,
  ): Promise<
    | (EventCandidate & { id: string; rawIngestId: string; sourceId: string })
    | null
  > {
    return this.candidates.get(id) ?? null;
  }

  async getByRawIngestId(
    rawIngestId: string,
  ): Promise<
    Array<
      EventCandidate & { id: string; rawIngestId: string; sourceId: string }
    >
  > {
    return Array.from(this.candidates.values()).filter(
      (c) => c.rawIngestId === rawIngestId,
    );
  }

  async getBySourceEventId(
    sourceId: string,
    sourceEventId: string,
  ): Promise<
    | (EventCandidate & { id: string; rawIngestId: string; sourceId: string })
    | null
  > {
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
        const a = this.artists.get(ea.artistId);
        artists.push({
          id: ea.artistId,
          name: a?.name ?? 'Unknown Artist',
          billingPosition: ea.billingPosition,
        });
      }
    }

    const ticketLinks: EventTicketLink[] = [];
    for (const tl of this.eventTicketLinks.values()) {
      if (tl.eventId === id) ticketLinks.push(tl);
    }

    const promoters: Array<{
      id: string;
      name: string;
      relationshipType: PromoterRelationshipType;
    }> = [];
    for (const ep of this.eventPromoters.values()) {
      if (ep.eventId === id) {
        const p = this.promoters.get(ep.promoterId);
        promoters.push({
          id: ep.promoterId,
          name: p?.name ?? 'Unknown Promoter',
          relationshipType: ep.relationshipType,
        });
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

    const fieldEvidence: EventFieldEvidence[] = [];
    for (const fe of this.eventFieldEvidence.values()) {
      if (fe.eventId === id) fieldEvidence.push(fe);
    }

    return {
      ...event,
      artists,
      venue: venue
        ? {
            id: venue.id,
            name: venue.name,
            city: venue.city,
            region: venue.region,
          }
        : null,
      ticketLinks,
      promoters,
      sources,
      fieldEvidence,
    };
  }

  async listEvents(
    filters?: EventListFilters,
  ): Promise<CanonicalEventSummary[]> {
    let result = Array.from(this.events.values());

    if (filters?.fromDate) {
      result = result.filter((e) => e.localStartDate >= filters.fromDate!);
    }
    if (filters?.toDate) {
      result = result.filter((e) => e.localStartDate <= filters.toDate!);
    }
    if (filters?.venueId) {
      result = result.filter((e) => e.venueId === filters.venueId);
    }
    if (filters?.city) {
      const c = filters.city.toLowerCase();
      result = result.filter((e) => e.city?.toLowerCase().includes(c));
    }
    if (filters?.region) {
      result = result.filter((e) => e.region === filters.region);
    }
    if (filters?.artistId) {
      // Finding 11: filter by artistId
      const matchingEventIds = new Set<string>();
      for (const ea of this.eventArtists.values()) {
        if (ea.artistId === filters.artistId) {
          matchingEventIds.add(ea.eventId);
        }
      }
      result = result.filter((e) => matchingEventIds.has(e.id));
    }

    result.sort((a, b) => a.localStartDate.localeCompare(b.localStartDate));

    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? 50;
    const paged = result.slice(offset, offset + limit);

    return paged.map((event) => {
      const venue = event.venueId ? this.venues.get(event.venueId) : null;
      const artists: Array<{ name: string; billingPosition: BillingPosition }> =
        [];
      for (const ea of this.eventArtists.values()) {
        if (ea.eventId === event.id) {
          const a = this.artists.get(ea.artistId);
          artists.push({
            name: a?.name ?? 'Unknown Artist',
            billingPosition: ea.billingPosition,
          });
        }
      }

      let minPrice: number | null = null;
      let maxPrice: number | null = null;
      let currency: string | null = null;

      for (const tl of this.eventTicketLinks.values()) {
        if (tl.eventId === event.id) {
          if (tl.minPrice !== null && tl.minPrice !== undefined) {
            minPrice =
              minPrice === null ? tl.minPrice : Math.min(minPrice, tl.minPrice);
          }
          if (tl.maxPrice !== null && tl.maxPrice !== undefined) {
            maxPrice =
              maxPrice === null ? tl.maxPrice : Math.max(maxPrice, tl.maxPrice);
          }
          if (tl.currency) currency = tl.currency;
        }
      }

      return {
        id: event.id,
        title: event.name,
        venueName: venue?.name ?? event.name,
        city: venue?.city ?? event.city ?? undefined,
        region: venue?.region ?? event.region ?? undefined,
        localStartDate: event.localStartDate,
        startsAt: event.startsAt,
        timezone: event.timezone,
        startTimePrecision: event.startTimePrecision,
        status: event.status,
        artists,
        ticketUrl: event.primaryTicketUrl,
        minPrice,
        maxPrice,
        currency,
      };
    });
  }

  async findArtistByName(normalizedName: string): Promise<Artist | null> {
    for (const artist of this.artists.values()) {
      if (artist.normalizedName === normalizedName) return artist;
    }
    return null;
  }

  async findArtistsByName(normalizedName: string): Promise<Artist[]> {
    const results: Artist[] = [];
    for (const artist of this.artists.values()) {
      if (artist.normalizedName === normalizedName) results.push(artist);
    }
    return results;
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

  async findArtistExternalIds(artistId: string): Promise<ArtistExternalId[]> {
    const results: ArtistExternalId[] = [];
    for (const ext of this.artistExternalIds.values()) {
      if (ext.artistId === artistId) results.push(ext);
    }
    return results;
  }

  async findVenueByNameAndCity(
    normalizedName: string,
    city: string,
  ): Promise<Venue | null> {
    const normCity = city.toLowerCase().trim();
    for (const venue of this.venues.values()) {
      if (
        venue.normalizedName === normalizedName &&
        venue.city.toLowerCase().trim() === normCity
      ) {
        return venue;
      }
    }
    return null;
  }

  async findVenue(
    normalizedName: string,
    city: string,
    region?: string | null,
    countryCode?: string | null,
  ): Promise<Venue | null> {
    const normCity = city.toLowerCase().trim();
    for (const venue of this.venues.values()) {
      if (
        venue.normalizedName === normalizedName &&
        venue.city.toLowerCase().trim() === normCity
      ) {
        if (
          region &&
          venue.region &&
          venue.region.toLowerCase().trim() !== region.toLowerCase().trim()
        ) {
          continue;
        }
        if (
          countryCode &&
          venue.countryCode &&
          venue.countryCode.toLowerCase().trim() !==
            countryCode.toLowerCase().trim()
        ) {
          continue;
        }
        return venue;
      }
    }
    return null;
  }

  async findEventsOnDateAtVenue(
    localStartDate: string,
    venueId: string,
  ): Promise<Event[]> {
    return Array.from(this.events.values()).filter(
      (e) => e.localStartDate === localStartDate && e.venueId === venueId,
    );
  }

  async findEventByTicketUrl(
    normalizedTicketUrl: string,
  ): Promise<Event | null> {
    for (const link of this.eventTicketLinks.values()) {
      if (link.normalizedUrl === normalizedTicketUrl) {
        return this.events.get(link.eventId) ?? null;
      }
    }
    return null;
  }

  async findEventBySourceEventId(
    sourceId: string,
    sourceEventId: string,
  ): Promise<Event | null> {
    for (const link of this.eventSources.values()) {
      if (link.sourceId === sourceId && link.sourceEventId === sourceEventId) {
        return this.events.get(link.eventId) ?? null;
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
    const created: Artist = {
      id,
      name: artist.name,
      normalizedName: artist.normalizedName,
      imageUrl: artist.imageUrl ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.artists.set(id, created);
    return created;
  }

  async addArtistExternalId(externalId: {
    artistId: string;
    provider: string;
    externalId: string;
    providerUrl?: string | null;
  }): Promise<ArtistExternalId> {
    const id = `aext_${Math.random().toString(36).substring(2, 11)}`;
    const created: ArtistExternalId = {
      id,
      ...externalId,
      createdAt: new Date().toISOString(),
    };
    this.artistExternalIds.set(id, created);
    return created;
  }

  async createVenue(venue: {
    name: string;
    normalizedName: string;
    city: string;
    region?: string | null;
    countryCode?: string | null;
    lat?: number | null;
    lng?: number | null;
    timezone?: string | null;
    website?: string | null;
    capacity?: number | null;
  }): Promise<Venue> {
    const id = `ven_${Math.random().toString(36).substring(2, 11)}`;
    const now = new Date().toISOString();
    const created: Venue = {
      id,
      ...venue,
      countryCode: venue.countryCode ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.venues.set(id, created);
    return created;
  }

  async createPromoter(promoter: {
    name: string;
    normalizedName: string;
    website?: string | null;
    calendarUrl?: string | null;
  }): Promise<Promoter> {
    const id = `pro_${Math.random().toString(36).substring(2, 11)}`;
    const now = new Date().toISOString();
    const created: Promoter = {
      id,
      ...promoter,
      createdAt: now,
      updatedAt: now,
    };
    this.promoters.set(id, created);
    return created;
  }

  async createEvent(
    event: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Event> {
    const id = `evt_${Math.random().toString(36).substring(2, 11)}`;
    const now = new Date().toISOString();
    const created: Event = {
      id,
      ...event,
      countryCode: event.countryCode ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.events.set(id, created);
    return created;
  }

  async updateEvent(
    id: string,
    updates: Partial<Omit<Event, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Event> {
    const existing = this.events.get(id);
    if (!existing) throw new Error(`Event not found: ${id}`);
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
    const key = `${eventId}_${artistId}`;
    const link: EventArtist = {
      id: `ea_${Math.random().toString(36).substring(2, 11)}`,
      eventId,
      artistId,
      billingPosition,
      sortOrder,
      createdAt: new Date().toISOString(),
    };
    this.eventArtists.set(key, link);
    return link;
  }

  async linkEventPromoter(
    eventId: string,
    promoterId: string,
    relationshipType: PromoterRelationshipType = 'promoter',
  ): Promise<EventPromoter> {
    const key = `${eventId}_${promoterId}`;
    const link: EventPromoter = {
      id: `ep_${Math.random().toString(36).substring(2, 11)}`,
      eventId,
      promoterId,
      relationshipType,
      createdAt: new Date().toISOString(),
    };
    this.eventPromoters.set(key, link);
    return link;
  }

  async linkTicketUrl(ticketLink: {
    eventId: string;
    ticketProviderSourceId?: string | null;
    url: string;
    normalizedUrl: string;
    minPrice?: number | null;
    maxPrice?: number | null;
    currency?: string | null;
    inventoryStatus?: EventTicketLink['inventoryStatus'];
    verifiedAt?: string | null;
  }): Promise<EventTicketLink> {
    const key = `${ticketLink.eventId}_${ticketLink.normalizedUrl}`;
    const link: EventTicketLink = {
      id: `tl_${Math.random().toString(36).substring(2, 11)}`,
      ...ticketLink,
      inventoryStatus: ticketLink.inventoryStatus ?? 'available',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.eventTicketLinks.set(key, link);
    return link;
  }

  async recordEventSource(sourceRecord: {
    eventId: string;
    sourceId: string;
    candidateId?: string | null;
    rawIngestId?: string | null;
    sourceEventId?: string | null;
    sourceUrl: string;
    confidence: number;
  }): Promise<EventSourceRecord> {
    const key = `${sourceRecord.eventId}_${sourceRecord.sourceId}_${sourceRecord.sourceEventId ?? ''}`;
    const existing = this.eventSources.get(key);
    const now = new Date().toISOString();
    const record: EventSourceRecord = {
      id: existing?.id ?? `es_${Math.random().toString(36).substring(2, 11)}`,
      ...sourceRecord,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      isCurrent: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.eventSources.set(key, record);
    return record;
  }

  async recordFieldEvidence(evidence: {
    eventId: string;
    fieldName: string;
    eventSourceId?: string;
    sourceId: string;
    rawIngestId?: string | null;
    candidateId?: string | null;
    observedValue: unknown;
    valueHash: string;
    confidence: number;
    observedAt: string;
    parserVersion: string;
  }): Promise<EventFieldEvidence> {
    const id = `fe_${Math.random().toString(36).substring(2, 11)}`;
    const record: EventFieldEvidence = {
      id,
      ...evidence,
      createdAt: new Date().toISOString(),
    };
    this.eventFieldEvidence.set(id, record);
    return record;
  }

  async recordResolution(resolution: {
    eventCandidateId: string;
    eventId?: string | null;
    status: CandidateResolution['status'];
    matcherVersion: string;
    confidence: number;
    reasons: Record<string, unknown> | string[];
  }): Promise<CandidateResolution> {
    const id = `cr_${Math.random().toString(36).substring(2, 11)}`;
    const record: CandidateResolution = {
      id,
      ...resolution,
      resolvedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.candidateResolutions.set(id, record);
    return record;
  }

  /**
   * Atomic canonicalization transaction execution.
   * If any step fails, entire batch is rolled back cleanly.
   */
  async applyCanonicalization(
    payload: CanonicalizationPayload,
  ): Promise<{ eventId: string | null; status: string }> {
    // Snapshot full state for atomic rollback
    const snapArtists = new Map(this.artists);
    const snapArtistExternalIds = new Map(this.artistExternalIds);
    const snapVenues = new Map(this.venues);
    const snapEvents = new Map(this.events);
    const snapEventArtists = new Map(this.eventArtists);
    const snapEventTicketLinks = new Map(this.eventTicketLinks);
    const snapEventSources = new Map(this.eventSources);
    const snapEventFieldEvidence = new Map(this.eventFieldEvidence);
    const snapCandidateResolutions = new Map(this.candidateResolutions);

    try {
      let eventId: string | null = null;
      let createdVenueId: string | null = null;

      // 1. Create venue if specified in transaction payload
      if (payload.venueToCreate) {
        createdVenueId =
          payload.venueToCreate.id ??
          `ven_${Math.random().toString(36).substring(2, 11)}`;
        const vNow = new Date().toISOString();
        this.venues.set(createdVenueId, {
          id: createdVenueId,
          name: payload.venueToCreate.name,
          normalizedName: payload.venueToCreate.normalized_name,
          city: payload.venueToCreate.city,
          region: payload.venueToCreate.region ?? null,
          countryCode: payload.venueToCreate.country_code ?? null,
          timezone: payload.venueToCreate.timezone ?? null,
          website: payload.venueToCreate.website ?? null,
          createdAt: vNow,
          updatedAt: vNow,
        });
      }

      if (payload.event) {
        const venueIdToUse = payload.event.venue_id ?? createdVenueId ?? null;

        if (payload.event.id) {
          eventId = payload.event.id;
          const existing = this.events.get(eventId);
          if (existing) {
            this.events.set(eventId, {
              ...existing,
              ...payload.event,
              id: eventId,
              name: payload.event.name ?? existing.name,
              normalizedName:
                payload.event.normalized_name ?? existing.normalizedName,
              eventKind: payload.event.event_kind ?? existing.eventKind,
              status: payload.event.status ?? existing.status,
              venueId:
                venueIdToUse !== undefined ? venueIdToUse : existing.venueId,
              city:
                payload.event.city !== undefined
                  ? payload.event.city
                  : existing.city,
              region:
                payload.event.region !== undefined
                  ? payload.event.region
                  : existing.region,
              timezone: payload.event.timezone ?? existing.timezone,
              localStartDate:
                payload.event.local_start_date ?? existing.localStartDate,
              localEndDate:
                payload.event.local_end_date !== undefined
                  ? payload.event.local_end_date
                  : existing.localEndDate,
              startsAt:
                payload.event.starts_at !== undefined
                  ? payload.event.starts_at
                  : existing.startsAt,
              endsAt:
                payload.event.ends_at !== undefined
                  ? payload.event.ends_at
                  : existing.endsAt,
              startTimePrecision:
                payload.event.start_time_precision ??
                existing.startTimePrecision,
              doorsAt:
                payload.event.doors_at !== undefined
                  ? payload.event.doors_at
                  : existing.doorsAt,
              isMultiDay: payload.event.is_multi_day ?? existing.isMultiDay,
              officialUrl:
                payload.event.official_url !== undefined
                  ? payload.event.official_url
                  : existing.officialUrl,
              primaryTicketUrl:
                payload.event.primary_ticket_url !== undefined
                  ? payload.event.primary_ticket_url
                  : existing.primaryTicketUrl,
              updatedAt: new Date().toISOString(),
            });
          }
        } else {
          eventId = `evt_${Math.random().toString(36).substring(2, 11)}`;
          const now = new Date().toISOString();
          const created: Event = {
            id: eventId,
            name: payload.event.name ?? 'Untitled Event',
            normalizedName: payload.event.normalized_name ?? 'untitled event',
            eventKind: payload.event.event_kind ?? 'concert',
            status: payload.event.status ?? 'scheduled',
            venueId: venueIdToUse,
            city: payload.event.city ?? null,
            region: payload.event.region ?? null,
            countryCode: payload.event.country_code ?? null,
            timezone: payload.event.timezone ?? 'UTC',
            localStartDate:
              payload.event.local_start_date ??
              new Date().toISOString().substring(0, 10),
            localEndDate: payload.event.local_end_date ?? null,
            startsAt: payload.event.starts_at ?? null,
            endsAt: payload.event.ends_at ?? null,
            startTimePrecision: payload.event.start_time_precision ?? 'instant',
            doorsAt: payload.event.doors_at ?? null,
            isMultiDay: payload.event.is_multi_day ?? false,
            officialUrl: payload.event.official_url ?? null,
            primaryTicketUrl: payload.event.primary_ticket_url ?? null,
            announcedAt: null,
            createdAt: now,
            updatedAt: now,
          };
          this.events.set(eventId, created);
        }

        // 2. Artists (link existing or create new inside the transaction)
        if (payload.artists) {
          for (const a of payload.artists) {
            let artistId = a.artist_id;
            if (a.name && (!artistId || !this.artists.has(artistId))) {
              artistId =
                artistId ??
                `art_${Math.random().toString(36).substring(2, 11)}`;
              const artNow = new Date().toISOString();
              this.artists.set(artistId, {
                id: artistId,
                name: a.name,
                normalizedName: a.normalized_name ?? normalizeName(a.name),
                createdAt: artNow,
                updatedAt: artNow,
              });
              if (a.external_ids) {
                for (const ext of a.external_ids) {
                  const extId = `aext_${Math.random().toString(36).substring(2, 11)}`;
                  this.artistExternalIds.set(extId, {
                    id: extId,
                    artistId,
                    provider: ext.provider,
                    externalId: ext.external_id,
                    providerUrl: ext.provider_url,
                    createdAt: artNow,
                  });
                }
              }
            }
            if (artistId) {
              await this.linkEventArtist(
                eventId,
                artistId,
                a.billing_position,
                a.sort_order,
              );
            }
          }
        }

        // Ticket links
        if (payload.ticketLinks) {
          for (const tl of payload.ticketLinks) {
            await this.linkTicketUrl({
              eventId,
              ticketProviderSourceId: tl.ticket_provider_source_id,
              url: tl.url,
              normalizedUrl: tl.normalized_url || normalizeUrl(tl.url),
              minPrice: tl.min_price,
              maxPrice: tl.max_price,
              currency: tl.currency,
              inventoryStatus: tl.inventory_status,
              verifiedAt: tl.verified_at,
            });
          }
        }

        // Source record
        if (payload.source) {
          await this.recordEventSource({
            eventId,
            sourceId: payload.source.source_id,
            candidateId: payload.source.candidate_id,
            rawIngestId: payload.source.raw_ingest_id,
            sourceEventId: payload.source.source_event_id,
            sourceUrl: payload.source.source_url,
            confidence: payload.source.confidence ?? 0.8,
          });
        }

        // Field Evidence
        if (payload.evidence) {
          for (const ev of payload.evidence) {
            await this.recordFieldEvidence({
              eventId,
              fieldName: ev.field_name,
              sourceId: ev.source_id,
              rawIngestId: ev.raw_ingest_id,
              candidateId: ev.candidate_id,
              observedValue: ev.observed_value,
              valueHash: ev.value_hash ?? 'hash',
              confidence: ev.confidence ?? 0.8,
              observedAt: ev.observed_at ?? new Date().toISOString(),
              parserVersion: ev.parser_version ?? '1.0.0',
            });
          }
        }
      }

      // Resolution
      if (payload.resolution) {
        await this.recordResolution({
          eventCandidateId: payload.resolution.event_candidate_id,
          eventId,
          status: payload.resolution.status,
          matcherVersion: payload.resolution.matcher_version ?? '1.0.0',
          confidence: payload.resolution.confidence,
          reasons: payload.resolution.reasons,
        });
      }

      return {
        eventId,
        status: payload.resolution?.status ?? 'created',
      };
    } catch (err) {
      // Rollback EVERYTHING on any failure
      this.artists = snapArtists;
      this.artistExternalIds = snapArtistExternalIds;
      this.venues = snapVenues;
      this.events = snapEvents;
      this.eventArtists = snapEventArtists;
      this.eventTicketLinks = snapEventTicketLinks;
      this.eventSources = snapEventSources;
      this.eventFieldEvidence = snapEventFieldEvidence;
      this.candidateResolutions = snapCandidateResolutions;
      throw err;
    }
  }
}
