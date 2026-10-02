import type { SourceProvenance } from './source';

export type BillingPosition =
  'headliner' | 'subheadliner' | 'mid_card' | 'support' | 'unknown';

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

export interface EventCandidate {
  id?: string;
  provenance: SourceProvenance;
  title: string;
  artistNames: string[];
  venueName: string;
  city?: string;
  state?: string;
  country?: string;
  timezone?: string;
  startsAt?: string;
  endsAt?: string;
  doorsOpenAt?: string;
  ticketUrl?: string;
  price?: CandidatePrice;
  isFestival?: boolean;
  performances?: PerformanceCandidate[];
  confidence: number;
  verificationStatus?: CandidateVerificationStatus;
  rawPayload?: Record<string, unknown>;
}
