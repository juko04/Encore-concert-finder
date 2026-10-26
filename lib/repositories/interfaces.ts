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
export type { CanonicalizationPayload };
import type { EventCandidate } from '@/lib/domain/event-candidate';
import type { RawIngest, Source } from '@/lib/domain/source';
import type {
  PreferenceLevel,
  SavePreferenceInput,
  UserArtistPreference,
} from '@/lib/domain/user-preference';
import type {
  SaveSpotifyConnectionInput,
  SpotifyConnection,
  SpotifyConnectionStatus,
  UpdateSpotifyTokensInput,
} from '@/lib/domain/spotify';

import type {
  RecommendationPreset,
  UserProfile,
  UserProfileUpdateInput,
} from '@/lib/domain/profile';

export interface EventListFilters {
  fromDate?: string;
  toDate?: string;
  venueId?: string;
  artistId?: string;
  artistIds?: string[];
  city?: string;
  region?: string;
  limit?: number;
  offset?: number;
}

export interface ICatalogRepository {
  // Read operations (public catalog)
  getEventById(id: string): Promise<CanonicalEventDetail | null>;
  listEvents(filters?: EventListFilters): Promise<CanonicalEventSummary[]>;
  getArtistById(id: string): Promise<Artist | null>;
  searchArtists(query: string, limit?: number): Promise<Artist[]>;
  findArtistByName(normalizedName: string): Promise<Artist | null>;
  findArtistsByName(normalizedName: string): Promise<Artist[]>;
  findArtistByExternalId(
    provider: string,
    externalId: string,
  ): Promise<Artist | null>;
  findArtistIdsByExternalIds(
    provider: string,
    externalIds: string[],
  ): Promise<Map<string, string>>;
  findArtistExternalIds(artistId: string): Promise<ArtistExternalId[]>;
  findVenueByNameAndCity(
    normalizedName: string,
    city: string,
  ): Promise<Venue | null>;
  findVenue(
    normalizedName: string,
    city: string,
    region?: string | null,
    countryCode?: string | null,
  ): Promise<Venue | null>;
  findEventsOnDateAtVenue(
    localStartDate: string,
    venueId: string,
  ): Promise<Event[]>;
  findEventByTicketUrl(normalizedTicketUrl: string): Promise<Event | null>;
  findEventBySourceEventId(
    sourceId: string,
    sourceEventId: string,
  ): Promise<Event | null>;

  // Write operations (service role / transaction boundary)
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
    countryCode?: string | null;
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
  linkTicketUrl(ticketLink: {
    eventId: string;
    ticketProviderSourceId?: string | null;
    url: string;
    normalizedUrl: string;
    minPrice?: number | null;
    maxPrice?: number | null;
    currency?: string | null;
    inventoryStatus?: EventTicketLink['inventoryStatus'];
    verifiedAt?: string | null;
  }): Promise<EventTicketLink>;
  recordEventSource(sourceRecord: {
    eventId: string;
    sourceId: string;
    candidateId?: string | null;
    rawIngestId?: string | null;
    sourceEventId?: string | null;
    sourceUrl: string;
    confidence: number;
    sourceName?: string;
    sourceSlug?: string;
  }): Promise<EventSourceRecord>;
  recordFieldEvidence(evidence: {
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
  }): Promise<EventFieldEvidence>;
  recordResolution(resolution: {
    eventCandidateId: string;
    eventId?: string | null;
    status: CandidateResolution['status'];
    matcherVersion: string;
    confidence: number;
    reasons: Record<string, unknown> | string[];
  }): Promise<CandidateResolution>;
  findResolutionByCandidateId(
    candidateId: string,
  ): Promise<CandidateResolution | null>;
  countResolutions(): Promise<number>;
  countFieldEvidence(): Promise<number>;

  // Atomic transaction execution for canonicalization (Finding 2)
  applyCanonicalization(
    payload: CanonicalizationPayload,
  ): Promise<{ eventId: string | null; status: string }>;
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
  getBySourceUrlAndContentHash(
    sourceId: string,
    sourceUrl: string,
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
  getById(
    id: string,
  ): Promise<
    | (EventCandidate & { id: string; rawIngestId: string; sourceId: string })
    | null
  >;
  getByRawIngestId(
    rawIngestId: string,
  ): Promise<
    Array<
      EventCandidate & { id: string; rawIngestId: string; sourceId: string }
    >
  >;
  listBySourceEventId(
    sourceId: string,
    sourceEventId: string,
  ): Promise<
    Array<
      EventCandidate & { id: string; rawIngestId: string; sourceId: string }
    >
  >;
  getLatestBySourceEventId(
    sourceId: string,
    sourceEventId: string,
  ): Promise<
    | (EventCandidate & { id: string; rawIngestId: string; sourceId: string })
    | null
  >;
}

export interface IUserPreferenceRepository {
  getPreferences(userId: string): Promise<UserArtistPreference[]>;
  getPreference(
    userId: string,
    preferenceId: string,
  ): Promise<UserArtistPreference | null>;
  savePreference(input: SavePreferenceInput): Promise<UserArtistPreference>;
  updatePreferenceLevel(
    userId: string,
    preferenceId: string,
    preferenceLevel: PreferenceLevel,
  ): Promise<UserArtistPreference>;
  deletePreference(userId: string, preferenceId: string): Promise<boolean>;
}

export interface SpotifyConnectionTokens {
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  reauthorizationDeadline: Date;
  scopes: string[];
}

export interface ISpotifyConnectionRepository {
  getConnection(userId: string): Promise<SpotifyConnection | null>;
  getConnectionTokens(userId: string): Promise<SpotifyConnectionTokens | null>;
  findBySpotifyAccountId(
    spotifyAccountId: string,
  ): Promise<SpotifyConnection | null>;
  saveConnection(input: SaveSpotifyConnectionInput): Promise<SpotifyConnection>;
  updateTokens(
    userId: string,
    input: UpdateSpotifyTokensInput,
  ): Promise<SpotifyConnection>;
  updateStatus(userId: string, status: SpotifyConnectionStatus): Promise<void>;
  recordSync(userId: string, syncedAt?: Date): Promise<void>;
  deleteConnection(userId: string): Promise<boolean>;
}

export interface IProfileRepository {
  getProfile(userId: string): Promise<UserProfile | null>;
  upsertProfile(
    userId: string,
    input: UserProfileUpdateInput,
  ): Promise<UserProfile>;
  updatePreset(
    userId: string,
    preset: RecommendationPreset,
  ): Promise<UserProfile>;
}
