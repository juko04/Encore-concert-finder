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
}

export interface PerformanceCandidate {
  artistName: string;
  billingPosition?: BillingPosition;
  stage?: string;
  startTime?: string;
  endTime?: string;
}

export interface CandidatePrice {
  min?: number;
  max?: number;
  currency: string;
  isFree?: boolean;
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
  isFestival?: boolean;
  eventKind?: EventKind;
  performances?: PerformanceCandidate[];
  confidence: number;
  verificationStatus?: CandidateVerificationStatus;
  resolutionStatus?: CandidateResolutionStatus;
  resolutionConfidence?: number;
  resolutionProvenance?: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
}
