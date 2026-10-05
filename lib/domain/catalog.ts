/**
 * Phase 1 Canonical Catalog Domain Entities and DTOs
 * Distinct from database row representations.
 */

import type { BillingPosition } from './event-candidate';
export type { BillingPosition };

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

export type TicketInventoryStatus =
  'available' | 'low_inventory' | 'sold_out' | 'presale' | 'unknown';

export type PromoterRelationshipType =
  'promoter' | 'presenter' | 'producer' | 'unknown';

export type CandidateResolutionStatus =
  'created' | 'matched' | 'needs_review' | 'rejected';

export interface Artist {
  id: string;
  name: string;
  normalizedName: string;
  imageUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtistExternalId {
  id: string;
  artistId: string;
  provider: string;
  externalId: string;
  providerUrl?: string | null;
  createdAt?: string;
}

export interface Venue {
  id: string;
  name: string;
  normalizedName: string;
  city: string;
  region?: string | null;
  countryCode: string;
  lat?: number | null;
  lng?: number | null;
  timezone?: string | null;
  website?: string | null;
  capacity?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Promoter {
  id: string;
  name: string;
  normalizedName: string;
  website?: string | null;
  calendarUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  id: string;
  name: string;
  normalizedName: string;
  eventKind: EventKind;
  status: EventStatus;
  venueId?: string | null;
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
  createdAt: string;
  updatedAt: string;
}

export interface EventArtist {
  id: string;
  eventId: string;
  artistId: string;
  artist?: Artist;
  billingPosition: BillingPosition;
  sortOrder: number;
  createdAt: string;
}

export interface EventPromoter {
  id: string;
  eventId: string;
  promoterId: string;
  promoter?: Promoter;
  relationshipType: PromoterRelationshipType;
  createdAt: string;
}

export interface EventTicketLink {
  id: string;
  eventId: string;
  ticketProviderSourceId?: string | null;
  url: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  currency?: string | null;
  inventoryStatus: TicketInventoryStatus;
  verifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventSourceRecord {
  id: string;
  eventId: string;
  sourceId: string;
  candidateId?: string | null;
  rawIngestId?: string | null;
  sourceEventId?: string | null;
  sourceUrl: string;
  confidence: number;
  firstSeenAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventFieldEvidence {
  id: string;
  eventId: string;
  fieldName: string;
  eventSourceId: string;
  observedValue: unknown;
  valueHash: string;
  confidence: number;
  observedAt: string;
  parserVersion: string;
  createdAt: string;
}

export interface CandidateResolution {
  id: string;
  eventCandidateId: string;
  eventId?: string | null;
  status: CandidateResolutionStatus;
  matcherVersion: string;
  confidence: number;
  reasons: Record<string, unknown> | string[];
  resolvedAt: string;
  createdAt: string;
}

/**
 * Server-rendered Data Transfer Objects (DTOs) for catalog views
 */
export interface CanonicalEventSummary {
  id: string;
  name: string;
  eventKind: EventKind;
  status: EventStatus;
  venue?: {
    id: string;
    name: string;
    city: string;
    region?: string | null;
  } | null;
  artists: Array<{
    id: string;
    name: string;
    billingPosition: BillingPosition;
  }>;
  localStartDate: string;
  localEndDate?: string | null;
  startsAt?: string | null;
  timezone: string;
  startTimePrecision: StartTimePrecision;
  isMultiDay: boolean;
  minPrice?: number | null;
  maxPrice?: number | null;
  currency?: string | null;
  primaryTicketUrl?: string | null;
  sources: Array<{
    sourceId: string;
    sourceName?: string;
    sourceUrl: string;
    confidence: number;
  }>;
}

export interface CanonicalEventDetail extends CanonicalEventSummary {
  ticketLinks: EventTicketLink[];
  promoters: Array<{
    id: string;
    name: string;
    relationshipType: PromoterRelationshipType;
  }>;
  officialUrl?: string | null;
  doorsAt?: string | null;
  endsAt?: string | null;
}
