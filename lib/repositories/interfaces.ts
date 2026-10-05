/**
 * Phase 1 Repository Interfaces
 * Decouples domain and use-case logic from specific database technology.
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

export interface EventListFilters {
  fromDate?: string;
  toDate?: string;
  venueId?: string;
  artistId?: string;
  city?: string;
  region?: string;
  limit?: number;
  offset?: number;
}

export interface ICatalogRepository {
  // Read operations (public catalog)
  getEventById(id: string): Promise<CanonicalEventDetail | null>;
  listEvents(filters?: EventListFilters): Promise<CanonicalEventSummary[]>;
  findArtistByName(normalizedName: string): Promise<Artist | null>;
  findArtistByExternalId(
    provider: string,
    externalId: string,
  ): Promise<Artist | null>;
  findVenueByNameAndCity(
    normalizedName: string,
    city: string,
  ): Promise<Venue | null>;
  findEventsOnDateAtVenue(
    localStartDate: string,
    venueId: string,
  ): Promise<Event[]>;
  findEventByTicketUrl(normalizedTicketUrl: string): Promise<Event | null>;

  // Write operations (service role only)
  createArtist(artist: {
    name: string;
    normalizedName: string;
    imageUrl?: string | null;
  }): Promise<Artist>;
  addArtistExternalId(externalId: {
    artistId: string;
    provider: string;
    externalId: string;
    providerUrl?: string | null;
  }): Promise<ArtistExternalId>;
  createVenue(venue: {
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
  }): Promise<Venue>;
  createPromoter(promoter: {
    name: string;
    normalizedName: string;
    website?: string | null;
    calendarUrl?: string | null;
  }): Promise<Promoter>;
  createEvent(
    event: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Event>;
  updateEvent(
    id: string,
    updates: Partial<Omit<Event, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Event>;
  linkEventArtist(
    eventId: string,
    artistId: string,
    billingPosition?: BillingPosition,
    sortOrder?: number,
  ): Promise<EventArtist>;
  linkEventPromoter(
    eventId: string,
    promoterId: string,
    relationshipType?: PromoterRelationshipType,
  ): Promise<EventPromoter>;
  addEventTicketLink(
    link: Omit<EventTicketLink, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<EventTicketLink>;
  addEventSource(
    sourceRecord: Omit<EventSourceRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<EventSourceRecord>;
  findEventSource(
    eventId: string,
    sourceId: string,
    sourceEventId?: string | null,
  ): Promise<EventSourceRecord | null>;
  updateEventSourceLastSeen(id: string, lastSeenAt: string): Promise<void>;
  addEventFieldEvidence(
    evidence: Omit<EventFieldEvidence, 'id' | 'createdAt'>,
  ): Promise<EventFieldEvidence>;
  recordCandidateResolution(
    resolution: Omit<CandidateResolution, 'id' | 'createdAt'>,
  ): Promise<CandidateResolution>;
  getCandidateResolution(
    candidateId: string,
  ): Promise<CandidateResolution | null>;
}

export interface ISourceRepository {
  getById(id: string): Promise<Source | null>;
  getBySlug(slug: string): Promise<Source | null>;
  listActive(): Promise<Source[]>;
  upsert(source: Omit<Source, 'createdAt' | 'updatedAt'>): Promise<Source>;
  recordFailure(id: string): Promise<void>;
  recordSuccess(id: string, lastFetchedAt?: string): Promise<void>;
}

export interface IRawIngestRepository {
  create(ingest: Omit<RawIngest, 'id'>): Promise<RawIngest & { id: string }>;
  getByContentHash(
    contentHash: string,
  ): Promise<(RawIngest & { id: string }) | null>;
  getById(id: string): Promise<(RawIngest & { id: string }) | null>;
  listBySource(
    sourceId: string,
    limit?: number,
  ): Promise<Array<RawIngest & { id: string }>>;
}

export interface IEventCandidateRepository {
  create(
    candidate: EventCandidate & { rawIngestId: string; sourceId: string },
  ): Promise<
    EventCandidate & { id: string; rawIngestId: string; sourceId: string }
  >;
  createMany(
    candidates: Array<
      EventCandidate & { rawIngestId: string; sourceId: string }
    >,
  ): Promise<
    Array<
      EventCandidate & { id: string; rawIngestId: string; sourceId: string }
    >
  >;
  getById(id: string): Promise<(EventCandidate & { id: string }) | null>;
  getByRawIngestId(
    rawIngestId: string,
  ): Promise<Array<EventCandidate & { id: string }>>;
  getBySourceEventId(
    sourceId: string,
    sourceEventId: string,
  ): Promise<(EventCandidate & { id: string }) | null>;
}
