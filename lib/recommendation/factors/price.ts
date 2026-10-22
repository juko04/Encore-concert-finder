/**
 * Factor 3: Ticket Price Affordability Scoring
 * Evaluates ticket prices against user budget thresholds and artist affinity elasticity.
 *
 * Invariants:
 * 1. Missing prices must NEVER be treated as zero-cost tickets; returns neutral score (50).
 * 2. Favorite artists justify higher willingness to pay (max_favorite_artist_price).
 * 3. Free events (minPrice === 0 or eventKind === 'free_event') score 100.
 * 4. Bounded strictly to [0, 100].
 */

import type { EventKind } from '@/lib/domain/catalog';
import type { PreferenceLevel } from '@/lib/domain/user-preference';
import type { FactorScore } from '../types';

export interface PriceFactorInput {
  minPrice?: number | null;
  maxPrice?: number | null;
  currency?: string | null;
  eventKind?: EventKind | null;
  maxNormalTicketPrice?: number | null;
  maxFavoriteArtistPrice?: number | null;
  maxSpontaneousPrice?: number | null;
  artistPreferenceLevel?: PreferenceLevel | null;
}

export interface PriceFactorResult {
  factorScore: Omit<FactorScore, 'weight' | 'weightedContribution'>;
  minPrice: number | null;
  budgetCeiling: number;
}

export const DEFAULT_NORMAL_BUDGET = 60;
export const DEFAULT_FAVORITE_BUDGET = 150;
export const DEFAULT_SPONTANEOUS_BUDGET = 30;
export const NEUTRAL_PRICE_SCORE = 50;

/**
 * Evaluates ticket affordability based on known verified prices and user profile thresholds.
 */
export function calculatePriceFactor(
  input: PriceFactorInput,
): PriceFactorResult {
  const {
    minPrice,
    currency,
    eventKind,
    maxNormalTicketPrice,
    maxFavoriteArtistPrice,
    maxSpontaneousPrice,
    artistPreferenceLevel,
  } = input;

  // Determine user budget ceiling based on artist tier
  let budgetCeiling: number;
  if (artistPreferenceLevel === 'favorite') {
    budgetCeiling =
      maxFavoriteArtistPrice && maxFavoriteArtistPrice > 0
        ? maxFavoriteArtistPrice
        : DEFAULT_FAVORITE_BUDGET;
  } else if (
    artistPreferenceLevel === 'like' ||
    artistPreferenceLevel === 'interested'
  ) {
    budgetCeiling =
      maxNormalTicketPrice && maxNormalTicketPrice > 0
        ? maxNormalTicketPrice
        : DEFAULT_NORMAL_BUDGET;
  } else {
    // Unmarked / exploratory
    budgetCeiling =
      maxSpontaneousPrice && maxSpontaneousPrice > 0
        ? maxSpontaneousPrice
        : maxNormalTicketPrice && maxNormalTicketPrice > 0
          ? maxNormalTicketPrice
          : DEFAULT_SPONTANEOUS_BUDGET;
  }

  // Free show check
  if (minPrice === 0 || eventKind === 'free_event') {
    return {
      factorScore: {
        factor: 'price',
        score: 100,
        isAvailable: true,
        fieldStatus: 'verified',
        explanation: 'Free event (no admission cost)',
        diagnostics: {
          isFree: true,
          minPrice: 0,
          budgetCeiling,
        },
      },
      minPrice: 0,
      budgetCeiling,
    };
  }

  // Invariant 1: Missing price must NEVER be treated as zero-cost
  if (minPrice === null || minPrice === undefined || isNaN(minPrice)) {
    return {
      factorScore: {
        factor: 'price',
        score: NEUTRAL_PRICE_SCORE,
        isAvailable: false,
        fieldStatus: 'neutral_missing',
        explanation: 'Price TBA / not yet verified (neutral factor score)',
        diagnostics: {
          hasPrice: false,
          fallbackScore: NEUTRAL_PRICE_SCORE,
          budgetCeiling,
        },
      },
      minPrice: null,
      budgetCeiling,
    };
  }

  const price = Math.max(0, minPrice);
  const curr = currency ? ` ${currency}` : '';

  let score: number;
  let explanation: string;

  if (price <= 0.5 * budgetCeiling) {
    // Exceptional value: 100
    score = 100;
    explanation = `Exceptional value: tickets from $${price}${curr} (comfortably under your $${budgetCeiling} threshold)`;
  } else if (price <= budgetCeiling) {
    // Comfortably under budget: scales smoothly from 100 down to 75
    const ratio = (price - 0.5 * budgetCeiling) / (0.5 * budgetCeiling);
    score = 100 - 25 * ratio;
    explanation = `Under budget: tickets from $${price}${curr} (within your $${budgetCeiling} threshold)`;
  } else if (price <= 1.5 * budgetCeiling) {
    // Moderately over budget: scales from 75 down to 40
    const ratio = (price - budgetCeiling) / (0.5 * budgetCeiling);
    score = 75 - 35 * ratio;
    explanation = `Slightly exceeds budget: tickets from $${price}${curr} (above your $${budgetCeiling} threshold)`;
  } else if (price <= 2.0 * budgetCeiling) {
    // Significantly over budget: scales from 40 down to 15
    const ratio = (price - 1.5 * budgetCeiling) / (0.5 * budgetCeiling);
    score = 40 - 25 * ratio;
    explanation = `Expensive: tickets from $${price}${curr} (well above your $${budgetCeiling} threshold)`;
  } else {
    // Over double budget: floor at 5
    score = 5;
    explanation = `Prohibitive cost: tickets from $${price}${curr} (more than double your $${budgetCeiling} threshold)`;
  }

  const boundedScore = Math.min(100, Math.max(0, Math.round(score * 10) / 10));

  return {
    factorScore: {
      factor: 'price',
      score: boundedScore,
      isAvailable: true,
      fieldStatus: 'verified',
      explanation,
      diagnostics: {
        price,
        budgetCeiling,
        artistTier: artistPreferenceLevel ?? 'unmarked',
      },
    },
    minPrice: price,
    budgetCeiling,
  };
}
