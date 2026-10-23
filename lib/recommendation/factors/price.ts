/**
 * Factor 3: Ticket Price Affordability Scoring
 * Evaluates ticket prices against user budget thresholds and artist affinity elasticity.
 *
 * Invariants:
 * 1. Missing or unverified ticket prices receive neutral affordability (50).
 * 2. Invalid or negative prices must be treated as unavailable/invalid (50), not a bargain.
 * 3. Currency compatibility: User budget is denominated in USD. Non-USD currencies (CAD, EUR, etc.)
 *    or unknown currencies must NOT be compared numerically without verified conversion rates;
 *    they receive neutral affordability (50).
 * 4. Free admission: A numeric price of zero alone is NOT sufficient evidence that a show is free.
 *    Only events with verified free classification (e.g. eventKind === 'free_event') qualify as free (100).
 *    Numeric zero without verified free status is treated as unverified/neutral (50).
 * 5. Unavailable user budget: If the user profile does not specify applicable budget thresholds,
 *    affordability is neutral (50) rather than fabricating numbers.
 * 6. Favorite artist budget elasticity: If the artist is marked Favorite AND the profile configures
 *    maxFavoriteArtistPrice, that threshold is applied. Otherwise, normal budget applies.
 * 7. Bounded strictly to [0, 100].
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
  budgetCeiling: number | null;
  currency: string | null;
}

export const NEUTRAL_PRICE_SCORE = 50;

/**
 * Validates monetary ticket price: must be a finite number >= 0.
 * Rejects null, undefined, NaN, Infinity, -Infinity, and negative numbers.
 */
export function isValidPrice(price: unknown): price is number {
  return typeof price === 'number' && Number.isFinite(price) && price >= 0;
}

/**
 * Validates budget ceiling threshold: must be a finite number strictly greater than 0.
 * Rejects null, undefined, NaN, Infinity, -Infinity, 0, and negative numbers.
 */
export function isValidBudget(budget: unknown): budget is number {
  return typeof budget === 'number' && Number.isFinite(budget) && budget > 0;
}

/**
 * Evaluates ticket affordability based on verified prices, matching currency, and user profile thresholds.
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

  // 1. Check for verified free admission (canonical eventKind === 'free_event')
  if (eventKind === 'free_event') {
    const freePrice = isValidPrice(minPrice) ? minPrice : 0;
    return {
      factorScore: {
        factor: 'price',
        score: 100,
        isAvailable: true,
        fieldStatus: 'verified',
        explanation: 'Free event (verified free admission)',
        diagnostics: {
          isFree: true,
          eventKind: 'free_event',
          minPrice: freePrice,
        },
      },
      minPrice: freePrice,
      budgetCeiling: null,
      currency: currency ?? null,
    };
  }

  // 2. Missing price check
  if (minPrice === null || minPrice === undefined) {
    return {
      factorScore: {
        factor: 'price',
        score: NEUTRAL_PRICE_SCORE,
        isAvailable: false,
        fieldStatus: 'neutral_missing',
        explanation:
          'Price unavailable / not yet verified (neutral factor score)',
        diagnostics: {
          hasPrice: false,
          fallbackScore: NEUTRAL_PRICE_SCORE,
        },
      },
      minPrice: null,
      budgetCeiling: null,
      currency: currency ?? null,
    };
  }

  // 3. Invalid, negative, or non-finite price check (reject NaN, Infinity, -Infinity, minPrice < 0)
  if (!isValidPrice(minPrice)) {
    return {
      factorScore: {
        factor: 'price',
        score: NEUTRAL_PRICE_SCORE,
        isAvailable: false,
        fieldStatus: 'neutral_missing',
        explanation: 'Invalid ticket price reported (neutral factor score)',
        diagnostics: {
          hasPrice: false,
          invalidPrice: minPrice,
          fallbackScore: NEUTRAL_PRICE_SCORE,
        },
      },
      minPrice: null,
      budgetCeiling: null,
      currency: currency ?? null,
    };
  }

  // 4. Numeric zero without verified free status (eventKind !== 'free_event')
  // Cannot assume free show without trustworthy free admission classification
  if (minPrice === 0) {
    return {
      factorScore: {
        factor: 'price',
        score: NEUTRAL_PRICE_SCORE,
        isAvailable: false,
        fieldStatus: 'neutral_missing',
        explanation:
          'Price listed as $0 without verified free admission status (neutral factor score)',
        diagnostics: {
          minPrice: 0,
          unverifiedZero: true,
          eventKind: eventKind ?? 'unknown',
          fallbackScore: NEUTRAL_PRICE_SCORE,
        },
      },
      minPrice: 0,
      budgetCeiling: null,
      currency: currency ?? null,
    };
  }

  // 5. Currency verification
  // Encore user budgets are currently denominated in USD.
  // If currency is missing or non-USD (CAD, EUR, GBP, etc.), do not compare numerically without verified exchange rates.
  const normalizedCurrency = currency?.trim().toUpperCase() || null;
  if (!normalizedCurrency) {
    return {
      factorScore: {
        factor: 'price',
        score: NEUTRAL_PRICE_SCORE,
        isAvailable: false,
        fieldStatus: 'neutral_missing',
        explanation: 'Ticket currency unavailable (neutral factor score)',
        diagnostics: {
          minPrice,
          currency: null,
          reason: 'missing_currency',
        },
      },
      minPrice,
      budgetCeiling: null,
      currency: null,
    };
  }

  if (normalizedCurrency !== 'USD') {
    return {
      factorScore: {
        factor: 'price',
        score: NEUTRAL_PRICE_SCORE,
        isAvailable: false,
        fieldStatus: 'neutral_missing',
        explanation: `Currency conversion unavailable for ${normalizedCurrency} against USD budget (neutral factor score)`,
        diagnostics: {
          minPrice,
          currency: normalizedCurrency,
          reason: 'unsupported_currency_conversion',
        },
      },
      minPrice,
      budgetCeiling: null,
      currency: normalizedCurrency,
    };
  }

  // 6. User budget determination (in USD)
  // Determine applicable budget threshold based on artist tier
  // Invariant: Non-finite values (Infinity, NaN) or non-positive values must NOT be accepted as budgets
  let budgetCeiling: number | null = null;
  let budgetTier = 'none';

  if (artistPreferenceLevel === 'favorite') {
    if (isValidBudget(maxFavoriteArtistPrice)) {
      budgetCeiling = maxFavoriteArtistPrice;
      budgetTier = 'favorite';
    } else if (isValidBudget(maxNormalTicketPrice)) {
      budgetCeiling = maxNormalTicketPrice;
      budgetTier = 'normal_for_favorite';
    }
  } else if (
    artistPreferenceLevel === 'like' ||
    artistPreferenceLevel === 'interested'
  ) {
    if (isValidBudget(maxNormalTicketPrice)) {
      budgetCeiling = maxNormalTicketPrice;
      budgetTier = 'normal';
    }
  } else {
    // Unmarked / exploratory
    if (isValidBudget(maxSpontaneousPrice)) {
      budgetCeiling = maxSpontaneousPrice;
      budgetTier = 'spontaneous';
    } else if (isValidBudget(maxNormalTicketPrice)) {
      budgetCeiling = maxNormalTicketPrice;
      budgetTier = 'normal_for_unmarked';
    }
  }

  // If user profile has no applicable valid budget threshold configured, return neutral score
  if (!isValidBudget(budgetCeiling)) {
    return {
      factorScore: {
        factor: 'price',
        score: NEUTRAL_PRICE_SCORE,
        isAvailable: false,
        fieldStatus: 'neutral_missing',
        explanation: `Tickets from $${minPrice} USD (no ticket budget configured in profile)`,
        diagnostics: {
          minPrice,
          currency: 'USD',
          budgetCeiling: null,
          reason: 'no_profile_budget',
        },
      },
      minPrice,
      budgetCeiling: null,
      currency: 'USD',
    };
  }

  // 7. Calculate affordability against verified USD budget
  const price = minPrice;
  let score: number;
  let explanation: string;

  if (price <= 0.5 * budgetCeiling) {
    score = 100;
    explanation = `Exceptional value: tickets from $${price} USD (comfortably under your $${budgetCeiling} threshold)`;
  } else if (price <= budgetCeiling) {
    const ratio = (price - 0.5 * budgetCeiling) / (0.5 * budgetCeiling);
    score = 100 - 25 * ratio;
    explanation = `Under budget: tickets from $${price} USD (within your $${budgetCeiling} threshold)`;
  } else if (price <= 1.5 * budgetCeiling) {
    const ratio = (price - budgetCeiling) / (0.5 * budgetCeiling);
    score = 75 - 35 * ratio;
    explanation = `Slightly exceeds budget: tickets from $${price} USD (above your $${budgetCeiling} threshold)`;
  } else if (price <= 2.0 * budgetCeiling) {
    const ratio = (price - 1.5 * budgetCeiling) / (0.5 * budgetCeiling);
    score = 40 - 25 * ratio;
    explanation = `Expensive: tickets from $${price} USD (well above your $${budgetCeiling} threshold)`;
  } else {
    score = 5;
    explanation = `Prohibitive cost: tickets from $${price} USD (more than double your $${budgetCeiling} threshold)`;
  }

  const safeScore = Number.isFinite(score) ? score : NEUTRAL_PRICE_SCORE;
  const boundedScore = Math.min(
    100,
    Math.max(0, Math.round(safeScore * 10) / 10),
  );

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
        budgetTier,
        artistTier: artistPreferenceLevel ?? 'unmarked',
        currency: 'USD',
      },
    },
    minPrice: price,
    budgetCeiling,
    currency: 'USD',
  };
}
