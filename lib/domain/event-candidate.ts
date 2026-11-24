import type { BillingPosition, EventKind, StartTimePrecision } from './catalog';
import type { SourceProvenance } from './source';

export type { BillingPosition, EventKind, StartTimePrecision };

export interface CandidateArtistExternalId {
  provider: string;
  externalId: string;
  providerUrl?: string | null;
}

export interface CandidateArtist {
  name: string;
  billingPosition?: BillingPosition;
  sortOrder?: number;
  externalIds?: CandidateArtistExternalId[];
  /** Verified https image supplied by the source for this specific artist. */
  imageUrl?: string | null;
  /** Genres the source assigns to this performer (e.g. Ticketmaster classification). */
  genres?: string[];
}

export interface CandidatePrice {
  min?: number;
  max?: number;
  currency?: string;
  isFree?: boolean;
  feeStatus?: 'all_inclusive' | 'fees_excluded' | 'unknown';
  estimatedFees?: number;
}

export type CandidateVerificationStatus =
  'unverified' | 'corroborated' | 'rejected';

export type CandidateResolutionStatus =
  'created' | 'matched' | 'needs_review' | 'rejected';

export interface EventCandidate {
  id?: string;
  rawIngestId?: string;
  sourceId?: string;
  sourceEventId?: string;
  sourceType?: string;
  candidateFingerprint?: string;
  provenance: SourceProvenance;
  title: string;
  artistNames: string[];
  artists?: CandidateArtist[];
  venueName: string;
  city?: string;
  state?: string;
  country?: string;
  timezone?: string;
  localStartDate?: string;
  localEndDate?: string;
  startsAt?: string;
  endsAt?: string;
  startTimePrecision?: StartTimePrecision;
  doorsOpenAt?: string;
  ticketUrl?: string;
  price?: CandidatePrice;
  inventoryStatus?:
    'available' | 'low_inventory' | 'sold_out' | 'cancelled' | 'unknown';
  isFestival?: boolean;
  eventKind?: EventKind;
  confidence: number;
  verificationStatus?: CandidateVerificationStatus;
  resolutionStatus?: CandidateResolutionStatus;
  resolutionConfidence?: number;
  resolutionProvenance?: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
}

/**
 * Source-supplied images carried on `rawPayload.images` (persisted as JSON on the
 * candidate, so it survives candidate storage and replay). Absent means unknown.
 */
export interface CandidateImages {
  source: string;
  eventImageUrl?: string | null;
  venueImageUrl?: string | null;
}

export function asHttpsImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Reads and re-validates (https only) the event/venue images on a candidate. */
export function getCandidateImages(
  candidate: Pick<EventCandidate, 'rawPayload'>,
): { eventImageUrl: string | null; venueImageUrl: string | null } {
  const images = candidate.rawPayload?.images as
    Partial<CandidateImages> | undefined;
  return {
    eventImageUrl: asHttpsImageUrl(images?.eventImageUrl),
    venueImageUrl: asHttpsImageUrl(images?.venueImageUrl),
  };
}

/**
 * Event-level genres the source assigned (carried on `rawPayload.genres`, so they survive
 * candidate storage and replay). Empty when unknown: genres are never guessed.
 */
export function getCandidateGenres(
  candidate: Pick<EventCandidate, 'rawPayload'>,
): string[] {
  const raw = candidate.rawPayload?.genres;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of raw) {
    if (typeof g !== 'string') continue;
    const v = g.trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}
