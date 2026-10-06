/**
 * Phase 1 Catalog Domain Types
 * Canonical entities, value objects, relationships, DTOs, and transaction payload definitions.
 */

export type EventKind =
  | 'concert'
  | 'club_show'
  | 'outdoor_show'
  | 'free_event'
  | 'music_series'
  | 'residency'
  | 'festival'
  | 'multi_day_festival';

export type EventStatus =
  'scheduled' | 'cancelled' | 'postponed' | 'rescheduled' | 'unknown';

export type StartTimePrecision = 'instant' | 'date_only';

export type BillingPosition =
  'headliner' | 'subheadliner' | 'mid_card' | 'support' | 'unknown';

export type PromoterRelationshipType =
  'promoter' | 'co_promoter' | 'presenter' | 'producer' | 'unknown';

export type TicketInventoryStatus =
  'available' | 'low_inventory' | 'sold_out' | 'cancelled' | 'unknown';

export interface Artist {
  id: string;
  name: string;
  normalizedName: string;
  imageUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ArtistExternalId {
  id?: string;
  artistId: string;
  provider: string;
  externalId: string;
  providerUrl?: string | null;
  createdAt?: string;
}

export interface ArtistAlias {
  id?: string;
  artistId: string;
  alias: string;
  normalizedAlias: string;
  createdAt?: string;
}

export interface Venue {
  id: string;
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
  createdAt?: string;
  updatedAt?: string;
}

export interface VenueAlias {
  id?: string;
  venueId: string;
  alias: string;
  normalizedAlias: string;
  createdAt?: string;
}

export interface Promoter {
  id: string;
  name: string;
  normalizedName: string;
  website?: string | null;
  calendarUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Event {
  id: string;
  name: string;
  normalizedName: string;
  eventKind: EventKind;
  status: EventStatus;
  venueId: string | null;
  city?: string | null;
  region?: string | null;
  countryCode?: string | null;
  lat?: number | null;
  lng?: number | null;
  timezone: string;
  localStartDate: string;
  localEndDate?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  startTimePrecision: StartTimePrecision;
  doorsAt?: string | null;
  isMultiDay: boolean;
  officialUrl?: string | null;
  primaryTicketUrl?: string | null;
  announcedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface EventArtist {
  id?: string;
  eventId: string;
  artistId: string;
  billingPosition: BillingPosition;
  sortOrder: number;
  artist?: Artist;
  createdAt?: string;
}

export interface EventPromoter {
  id?: string;
  eventId: string;
  promoterId: string;
  relationshipType: PromoterRelationshipType;
  promoter?: Promoter;
  createdAt?: string;
}

export interface EventTicketLink {
  id?: string;
  eventId: string;
  ticketProviderSourceId?: string | null;
  url: string;
  normalizedUrl: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  currency?: string | null;
  inventoryStatus?: TicketInventoryStatus;
  verifiedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface EventSourceRecord {
  id?: string;
  eventId: string;
  sourceId: string;
  candidateId?: string | null;
  rawIngestId?: string | null;
  sourceEventId?: string | null;
  sourceUrl: string;
  confidence: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  isCurrent?: boolean;
  sourceName?: string;
  sourceSlug?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EventFieldEvidence {
  id?: string;
  eventId: string;
  fieldName: string;
  eventSourceId?: string | null;
  sourceId: string;
  rawIngestId?: string | null;
  candidateId?: string | null;
  observedValue: unknown;
  valueHash?: string;
  confidence: number;
  observedAt: string;
  parserVersion?: string;
  createdAt?: string;
}

export interface CandidateResolution {
  id?: string;
  eventCandidateId: string;
  eventId?: string | null;
  status: 'created' | 'matched' | 'needs_review' | 'rejected';
  matcherVersion: string;
  confidence: number;
  reasons: Record<string, unknown> | string[];
  resolvedAt: string;
  createdAt?: string;
}

export interface CanonicalEventSummary {
  id: string;
  title: string;
  venueName: string;
  city?: string;
  region?: string;
  localStartDate: string;
  startsAt?: string | null;
  timezone: string;
  startTimePrecision: StartTimePrecision;
  status: EventStatus;
  artists: Array<{ name: string; billingPosition: BillingPosition }>;
  ticketUrl?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  currency?: string | null;
  sourceName?: string;
}

export interface CanonicalEventDetail extends Event {
  artists: Array<{
    id: string;
    name: string;
    billingPosition: BillingPosition;
  }>;
  venue: {
    id: string;
    name: string;
    city: string;
    region?: string | null;
  } | null;
  ticketLinks: EventTicketLink[];
  promoters: Array<{
    id: string;
    name: string;
    relationshipType: PromoterRelationshipType;
  }>;
  sources: Array<{ sourceId: string; sourceUrl: string; confidence: number }>;
  fieldEvidence?: EventFieldEvidence[];
}

/**
 * Payload passed to atomic applyCanonicalization operation.
 * All operations execute within a single database transaction.
 */
export interface CanonicalizationPayload {
  venueToCreate?: {
    id?: string;
    name: string;
    normalized_name: string;
    city: string;
    region?: string | null;
    country_code?: string | null;
    timezone?: string | null;
    website?: string | null;
  } | null;
  event?: {
    id?: string;
    name?: string;
    normalized_name?: string;
    event_kind?: EventKind;
    status?: EventStatus;
    venue_id?: string | null;
    city?: string | null;
    region?: string | null;
    country_code?: string | null;
    timezone?: string;
    local_start_date?: string;
    local_end_date?: string | null;
    starts_at?: string | null;
    ends_at?: string | null;
    start_time_precision?: StartTimePrecision;
    doors_at?: string | null;
    is_multi_day?: boolean;
    official_url?: string | null;
    primary_ticket_url?: string | null;
  } | null;
  artists?: Array<{
    artist_id?: string;
    name?: string;
    normalized_name?: string;
    billing_position?: BillingPosition;
    sort_order?: number;
    external_ids?: Array<{
      provider: string;
      external_id: string;
      provider_url?: string | null;
    }>;
  }>;
  ticketLinks?: Array<{
    ticket_provider_source_id?: string | null;
    url: string;
    normalized_url: string;
    min_price?: number | null;
    max_price?: number | null;
    currency?: string | null;
    inventory_status?: TicketInventoryStatus;
    verified_at?: string | null;
  }>;
  source?: {
    source_id: string;
    candidate_id?: string | null;
    raw_ingest_id?: string | null;
    source_event_id?: string | null;
    source_url: string;
    confidence?: number;
  } | null;
  evidence?: Array<{
    field_name: string;
    source_id: string;
    raw_ingest_id?: string | null;
    candidate_id?: string | null;
    observed_value: unknown;
    value_hash?: string;
    confidence?: number;
    observed_at?: string;
    parser_version?: string;
  }>;
  resolution?: {
    event_candidate_id: string;
    status: CandidateResolution['status'];
    matcher_version?: string;
    confidence: number;
    reasons: Record<string, unknown> | string[];
  } | null;
}
