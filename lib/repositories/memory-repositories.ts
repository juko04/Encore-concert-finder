/**
 * In-memory repository implementations for unit testing and offline development.
 */

import { groupFestivalDays } from '@/lib/events/festival-groups';
import { isValidCoordinatePair } from '@/lib/location/coordinates';
import {
  eventMatchesGenre,
  genreMatchesQuery,
  normalizeGenreFacets,
  resolveGenreQuery,
} from '@/lib/genres/catalog-genres';
import type {
  Artist,
  ArtistExternalId,
  BillingPosition,
  CandidateResolution,
  CanonicalEventDetail,
  CanonicalEventSourceSummary,
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
  TicketInventoryStatus,
  Venue,
} from '@/lib/domain/catalog';
import type { EventCandidate } from '@/lib/domain/event-candidate';
import type { RawIngest, Source } from '@/lib/domain/source';
import {
  computeCandidateFingerprint,
  normalizeName,
  normalizeUrl,
} from '@/lib/domain/value-objects';
import {
  type CanonicalArtistSummary,
  ConflictingArtistIdentityError,
  InvalidCatalogArtistError,
  type PreferenceLevel,
  type SavePreferenceInput,
  type UserArtistPreference,
  VALID_PREFERENCE_LEVELS,
} from '@/lib/domain/user-preference';
import type {
  RecommendationPreset,
  UserProfile,
  UserProfileUpdateInput,
} from '@/lib/domain/profile';
import type {
  EventListFilters,
  ICatalogRepository,
  IEventCandidateRepository,
  IProfileRepository,
  IRawIngestRepository,
  ISourceRepository,
  ISpotifyConnectionRepository,
  IUserPreferenceRepository,
  SpotifyConnectionTokens,
} from './interfaces';
import {
  type SaveSpotifyConnectionInput,
  type SpotifyConnection,
  type SpotifyConnectionStatus,
  SpotifyAccountConflictError,
  type UpdateSpotifyTokensInput,
} from '@/lib/domain/spotify';
import {
  TICKETMASTER_DEFAULT_SOURCE_ID,
  TICKETMASTER_SOURCE_SLUG,
} from '@/lib/sources/ticketmaster/source-registry';

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
    const existing = await this.getBySourceUrlAndContentHash(
      ingest.sourceId,
      ingest.sourceUrl,
      ingest.contentHash,
    );
    if (existing) {
      return existing;
    }

    const id = crypto.randomUUID();
    const record: RawIngest & { id: string } = {
      ...ingest,
      id,
    };
    this.ingests.set(id, record);
    return record;
  }

  async getBySourceUrlAndContentHash(
    sourceId: string,
    sourceUrl: string,
    contentHash: string,
  ): Promise<(RawIngest & { id: string }) | null> {
    for (const item of this.ingests.values()) {
      if (
        item.sourceId === sourceId &&
        item.sourceUrl === sourceUrl &&
        item.contentHash === contentHash
      ) {
        return item;
      }
    }
    return null;
  }

  async getById(id: string): Promise<(RawIngest & { id: string }) | null> {
    return this.ingests.get(id) ?? null;
  }

  async listBySource(
    sourceId: string,
    limit = 50,
    urlPrefix?: string,
  ): Promise<Array<RawIngest & { id: string }>> {
    return Array.from(this.ingests.values())
      .filter(
        (i) =>
          i.sourceId === sourceId &&
          (!urlPrefix || i.sourceUrl.startsWith(urlPrefix)),
      )
      .sort(
        (a, b) =>
          new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime(),
      )
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
    const fingerprint =
      candidate.candidateFingerprint ??
      computeCandidateFingerprint({
        sourceEventId: candidate.sourceEventId,
        title: candidate.title,
        artistNames: candidate.artistNames,
        venueName: candidate.venueName,
        localStartDate: candidate.localStartDate,
        startsAt: candidate.startsAt,
        ticketUrl: candidate.ticketUrl,
      });

    // Check unique constraints within same raw observation
    for (const existing of this.candidates.values()) {
      if (existing.rawIngestId === candidate.rawIngestId) {
        if (
          candidate.sourceEventId &&
          existing.sourceEventId === candidate.sourceEventId
        ) {
          return existing;
        }
        if (fingerprint && existing.candidateFingerprint === fingerprint) {
          return existing;
        }
      }
    }

    const id = crypto.randomUUID();
    const record: EventCandidate & {
      id: string;
      rawIngestId: string;
      sourceId: string;
    } = {
      ...candidate,
      id,
      startTimePrecision:
        candidate.startTimePrecision ??
        (candidate.startsAt ? 'instant' : 'date_only'),
      candidateFingerprint: fingerprint,
      artists: candidate.artists ? [...candidate.artists] : undefined,
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

  async listBySourceEventId(
    sourceId: string,
    sourceEventId: string,
  ): Promise<
    Array<
      EventCandidate & { id: string; rawIngestId: string; sourceId: string }
    >
  > {
    return Array.from(this.candidates.values()).filter(
      (c) => c.sourceId === sourceId && c.sourceEventId === sourceEventId,
    );
  }

  async getLatestBySourceEventId(
    sourceId: string,
    sourceEventId: string,
  ): Promise<
    | (EventCandidate & { id: string; rawIngestId: string; sourceId: string })
    | null
  > {
    const matches = Array.from(this.candidates.values()).filter(
      (c) => c.sourceId === sourceId && c.sourceEventId === sourceEventId,
    );
    return matches.length > 0 ? matches[matches.length - 1] : null;
  }
}

export class MemoryCatalogRepository implements ICatalogRepository {
  /** Provenance of genres written via fillArtistGenres (test visibility). */
  readonly artistGenreSources = new Map<string, string>();
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
  public sources: Map<string, Source> = new Map();
  public sourceRepo?: ISourceRepository;

  constructor(sourceRepo?: ISourceRepository) {
    this.sourceRepo = sourceRepo;
  }

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
      imageUrl?: string | null;
    }> = [];
    for (const ea of this.eventArtists.values()) {
      if (ea.eventId === id) {
        const a = this.artists.get(ea.artistId);
        artists.push({
          id: ea.artistId,
          name: a?.name ?? 'Unknown Artist',
          billingPosition: ea.billingPosition,
          imageUrl: a?.imageUrl ?? null,
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
            normalizedName: venue.normalizedName,
            city: venue.city,
            region: venue.region,
            imageUrl: venue.imageUrl ?? null,
          }
        : null,
      ticketLinks,
      promoters,
      sources,
      fieldEvidence,
    };
  }

  private getEventMinPrice(eventId: string, eventKind?: string): number | null {
    const event = this.events.get(eventId);
    if (event?.minPrice !== undefined && event?.minPrice !== null) {
      return event.minPrice;
    }
    let min: number | null = null;
    for (const tl of this.eventTicketLinks.values()) {
      if (
        tl.eventId === eventId &&
        tl.minPrice !== null &&
        tl.minPrice !== undefined
      ) {
        min = min === null ? tl.minPrice : Math.min(min, tl.minPrice);
      }
    }
    if (min === null && eventKind === 'free_event') {
      return 0;
    }
    return min;
  }

  /** Mirrors SupabaseCatalogRepository: artist-id filters never collapse festival days. */
  private collapsesFestivalDays(filters?: EventListFilters): boolean {
    return (
      Boolean(filters?.collapseFestivalDays) &&
      !(filters?.artistIds && filters.artistIds.length > 0) &&
      !filters?.artistId
    );
  }

  private getFilteredEvents(filters?: EventListFilters): Event[] {
    let result = Array.from(this.events.values());

    if (this.collapsesFestivalDays(filters)) {
      const hidden = this.hiddenFestivalDayIds;
      result = result.filter((e) => !hidden.has(e.id));
    }

    // A collapsed festival card stays listed while its run is still going (first day past).
    const runningToday = (e: Event, from: string): boolean =>
      this.collapsesFestivalDays(filters) &&
      Boolean(e.festivalGroupEndDate) &&
      e.festivalGroupEndDate! >= from;
    if (filters?.excludePastShowtimes && filters?.fromDate) {
      const today = filters.fromDate;
      const nowIso = filters.referenceNowIso || new Date().toISOString();
      result = result.filter((e) => {
        if (runningToday(e, today)) return true;
        if (e.localStartDate > today) return true;
        if (e.localStartDate === today) {
          if (!e.startsAt) return true;
          return e.startsAt >= nowIso;
        }
        return false;
      });
    } else if (filters?.fromDate) {
      result = result.filter(
        (e) =>
          e.localStartDate >= filters.fromDate! ||
          runningToday(e, filters.fromDate!),
      );
    }
    if (filters?.toDate) {
      result = result.filter((e) => e.localStartDate <= filters.toDate!);
    }
    if (filters?.venueId) {
      result = result.filter((e) => {
        if (e.venueId === filters.venueId) return true;
        const venue = e.venueId ? this.venues.get(e.venueId) : null;
        return (
          venue?.name.toLowerCase().includes(filters.venueId!.toLowerCase()) ??
          false
        );
      });
    }
    if (filters?.venueName) {
      result = result.filter((e) => {
        const venue = e.venueId ? this.venues.get(e.venueId) : null;
        return (
          venue?.name
            .toLowerCase()
            .includes(filters.venueName!.toLowerCase()) ?? false
        );
      });
    }
    if (filters?.genre) {
      const g = filters.genre.toLowerCase();
      result = result.filter(
        (e) =>
          e.eventKind?.toLowerCase().includes(g) ||
          e.name.toLowerCase().includes(g) ||
          eventMatchesGenre(filters.genre, e.genre, e.genres),
      );
    }
    if (filters?.city) {
      const c = filters.city.toLowerCase();
      result = result.filter((e) => e.city?.toLowerCase().includes(c));
    }
    if (filters?.region) {
      result = result.filter((e) => e.region === filters.region);
    }
    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        const sSet = new Set(filters.status);
        result = result.filter((e) => sSet.has(e.status));
      } else {
        result = result.filter((e) => e.status === filters.status);
      }
    }
    if (filters?.searchQuery) {
      const q = filters.searchQuery.trim().toLowerCase();
      if (q) {
        const matchesSearch = (e: Event): boolean => {
          if (e.name.toLowerCase().includes(q)) return true;
          if (resolveGenreQuery(q) && genreMatchesQuery(q, e.genre, e.genres)) {
            return true;
          }
          const venue = e.venueId ? this.venues.get(e.venueId) : null;
          if (venue?.name.toLowerCase().includes(q)) return true;
          for (const ea of this.eventArtists.values()) {
            if (ea.eventId === e.id) {
              const a = this.artists.get(ea.artistId);
              if (a?.name.toLowerCase().includes(q)) return true;
            }
          }
          return false;
        };
        const collapsing = this.collapsesFestivalDays(filters);
        result = result.filter((e) => {
          if (matchesSearch(e)) return true;
          // A collapsed card stands for the whole run: a match on a later day counts.
          return (
            collapsing &&
            (this.festivalMemberIds.get(e.id) ?? []).some((id) => {
              const m = this.events.get(id);
              return m !== undefined && matchesSearch(m);
            })
          );
        });
      }
    }
    if (filters?.artistIds && filters.artistIds.length > 0) {
      const idSet = new Set(filters.artistIds);
      const matchingEventIds = new Set<string>();
      for (const ea of this.eventArtists.values()) {
        if (idSet.has(ea.artistId)) {
          matchingEventIds.add(ea.eventId);
        }
      }
      result = result.filter((e) => matchingEventIds.has(e.id));
    } else if (filters?.artistId) {
      // Finding 11: filter by artistId
      const matchingEventIds = new Set<string>();
      for (const ea of this.eventArtists.values()) {
        if (ea.artistId === filters.artistId) {
          matchingEventIds.add(ea.eventId);
        }
      }
      result = result.filter((e) => matchingEventIds.has(e.id));
    }

    if (filters?.freeOnly) {
      result = result.filter((e) => {
        if (e.eventKind === 'free_event') return true;
        const minP = this.getEventMinPrice(e.id, e.eventKind);
        return minP === 0;
      });
    }

    if (filters?.minPrice !== undefined) {
      result = result.filter((e) => {
        const minP = this.getEventMinPrice(e.id, e.eventKind);
        return minP !== null && minP >= filters.minPrice!;
      });
    }

    if (filters?.maxPrice !== undefined) {
      const includeUnknown = filters.includeUnknownPrice ?? true;
      result = result.filter((e) => {
        if (e.eventKind === 'free_event') return true;
        const minP = this.getEventMinPrice(e.id, e.eventKind);
        if (minP === null) {
          return includeUnknown;
        }
        return minP <= filters.maxPrice!;
      });
    }

    return result;
  }

  async countEvents(filters?: EventListFilters): Promise<number> {
    const events = this.getFilteredEvents(filters);
    return events.length;
  }

  async listEvents(
    filters?: EventListFilters,
  ): Promise<CanonicalEventSummary[]> {
    const result = this.getFilteredEvents(filters);

    const sortBy = filters?.sortBy ?? 'date_asc';
    if (sortBy === 'price_asc') {
      result.sort((a, b) => {
        const priceA = this.getEventMinPrice(a.id, a.eventKind);
        const priceB = this.getEventMinPrice(b.id, b.eventKind);
        const valA = priceA ?? Infinity;
        const valB = priceB ?? Infinity;
        if (valA !== valB) return valA - valB;
        const dateComp = a.localStartDate.localeCompare(b.localStartDate);
        if (dateComp !== 0) return dateComp;
        return a.id.localeCompare(b.id);
      });
    } else if (sortBy === 'price_desc') {
      result.sort((a, b) => {
        const priceA = this.getEventMinPrice(a.id, a.eventKind);
        const priceB = this.getEventMinPrice(b.id, b.eventKind);
        const valA = priceA ?? -Infinity;
        const valB = priceB ?? -Infinity;
        if (valA !== valB) return valB - valA;
        const dateComp = a.localStartDate.localeCompare(b.localStartDate);
        if (dateComp !== 0) return dateComp;
        return a.id.localeCompare(b.id);
      });
    } else if (sortBy === 'date_desc') {
      result.sort(
        (a, b) =>
          b.localStartDate.localeCompare(a.localStartDate) ||
          a.id.localeCompare(b.id),
      );
    } else if (sortBy === 'title_asc') {
      result.sort(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          a.localStartDate.localeCompare(b.localStartDate) ||
          a.id.localeCompare(b.id),
      );
    } else {
      result.sort(
        (a, b) =>
          a.localStartDate.localeCompare(b.localStartDate) ||
          a.id.localeCompare(b.id),
      );
    }

    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? 50;
    const paged = result.slice(offset, offset + limit);

    const summaries: CanonicalEventSummary[] = [];
    const collapsing = this.collapsesFestivalDays(filters);

    for (const event of paged) {
      const venue = event.venueId ? this.venues.get(event.venueId) : null;
      // A collapsed festival card lists the whole run's lineup (primary day first).
      const lineupEventIds = new Set<string>([
        event.id,
        ...(collapsing ? (this.festivalMemberIds.get(event.id) ?? []) : []),
      ]);
      const seenLineupArtists = new Set<string>();
      const artists: Array<{
        id?: string;
        name: string;
        billingPosition: BillingPosition;
        spotifyArtistId?: string | null;
        imageUrl?: string | null;
      }> = [];
      for (const lineupEventId of lineupEventIds) {
        for (const ea of this.eventArtists.values()) {
          if (ea.eventId !== lineupEventId) continue;
          if (seenLineupArtists.has(ea.artistId)) continue;
          seenLineupArtists.add(ea.artistId);
          const a = this.artists.get(ea.artistId);
          let spotifyArtistId: string | null = null;
          for (const ext of this.artistExternalIds.values()) {
            if (ext.artistId === ea.artistId && ext.provider === 'spotify') {
              spotifyArtistId = ext.externalId;
              break;
            }
          }
          artists.push({
            id: ea.artistId,
            name: a?.name ?? 'Unknown Artist',
            billingPosition: ea.billingPosition,
            spotifyArtistId,
            imageUrl: a?.imageUrl ?? null,
          });
        }
      }

      let minPrice: number | null = null;
      let maxPrice: number | null = null;
      let currency: string | null = null;
      const eventTicketLinks: EventTicketLink[] = [];

      for (const tl of this.eventTicketLinks.values()) {
        if (tl.eventId === event.id) {
          eventTicketLinks.push(tl);
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

      if (minPrice === null && event.eventKind === 'free_event') {
        minPrice = 0;
      }

      const eventSources: CanonicalEventSourceSummary[] = [];
      for (const es of this.eventSources.values()) {
        if (es.eventId === event.id && es.isCurrent !== false) {
          let sName = es.sourceName;
          let sSlug = es.sourceSlug;
          if (!sName && this.sourceRepo) {
            const found = await this.sourceRepo.getById(es.sourceId);
            if (found) {
              sName = found.name;
              sSlug = found.slug;
            }
          }
          if (!sName && this.sources.has(es.sourceId)) {
            const found = this.sources.get(es.sourceId);
            if (found) {
              sName = found.name;
              sSlug = found.slug;
            }
          }
          // Exact authoritative registry match
          if (!sName && es.sourceId === TICKETMASTER_DEFAULT_SOURCE_ID) {
            sName = 'Ticketmaster Discovery API';
            sSlug = TICKETMASTER_SOURCE_SLUG;
          }
          // Neutral unknown-source state without implying verification
          if (!sName) {
            sName = 'Unknown Source';
            sSlug = 'unknown-source';
          }
          eventSources.push({
            id: es.sourceId,
            name: sName,
            slug: sSlug ?? 'unknown-source',
            sourceUrl: es.sourceUrl,
          });
        }
      }

      let summaryInventoryStatus: TicketInventoryStatus = 'unknown';
      if (eventTicketLinks.length > 0) {
        const statuses = eventTicketLinks.map((tl) => tl.inventoryStatus);
        if (statuses.every((s) => s === 'sold_out')) {
          summaryInventoryStatus = 'sold_out';
        } else if (statuses.some((s) => s === 'low_inventory')) {
          summaryInventoryStatus = 'low_inventory';
        } else if (statuses.some((s) => s === 'available')) {
          summaryInventoryStatus = 'available';
        } else if (statuses.some((s) => s === 'cancelled')) {
          summaryInventoryStatus = 'cancelled';
        }
      } else if (event.status === 'cancelled') {
        summaryInventoryStatus = 'cancelled';
      }

      summaries.push({
        id: event.id,
        title: event.name,
        venueName: venue?.name ?? 'Venue TBA',
        venueId: event.venueId,
        venue,
        city: venue?.city ?? event.city ?? undefined,
        region: venue?.region ?? event.region ?? undefined,
        lat: venue?.lat ?? event.lat ?? null,
        lng: venue?.lng ?? event.lng ?? null,
        localStartDate: event.localStartDate,
        startsAt: event.startsAt,
        timezone: event.timezone,
        startTimePrecision: event.startTimePrecision,
        status: event.status,
        eventKind: event.eventKind,
        artists,
        ticketUrl: event.primaryTicketUrl,
        minPrice,
        maxPrice,
        currency,
        sourceName: eventSources.length > 0 ? eventSources[0].name : undefined,
        sources: eventSources,
        ticketLinks: eventTicketLinks,
        inventoryStatus: summaryInventoryStatus,
        festivalGroupEndDate: event.festivalGroupEndDate ?? null,
        ...(event.imageUrl ? { imageUrl: event.imageUrl } : {}),
      });
    }

    return summaries;
  }

  async listCities(): Promise<string[]> {
    const citySet = new Set<string>();
    for (const event of this.events.values()) {
      if (event.status === 'scheduled') {
        const venue = event.venueId ? this.venues.get(event.venueId) : null;
        const city = venue?.city ?? event.city;
        if (city && city.trim().length > 0) {
          citySet.add(city.trim());
        }
      }
    }
    return Array.from(citySet).sort();
  }

  async getFacets(): Promise<{
    venues: Array<{ id: string; name: string; city?: string }>;
    cities: string[];
    genres: string[];
  }> {
    const venues = Array.from(this.venues.values()).map((v) => ({
      id: v.id,
      name: v.name,
      city: v.city ?? undefined,
    }));
    const cities = await this.listCities();
    const genreSet = new Set<string>([
      'Rock',
      'Indie',
      'Electronic',
      'Pop',
      'Hip-Hop',
      'Jazz',
      'Folk',
      'Country',
      'Metal',
      'Punk',
      'R&B',
      'Classical',
      'Festival',
    ]);
    for (const e of this.events.values()) {
      if (e.genre) genreSet.add(e.genre);
    }
    const genres = normalizeGenreFacets(Array.from(genreSet));
    return {
      venues: venues.sort((a, b) => a.name.localeCompare(b.name)),
      cities: cities.sort((a, b) => a.localeCompare(b)),
      genres,
    };
  }

  async getArtistById(id: string): Promise<Artist | null> {
    return this.artists.get(id) ?? null;
  }

  async searchArtists(query: string, limit = 10): Promise<Artist[]> {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];
    const safeLimit = Math.min(Math.max(1, limit), 25);

    const matches: Artist[] = [];
    for (const artist of this.artists.values()) {
      if (
        artist.name.toLowerCase().includes(trimmed) ||
        artist.normalizedName.includes(trimmed)
      ) {
        matches.push(artist);
        if (matches.length >= safeLimit) break;
      }
    }
    return matches;
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

  async getArtistsByIds(ids: string[]): Promise<Artist[]> {
    const out: Artist[] = [];
    for (const id of new Set(ids)) {
      const a = this.artists.get(id);
      if (a) out.push(a);
    }
    return out;
  }

  /** Event ids hidden by collapseFestivalDays (computed by refreshFestivalGroups). */
  private hiddenFestivalDayIds = new Set<string>();
  /** Primary event id -> the group's other day ids, in date order (computed by refreshFestivalGroups). */
  private festivalMemberIds = new Map<string, string[]>();

  async listFestivalDays(eventId: string) {
    const group = groupFestivalDays(Array.from(this.events.values())).find(
      (g) => g.members.some((m) => m.id === eventId),
    );
    return (group?.members ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      localStartDate: m.localStartDate,
    }));
  }

  async refreshFestivalGroups(): Promise<number> {
    this.hiddenFestivalDayIds = new Set();
    this.festivalMemberIds = new Map();
    // Like the SQL refresh, start from a clean slate so events that left a group are reset.
    for (const e of this.events.values()) e.festivalGroupEndDate = null;
    const groups = groupFestivalDays(Array.from(this.events.values()));
    let grouped = 0;
    for (const g of groups) {
      grouped += g.members.length;
      this.festivalMemberIds.set(
        g.primary.id,
        g.members.filter((m) => m.id !== g.primary.id).map((m) => m.id),
      );
      for (const e of g.members) {
        if (e.id !== g.primary.id) this.hiddenFestivalDayIds.add(e.id);
        e.festivalGroupEndDate = e.id === g.primary.id ? g.endDate : null;
      }
    }
    return grouped;
  }

  async fillVenueCoordinatesForEvent(
    eventId: string,
    lat: number,
    lng: number,
  ): Promise<boolean> {
    if (!isValidCoordinatePair(lat, lng)) return false;
    const ev = this.events.get(eventId);
    const venue = ev?.venueId ? this.venues.get(ev.venueId) : undefined;
    if (!venue || (venue.lat != null && venue.lng != null)) return false;
    this.venues.set(venue.id, { ...venue, lat, lng });
    return true;
  }

  async fillEventGenres(
    eventId: string,
    genres: string[],
    source: string,
  ): Promise<boolean> {
    const clean = Array.from(
      new Set(genres.map((g) => g?.trim()).filter((g): g is string => !!g)),
    );
    const ev = this.events.get(eventId);
    if (!ev || clean.length === 0) return false;
    if ((ev.genres && ev.genres.length > 0) || ev.genre) return false;
    this.events.set(eventId, {
      ...ev,
      genre: clean[0],
      genres: clean,
      genresSource: source,
    });
    return true;
  }

  async fillArtistGenres(
    artistId: string,
    genres: string[],
    source: string,
  ): Promise<boolean> {
    const clean = Array.from(
      new Set(genres.map((g) => g?.trim()).filter((g): g is string => !!g)),
    );
    const artist = this.artists.get(artistId);
    if (!artist || clean.length === 0) return false;
    if (Array.isArray(artist.genres) && artist.genres.length > 0) return false;
    this.artists.set(artistId, { ...artist, genres: clean });
    this.artistGenreSources.set(artistId, source);
    return true;
  }

  async findArtistIdsByExternalIds(
    provider: string,
    externalIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const extSet = new Set(externalIds);
    for (const ext of this.artistExternalIds.values()) {
      if (ext.provider === provider && extSet.has(ext.externalId)) {
        result.set(ext.externalId, ext.artistId);
      }
    }
    return result;
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
    const id = crypto.randomUUID();
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
    const id = crypto.randomUUID();
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
    const id = crypto.randomUUID();
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
    const id = crypto.randomUUID();
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
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const created: Event = {
      id,
      ...event,
      minPrice: event.minPrice ?? (event.eventKind === 'free_event' ? 0 : null),
      maxPrice: event.maxPrice ?? null,
      currency: event.currency ?? null,
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
      id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
      ...ticketLink,
      inventoryStatus: ticketLink.inventoryStatus ?? 'unknown',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.eventTicketLinks.set(key, link);

    // Sync event pricing rollups
    const ev = this.events.get(ticketLink.eventId);
    if (ev) {
      let minP: number | null = null;
      let maxP: number | null = null;
      let curr: string | null = null;
      for (const tl of this.eventTicketLinks.values()) {
        if (tl.eventId === ev.id) {
          if (tl.minPrice !== null && tl.minPrice !== undefined) {
            minP = minP === null ? tl.minPrice : Math.min(minP, tl.minPrice);
          }
          if (tl.maxPrice !== null && tl.maxPrice !== undefined) {
            maxP = maxP === null ? tl.maxPrice : Math.max(maxP, tl.maxPrice);
          }
          if (tl.currency && !curr) {
            curr = tl.currency;
          }
        }
      }
      if (minP === null && ev.eventKind === 'free_event') {
        minP = 0;
      }
      ev.minPrice = minP;
      ev.maxPrice = maxP;
      if (curr) ev.currency = curr;
    }

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
    sourceName?: string;
    sourceSlug?: string;
  }): Promise<EventSourceRecord> {
    if (sourceRecord.sourceEventId) {
      for (const es of this.eventSources.values()) {
        if (
          es.sourceId === sourceRecord.sourceId &&
          es.sourceEventId === sourceRecord.sourceEventId &&
          es.eventId !== sourceRecord.eventId
        ) {
          throw new Error(
            `duplicate key value violates unique constraint "uq_event_sources_source_event": source (${sourceRecord.sourceId}, ${sourceRecord.sourceEventId}) is already linked to event ${es.eventId}`,
          );
        }
      }
    }
    const key = sourceRecord.sourceEventId
      ? `${sourceRecord.sourceId}_${sourceRecord.sourceEventId}`
      : `${sourceRecord.eventId}_${sourceRecord.sourceId}_${sourceRecord.sourceUrl}`;
    const existing = this.eventSources.get(key);
    const now = new Date().toISOString();
    const record: EventSourceRecord = {
      id: existing?.id ?? crypto.randomUUID(),
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
    const id = crypto.randomUUID();
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
    const id = crypto.randomUUID();
    const record: CandidateResolution = {
      id,
      ...resolution,
      resolvedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.candidateResolutions.set(id, record);
    return record;
  }

  async findResolutionByCandidateId(
    candidateId: string,
  ): Promise<CandidateResolution | null> {
    for (const res of this.candidateResolutions.values()) {
      if (res.eventCandidateId === candidateId) {
        return res;
      }
    }
    return null;
  }

  async countResolutions(): Promise<number> {
    return this.candidateResolutions.size;
  }

  async countFieldEvidence(): Promise<number> {
    return this.eventFieldEvidence.size;
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

      // 0. External-ID conflict pre-check (mirrors apply_canonicalization): when a
      // resolution is supplied, persist needs_review instead of aborting the batch.
      if (payload.event && payload.resolution) {
        const claimedBy = new Map<string, string>();
        let conflict: string | null = null;
        for (const a of payload.artists ?? []) {
          const identity = a.artist_id ?? `name:${a.normalized_name ?? a.name}`;
          for (const ext of a.external_ids ?? []) {
            const key = `${ext.provider}\u0000${ext.external_id}`;
            const prior = claimedBy.get(key);
            if (prior !== undefined && prior !== identity) {
              conflict = 'external_id_shared_by_multiple_artists_in_candidate';
            }
            claimedBy.set(key, identity);
            for (const existingExt of this.artistExternalIds.values()) {
              if (
                existingExt.provider === ext.provider &&
                existingExt.externalId === ext.external_id &&
                existingExt.artistId !== a.artist_id
              ) {
                conflict = 'external_id_owned_by_different_artist';
              }
            }
          }
        }
        if (conflict) {
          await this.recordResolution({
            eventCandidateId: payload.resolution.event_candidate_id,
            eventId: null,
            status: 'needs_review',
            matcherVersion: payload.resolution.matcher_version ?? '1.0.0',
            confidence: Math.min(payload.resolution.confidence, 0.4),
            reasons: ['duplicate_external_id_conflict', conflict],
          });
          return { eventId: null, status: 'needs_review' };
        }
      }

      // 1. Create venue if specified in transaction payload
      if (payload.venueToCreate) {
        createdVenueId = payload.venueToCreate.id ?? crypto.randomUUID();
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
              id: eventId,
              name: payload.event.name ?? existing.name,
              normalizedName:
                payload.event.normalized_name ?? existing.normalizedName,
              eventKind: payload.event.event_kind ?? existing.eventKind,
              status: payload.event.status ?? existing.status,
              // Mirrors SQL coalesce(venue_id, new venue, venue_id): never null a known venue.
              venueId: venueIdToUse ?? existing.venueId,
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
              // Fill-if-empty: never overwrite an existing image.
              imageUrl: existing.imageUrl ?? payload.event.image_url ?? null,
              updatedAt: new Date().toISOString(),
            });
          }
        } else {
          eventId = crypto.randomUUID();
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
            startTimePrecision:
              payload.event.start_time_precision ??
              (payload.event.starts_at ? 'instant' : 'date_only'),
            doorsAt: payload.event.doors_at ?? null,
            isMultiDay: payload.event.is_multi_day ?? false,
            officialUrl: payload.event.official_url ?? null,
            primaryTicketUrl: payload.event.primary_ticket_url ?? null,
            imageUrl: payload.event.image_url ?? null,
            announcedAt: null,
            createdAt: now,
            updatedAt: now,
          };
          this.events.set(eventId, created);
        }

        // Venue image (fill-if-empty), mirroring the SQL function
        if (payload.event.venue_image_url && venueIdToUse) {
          const v = this.venues.get(venueIdToUse);
          if (v && !v.imageUrl) {
            this.venues.set(venueIdToUse, {
              ...v,
              imageUrl: payload.event.venue_image_url,
            });
          }
        }

        // 2. Artists (link existing or create new inside the transaction)
        if (payload.artists) {
          for (const a of payload.artists) {
            let artistId = a.artist_id;
            if (a.name && (!artistId || !this.artists.has(artistId))) {
              artistId = artistId ?? crypto.randomUUID();
              const artNow = new Date().toISOString();
              this.artists.set(artistId, {
                id: artistId,
                name: a.name,
                normalizedName: a.normalized_name ?? normalizeName(a.name),
                imageUrl: a.image_url ?? null,
                createdAt: artNow,
                updatedAt: artNow,
              });
            }

            // Artist image (fill-if-empty) for matched artists, mirroring the SQL function
            if (artistId && a.image_url) {
              const existingArtist = this.artists.get(artistId);
              if (existingArtist && !existingArtist.imageUrl) {
                this.artists.set(artistId, {
                  ...existingArtist,
                  imageUrl: a.image_url,
                });
              }
            }

            // Enrich or attach external IDs if provided (for both new and matched artists)
            if (artistId && a.external_ids) {
              const artNow = new Date().toISOString();
              for (const ext of a.external_ids) {
                // Check constraint: uq_artist_provider_external_id (no other artist can have this external ID)
                for (const existingExt of this.artistExternalIds.values()) {
                  if (
                    existingExt.provider === ext.provider &&
                    existingExt.externalId === ext.external_id &&
                    existingExt.artistId !== artistId
                  ) {
                    throw new Error(
                      `duplicate key value violates unique constraint "uq_artist_provider_external_id": (${ext.provider}, ${ext.external_id}) already belongs to artist ${existingExt.artistId}`,
                    );
                  }
                }

                // Check idempotent presence
                const alreadyPresent = Array.from(
                  this.artistExternalIds.values(),
                ).some(
                  (e) =>
                    e.artistId === artistId &&
                    e.provider === ext.provider &&
                    e.externalId === ext.external_id,
                );

                if (!alreadyPresent) {
                  const extId = crypto.randomUUID();
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
            sourceName: payload.source.source_name,
            sourceSlug: payload.source.source_slug,
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

export class MemoryUserPreferenceRepository implements IUserPreferenceRepository {
  private preferences = new Map<string, UserArtistPreference>();
  private catalogRepo?: ICatalogRepository;

  constructor(catalogRepo?: ICatalogRepository) {
    this.catalogRepo = catalogRepo;
  }

  async getPreferences(userId: string): Promise<UserArtistPreference[]> {
    const userPrefs: UserArtistPreference[] = [];
    for (const pref of this.preferences.values()) {
      if (pref.userId === userId) {
        userPrefs.push({ ...pref });
      }
    }
    userPrefs.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return userPrefs;
  }

  async getPreference(
    userId: string,
    preferenceId: string,
  ): Promise<UserArtistPreference | null> {
    const pref = this.preferences.get(preferenceId);
    if (!pref || pref.userId !== userId) {
      return null;
    }
    return { ...pref };
  }

  async savePreference(
    input: SavePreferenceInput,
  ): Promise<UserArtistPreference> {
    if (!input.userId || !input.userId.trim()) {
      throw new Error('User ID is required');
    }
    const rawArtistName = input.artistName?.trim();
    if (!rawArtistName) {
      throw new Error('Artist name must not be empty');
    }
    if (!VALID_PREFERENCE_LEVELS.includes(input.preferenceLevel)) {
      throw new Error(`Invalid preference level: ${input.preferenceLevel}`);
    }

    const now = new Date().toISOString();
    const trimmedSpotifyId = input.spotifyArtistId?.trim() || null;

    if (input.artistId) {
      let authoritativeName = rawArtistName;
      let authoritativeNorm = normalizeName(rawArtistName);
      let canonicalSummary: CanonicalArtistSummary | null = null;
      let canonicalSpotifyExtId: string | null = null;

      if (this.catalogRepo) {
        const canonical = await this.catalogRepo.getArtistById(input.artistId);
        if (!canonical) {
          throw new InvalidCatalogArtistError(input.artistId);
        }
        authoritativeName = canonical.name;
        authoritativeNorm = canonical.normalizedName;

        const extIds = await this.catalogRepo.findArtistExternalIds(
          input.artistId,
        );
        // An artist may hold several Spotify ids: prefer the supplied one when it is one of them.
        const spotifyExts = extIds.filter((e) => e.provider === 'spotify');
        const match =
          spotifyExts.find((e) => e.externalId === trimmedSpotifyId) ??
          spotifyExts[0];
        if (match) canonicalSpotifyExtId = match.externalId;

        if (trimmedSpotifyId) {
          const mappedArtist = await this.catalogRepo.findArtistByExternalId(
            'spotify',
            trimmedSpotifyId,
          );

          if (mappedArtist && mappedArtist.id !== input.artistId) {
            throw new ConflictingArtistIdentityError(
              `Supplied Spotify artist ID '${trimmedSpotifyId}' is mapped to a different canonical artist ('${mappedArtist.id}') than '${input.artistId}'.`,
              input.artistId,
              trimmedSpotifyId,
            );
          }

          if (
            canonicalSpotifyExtId &&
            canonicalSpotifyExtId !== trimmedSpotifyId
          ) {
            throw new ConflictingArtistIdentityError(
              `Canonical artist '${input.artistId}' is already mapped to Spotify artist '${canonicalSpotifyExtId}', which conflicts with supplied Spotify artist '${trimmedSpotifyId}'.`,
              input.artistId,
              trimmedSpotifyId,
            );
          }

          if (!mappedArtist && !canonicalSpotifyExtId) {
            throw new ConflictingArtistIdentityError(
              `Supplied Spotify artist ID '${trimmedSpotifyId}' cannot be verified against canonical artist '${input.artistId}' via trusted external-ID mappings.`,
              input.artistId,
              trimmedSpotifyId,
            );
          }
        }

        canonicalSummary = {
          id: canonical.id,
          name: canonical.name,
          imageUrl: canonical.imageUrl,
          spotifyArtistId: trimmedSpotifyId ?? canonicalSpotifyExtId,
        };
      }

      // Check strictly for existing canonical preference for this user
      let existingPref: UserArtistPreference | undefined;
      for (const pref of this.preferences.values()) {
        if (pref.userId === input.userId && pref.artistId === input.artistId) {
          existingPref = pref;
          break;
        }
      }

      if (!existingPref && (trimmedSpotifyId || canonicalSpotifyExtId)) {
        const targetSpotifyId = trimmedSpotifyId ?? canonicalSpotifyExtId;
        for (const pref of this.preferences.values()) {
          if (
            pref.userId === input.userId &&
            pref.spotifyArtistId === targetSpotifyId
          ) {
            existingPref = pref;
            break;
          }
        }
      }

      const finalSpotifyId =
        trimmedSpotifyId ??
        existingPref?.spotifyArtistId ??
        canonicalSpotifyExtId ??
        null;

      if (existingPref) {
        existingPref.preferenceLevel = input.preferenceLevel;
        existingPref.artistName = authoritativeName;
        existingPref.normalizedArtistName = authoritativeNorm;
        existingPref.artistId = input.artistId;
        existingPref.spotifyArtistId = finalSpotifyId;
        existingPref.updatedAt = now;
        if (canonicalSummary) {
          existingPref.canonicalArtist = {
            ...canonicalSummary,
            spotifyArtistId: finalSpotifyId,
          };
        }
        return { ...existingPref };
      }

      const newPref: UserArtistPreference = {
        id: crypto.randomUUID(),
        userId: input.userId,
        artistId: input.artistId,
        archivedArtistId: null,
        artistName: authoritativeName,
        normalizedArtistName: authoritativeNorm,
        preferenceLevel: input.preferenceLevel,
        createdAt: now,
        updatedAt: now,
        canonicalArtist: canonicalSummary
          ? { ...canonicalSummary, spotifyArtistId: finalSpotifyId }
          : null,
        spotifyArtistId: finalSpotifyId,
      };

      this.preferences.set(newPref.id, newPref);
      return { ...newPref };
    }

    // 2. Explicit Spotify Artist ID provided
    if (trimmedSpotifyId) {
      let matchedCanonicalArtistId: string | null = null;
      let authoritativeName = rawArtistName;
      let authoritativeNorm = normalizeName(rawArtistName);
      let canonicalSummary: CanonicalArtistSummary | null = null;

      if (this.catalogRepo) {
        try {
          const canonicalArtist = await this.catalogRepo.findArtistByExternalId(
            'spotify',
            trimmedSpotifyId,
          );
          if (canonicalArtist) {
            matchedCanonicalArtistId = canonicalArtist.id;
            authoritativeName = canonicalArtist.name;
            authoritativeNorm = canonicalArtist.normalizedName;
            canonicalSummary = {
              id: canonicalArtist.id,
              name: canonicalArtist.name,
              imageUrl: canonicalArtist.imageUrl,
              spotifyArtistId: trimmedSpotifyId,
            };
          }
        } catch {
          // Fallback if findArtistByExternalId is not available
        }
      }

      // Check if user already has a preference for this Spotify artist ID
      let existingPref: UserArtistPreference | undefined;
      for (const pref of this.preferences.values()) {
        if (
          pref.userId === input.userId &&
          pref.spotifyArtistId === trimmedSpotifyId
        ) {
          existingPref = pref;
          break;
        }
        if (
          matchedCanonicalArtistId &&
          pref.userId === input.userId &&
          pref.artistId === matchedCanonicalArtistId
        ) {
          existingPref = pref;
          break;
        }
      }

      if (existingPref) {
        existingPref.preferenceLevel = input.preferenceLevel;
        existingPref.artistName = authoritativeName;
        existingPref.normalizedArtistName = authoritativeNorm;
        existingPref.spotifyArtistId = trimmedSpotifyId;
        existingPref.updatedAt = now;
        if (canonicalSummary) {
          existingPref.artistId = matchedCanonicalArtistId;
          existingPref.canonicalArtist = canonicalSummary;
        }
        return { ...existingPref };
      }

      const newPref: UserArtistPreference = {
        id: crypto.randomUUID(),
        userId: input.userId,
        artistId: matchedCanonicalArtistId,
        archivedArtistId: null,
        artistName: authoritativeName,
        normalizedArtistName: authoritativeNorm,
        preferenceLevel: input.preferenceLevel,
        createdAt: now,
        updatedAt: now,
        canonicalArtist: canonicalSummary,
        spotifyArtistId: trimmedSpotifyId,
      };

      this.preferences.set(newPref.id, newPref);
      return { ...newPref };
    }

    // 3. Uncataloged free-text entry: match only against existing non-Spotify uncataloged preferences
    const normalizedName = normalizeName(rawArtistName);
    let existingUnresolved: UserArtistPreference | undefined;

    for (const pref of this.preferences.values()) {
      if (
        pref.userId === input.userId &&
        !pref.artistId &&
        !pref.archivedArtistId &&
        !pref.spotifyArtistId &&
        pref.normalizedArtistName === normalizedName
      ) {
        existingUnresolved = pref;
        break;
      }
    }

    if (existingUnresolved) {
      existingUnresolved.preferenceLevel = input.preferenceLevel;
      existingUnresolved.artistName = rawArtistName;
      existingUnresolved.updatedAt = now;
      return { ...existingUnresolved };
    }

    const newPref: UserArtistPreference = {
      id: crypto.randomUUID(),
      userId: input.userId,
      artistId: null,
      archivedArtistId: null,
      artistName: rawArtistName,
      normalizedArtistName: normalizedName,
      preferenceLevel: input.preferenceLevel,
      createdAt: now,
      updatedAt: now,
      spotifyArtistId: null,
    };

    this.preferences.set(newPref.id, newPref);
    return { ...newPref };
  }

  async updatePreferenceLevel(
    userId: string,
    preferenceId: string,
    preferenceLevel: PreferenceLevel,
  ): Promise<UserArtistPreference> {
    if (!userId || !userId.trim()) {
      throw new Error('User ID is required');
    }
    if (!preferenceId || !preferenceId.trim()) {
      throw new Error('Preference ID is required');
    }
    if (!VALID_PREFERENCE_LEVELS.includes(preferenceLevel)) {
      throw new Error(`Invalid preference level: ${preferenceLevel}`);
    }

    const existing = this.preferences.get(preferenceId);
    if (!existing || existing.userId !== userId) {
      throw new Error(`Preference not found: ${preferenceId}`);
    }

    existing.preferenceLevel = preferenceLevel;
    existing.updatedAt = new Date().toISOString();
    return { ...existing };
  }

  async deletePreference(
    userId: string,
    preferenceId: string,
  ): Promise<boolean> {
    const pref = this.preferences.get(preferenceId);
    if (!pref || pref.userId !== userId) {
      return false;
    }
    return this.preferences.delete(preferenceId);
  }

  // Test helper: simulate catalog deletion setting artist_id to null and archiving ID
  simulateCanonicalArtistDeletion(artistId: string): void {
    for (const pref of this.preferences.values()) {
      if (pref.artistId === artistId) {
        pref.archivedArtistId = artistId;
        pref.artistId = null;
        pref.canonicalArtist = null;
      }
    }
  }

  clear(): void {
    this.preferences.clear();
  }
}

interface StoredSpotifyConnectionRecord {
  userId: string;
  spotifyAccountId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  reauthorizationDeadline: Date;
  scopes: string[];
  status: SpotifyConnectionStatus;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class MemorySpotifyConnectionRepository implements ISpotifyConnectionRepository {
  private connections: Map<string, StoredSpotifyConnectionRecord> = new Map();

  async getConnection(userId: string): Promise<SpotifyConnection | null> {
    if (!userId || !userId.trim()) return null;
    const record = this.connections.get(userId);
    if (!record) return null;

    return {
      userId: record.userId,
      spotifyAccountId: record.spotifyAccountId,
      status: record.status,
      tokenExpiresAt: record.tokenExpiresAt.toISOString(),
      reauthorizationDeadline: record.reauthorizationDeadline.toISOString(),
      scopes: [...record.scopes],
      lastSyncedAt: record.lastSyncedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async getConnectionTokens(
    userId: string,
  ): Promise<SpotifyConnectionTokens | null> {
    if (!userId || !userId.trim()) return null;
    const record = this.connections.get(userId);
    if (!record) return null;

    if (
      record.status === 'disconnected' ||
      record.status === 'revoked' ||
      record.status === 'expired'
    ) {
      return null;
    }

    if (new Date(record.reauthorizationDeadline).getTime() <= Date.now()) {
      return null;
    }

    return {
      accessToken: record.accessToken,
      refreshToken: record.refreshToken,
      tokenExpiresAt: new Date(record.tokenExpiresAt),
      reauthorizationDeadline: new Date(record.reauthorizationDeadline),
      scopes: [...record.scopes],
    };
  }

  async findBySpotifyAccountId(
    spotifyAccountId: string,
  ): Promise<SpotifyConnection | null> {
    if (!spotifyAccountId || !spotifyAccountId.trim()) return null;
    const trimmed = spotifyAccountId.trim();

    for (const record of this.connections.values()) {
      if (record.spotifyAccountId === trimmed) {
        return {
          userId: record.userId,
          spotifyAccountId: record.spotifyAccountId,
          status: record.status,
          tokenExpiresAt: record.tokenExpiresAt.toISOString(),
          reauthorizationDeadline: record.reauthorizationDeadline.toISOString(),
          scopes: [...record.scopes],
          lastSyncedAt: record.lastSyncedAt,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        };
      }
    }
    return null;
  }

  async saveConnection(
    input: SaveSpotifyConnectionInput,
  ): Promise<SpotifyConnection> {
    if (!input.userId || !input.userId.trim()) {
      throw new Error('User ID is required');
    }
    const spotifyAccountId = input.spotifyAccountId?.trim();
    if (!spotifyAccountId) {
      throw new Error('Spotify account ID is required');
    }
    if (!input.accessToken || !input.refreshToken) {
      throw new Error('Access token and refresh token are required');
    }

    // 1-to-1 account conflict invariant
    const existing = await this.findBySpotifyAccountId(spotifyAccountId);
    if (existing && existing.userId !== input.userId) {
      throw new SpotifyAccountConflictError(spotifyAccountId);
    }

    const now = new Date().toISOString();
    const existingUserRecord = this.connections.get(input.userId);

    const record: StoredSpotifyConnectionRecord = {
      userId: input.userId,
      spotifyAccountId,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      tokenExpiresAt: new Date(input.tokenExpiresAt),
      reauthorizationDeadline: new Date(input.reauthorizationDeadline),
      scopes: [...input.scopes],
      status: 'connected',
      lastSyncedAt: existingUserRecord?.lastSyncedAt ?? null,
      createdAt: existingUserRecord?.createdAt ?? now,
      updatedAt: now,
    };

    this.connections.set(input.userId, record);

    return {
      userId: record.userId,
      spotifyAccountId: record.spotifyAccountId,
      status: record.status,
      tokenExpiresAt: record.tokenExpiresAt.toISOString(),
      reauthorizationDeadline: record.reauthorizationDeadline.toISOString(),
      scopes: [...record.scopes],
      lastSyncedAt: record.lastSyncedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async updateTokens(
    userId: string,
    input: UpdateSpotifyTokensInput,
  ): Promise<SpotifyConnection> {
    if (!userId || !userId.trim()) {
      throw new Error('User ID is required');
    }
    const record = this.connections.get(userId);
    if (!record) {
      throw new Error(`Spotify connection not found for user: ${userId}`);
    }

    record.accessToken = input.accessToken;
    record.tokenExpiresAt = new Date(input.tokenExpiresAt);
    record.status = 'connected';
    record.updatedAt = new Date().toISOString();

    if (input.refreshToken) {
      record.refreshToken = input.refreshToken;
    }
    if (input.reauthorizationDeadline) {
      record.reauthorizationDeadline = new Date(input.reauthorizationDeadline);
    }

    return {
      userId: record.userId,
      spotifyAccountId: record.spotifyAccountId,
      status: record.status,
      tokenExpiresAt: record.tokenExpiresAt.toISOString(),
      reauthorizationDeadline: record.reauthorizationDeadline.toISOString(),
      scopes: [...record.scopes],
      lastSyncedAt: record.lastSyncedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async updateStatus(
    userId: string,
    status: SpotifyConnectionStatus,
  ): Promise<void> {
    const record = this.connections.get(userId);
    if (record) {
      record.status = status;
      record.updatedAt = new Date().toISOString();
    }
  }

  async recordSync(userId: string, syncedAt?: Date): Promise<void> {
    const record = this.connections.get(userId);
    if (record) {
      record.lastSyncedAt = (syncedAt ?? new Date()).toISOString();
      record.updatedAt = new Date().toISOString();
    }
  }

  async deleteConnection(userId: string): Promise<boolean> {
    return this.connections.delete(userId);
  }

  clear(): void {
    this.connections.clear();
  }
}

export class MemoryProfileRepository implements IProfileRepository {
  private profiles = new Map<string, UserProfile>();

  async getProfile(userId: string): Promise<UserProfile | null> {
    const p = this.profiles.get(userId);
    return p ? { ...p } : null;
  }

  async upsertProfile(
    userId: string,
    input: UserProfileUpdateInput,
  ): Promise<UserProfile> {
    const existing = this.profiles.get(userId);
    const now = new Date().toISOString();

    const updated: UserProfile = {
      id: userId,
      homeLatApprox:
        input.homeLatApprox !== undefined
          ? input.homeLatApprox
          : (existing?.homeLatApprox ?? null),
      homeLngApprox:
        input.homeLngApprox !== undefined
          ? input.homeLngApprox
          : (existing?.homeLngApprox ?? null),
      defaultRadiusMiles:
        input.defaultRadiusMiles !== undefined &&
        input.defaultRadiusMiles !== null
          ? input.defaultRadiusMiles
          : (existing?.defaultRadiusMiles ?? 25),
      maxSpontaneousPrice:
        input.maxSpontaneousPrice !== undefined
          ? input.maxSpontaneousPrice
          : (existing?.maxSpontaneousPrice ?? null),
      maxNormalTicketPrice:
        input.maxNormalTicketPrice !== undefined
          ? input.maxNormalTicketPrice
          : (existing?.maxNormalTicketPrice ?? null),
      maxFavoriteArtistPrice:
        input.maxFavoriteArtistPrice !== undefined
          ? input.maxFavoriteArtistPrice
          : (existing?.maxFavoriteArtistPrice ?? null),
      travelWillingness:
        input.travelWillingness !== undefined
          ? input.travelWillingness
          : (existing?.travelWillingness ?? null),
      recommendationPreset:
        input.recommendationPreset !== undefined
          ? input.recommendationPreset
          : (existing?.recommendationPreset ?? 'balanced'),
      artistWeight:
        input.artistWeight !== undefined
          ? input.artistWeight
          : (existing?.artistWeight ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.profiles.set(userId, updated);
    return { ...updated };
  }

  async updatePreset(
    userId: string,
    preset: RecommendationPreset,
  ): Promise<UserProfile> {
    return this.upsertProfile(userId, { recommendationPreset: preset });
  }

  clear(): void {
    this.profiles.clear();
  }
}
