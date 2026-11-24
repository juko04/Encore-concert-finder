/**
 * User Profile Domain Types
 * Defines the private user preferences, budget thresholds, travel parameters,
 * and recommendation preset configuration.
 * Protected by Row Level Security on public.profiles.
 */

export type RecommendationPreset =
  'balanced' | 'artist_first' | 'nearby' | 'value';

export const VALID_RECOMMENDATION_PRESETS: readonly RecommendationPreset[] = [
  'balanced',
  'artist_first',
  'nearby',
  'value',
] as const;

export interface UserProfile {
  id: string;
  homeLatApprox: number | null;
  homeLngApprox: number | null;
  defaultRadiusMiles: number;
  maxSpontaneousPrice: number | null;
  maxNormalTicketPrice: number | null;
  maxFavoriteArtistPrice: number | null;
  travelWillingness: string | null;
  recommendationPreset: RecommendationPreset;
  /**
   * Optional artist-importance weight (20-80 percent). Null = use the preset's own artist weight.
   * See applyArtistWeight in lib/recommendation/presets.ts.
   */
  artistWeight?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfileUpdateInput {
  homeLatApprox?: number | null;
  homeLngApprox?: number | null;
  defaultRadiusMiles?: number | null;
  maxSpontaneousPrice?: number | null;
  maxNormalTicketPrice?: number | null;
  maxFavoriteArtistPrice?: number | null;
  travelWillingness?: string | null;
  recommendationPreset?: RecommendationPreset;
  artistWeight?: number | null;
}
