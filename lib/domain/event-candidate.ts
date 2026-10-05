import type { BillingPosition, StartTimePrecision } from './catalog';
import type { SourceProvenance } from './source';

export type { BillingPosition, StartTimePrecision };

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
  provenance: SourceProvenance;
  title: string;
  artistNames: string[];
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
  performances?: PerformanceCandidate[];
  confidence: number;
  verificationStatus?: CandidateVerificationStatus;
  resolutionStatus?: CandidateResolutionStatus;
  resolutionConfidence?: number;
  resolutionProvenance?: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
}
