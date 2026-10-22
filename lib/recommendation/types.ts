/**
 * Recommendation Scoring Domain Types
 * Defines the core factor scores, weights, presets, explanations,
 * and structured results for the Encore recommendation engine.
 * Pure, deterministic, and typed.
 */

import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type {
  PreferenceLevel,
  UserArtistPreference,
} from '@/lib/domain/user-preference';
import type { RecommendationPreset, UserProfile } from '@/lib/domain/profile';

export type ScoringPreset = RecommendationPreset;

export interface ScoringWeights {
  artist: number;
  distance: number;
  price: number;
  timing: number;
}

export type FieldEvidenceStatus = 'verified' | 'neutral_missing' | 'suppressed';

export interface FactorScore {
  factor: 'artist' | 'distance' | 'price' | 'timing';
  score: number; // 0 to 100
  weight: number; // Weight percentage (e.g. 50)
  weightedContribution: number; // (score * weight) / 100
  isAvailable: boolean; // True if real data was available; false if neutral fallback
  fieldStatus: FieldEvidenceStatus;
  explanation: string;
  diagnostics?: Record<string, unknown>;
}

export interface MatchedArtistInfo {
  id?: string;
  name: string;
  preferenceLevel: PreferenceLevel;
  score: number;
  isFavorite: boolean;
  isDisliked: boolean;
}

export interface ScoredEvent {
  eventId: string;
  event: CanonicalEventSummary;
  score: number; // Composite score 0 to 100
  factors: {
    artist: FactorScore;
    distance: FactorScore;
    price: FactorScore;
    timing: FactorScore;
  };
  presetUsed: ScoringPreset;
  weights: ScoringWeights;
  explanation: string; // User-facing structured summary
  matchedArtist?: MatchedArtistInfo;
  isSuppressed: boolean;
  suppressionReason?: string;
  isExploratory: boolean; // True if artist is unmarked (exploratory candidate)
  diagnostics: {
    dataAvailability: {
      hasArtistMatch: boolean;
      hasPriceData: boolean;
      hasCoordinates: boolean;
      hasTimingPreferences: boolean;
    };
    rawMetrics: {
      distanceMiles?: number | null;
      minPrice?: number | null;
      budgetCeiling?: number | null;
    };
  };
}

export interface ScoringContext {
  userProfile?: UserProfile | null;
  artistPreferences: UserArtistPreference[];
  referenceDate?: string; // YYYY-MM-DD for deterministic time calculation
  presetOverride?: ScoringPreset;
  timingPreferences?: {
    preferredDays?: string[]; // e.g. ['friday', 'saturday', 'sunday']
  };
}

export interface RecommendationResult {
  recommendations: ScoredEvent[]; // Primary recommendations (matched interests, unsuppressed)
  exploratory: ScoredEvent[]; // Unfamiliar artists with strong price/distance/venue fit
  suppressed: ScoredEvent[]; // Suppressed events (e.g. Not Interested artist)
  ineligibleCount: number; // Past or cancelled/postponed events
  totalScored: number;
  preset: ScoringPreset;
  weights: ScoringWeights;
}
