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
import type { SpotifyTopArtist } from '@/lib/domain/spotify';
import type { GenreTasteProfile } from './genre';

export type ScoringPreset = RecommendationPreset;

export type DiscoveryMode =
  'all' | 'this_weekend' | 'cheap_and_nearby' | 'worth_planning_for';

export interface ScoringWeights {
  artist: number;
  distance: number;
  price: number;
}

export type FieldEvidenceStatus = 'verified' | 'neutral_missing' | 'suppressed';

export interface FactorScore {
  factor: 'artist' | 'distance' | 'price';
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
  isSpotifyAffinity?: boolean;
  spotifyRank?: number;
}

export interface GenreMatchInfo {
  /** Genre of the event artist that matched. */
  eventGenre: string;
  /** Genre in the user's taste it matched. */
  tasteGenre: string;
  /** The user's own artist that taste genre came from. */
  similarTo: string;
  /** 0..1 weighted similarity. */
  similarity: number;
}

export interface ScoredEvent {
  eventId: string;
  event: CanonicalEventSummary;
  score: number; // Composite score 0 to 100
  factors: {
    artist: FactorScore;
    distance: FactorScore;
    price: FactorScore;
  };
  presetUsed: ScoringPreset;
  weights: ScoringWeights;
  explanation: string; // User-facing structured summary
  matchedArtist?: MatchedArtistInfo;
  isSuppressed: boolean;
  suppressionReason?: string;
  isExploratory: boolean; // True if there is no artist-fit signal (relevance gate)
  genreMatch?: GenreMatchInfo; // Present when artist fit came from Spotify genres
  diagnostics: {
    dataAvailability: {
      hasArtistMatch: boolean;
      hasPriceData: boolean;
      hasCoordinates: boolean;
      hasGenreSignal: boolean;
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
  spotifyTopArtists?: SpotifyTopArtist[];
  /** Pre-built genre taste (otherwise derived from preferences + Spotify top artists). */
  genreTasteProfile?: GenreTasteProfile;
  referenceDate?: string; // YYYY-MM-DD for deterministic time calculation
  referenceInstant?: Date | string; // Explicit instant for timezone-aware testing
  presetOverride?: ScoringPreset;
  weightsOverride?: ScoringWeights;
  /**
   * Optional runtime overrides (no UI yet). When provided they take precedence over the stored
   * profile so a future city picker / budget scale can feed the distance and price factors
   * without writing to the profile.
   */
  locationOverride?: {
    lat: number;
    lng: number;
    radiusMiles?: number | null;
  } | null;
  budgetOverride?: {
    maxSpontaneousPrice?: number | null;
    maxNormalTicketPrice?: number | null;
    maxFavoriteArtistPrice?: number | null;
  } | null;
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
