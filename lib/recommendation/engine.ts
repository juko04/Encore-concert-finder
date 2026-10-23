/**
 * Recommendation Scoring Engine
 * Pure, deterministic, multi-factor ranking coordinator for canonical events.
 *
 * Scoring Formula:
 *   Composite Score = (S_artist * W_artist + S_dist * W_dist + S_price * W_price + S_time * W_time) / 100
 *
 * Invariants:
 * 1. Zero ML black-box scoring; 100% deterministic and unit-testable.
 * 2. Unmarked artists are partitioned into a separate exploratory section.
 * 3. Not-interested artists or cancelled events are suppressed.
 * 4. Deduplication: Duplicate canonical event IDs are rejected / deduplicated.
 * 5. Stable tie-breaking: score desc -> artistScore desc -> localStartDate asc -> id asc.
 */

import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import { calculateArtistInterestFactor } from './factors/artist-interest';
import { calculateDistanceFactor } from './factors/distance';
import { calculatePriceFactor } from './factors/price';
import { calculateTimingFactor } from './factors/timing';
import { buildRecommendationExplanation } from './explainer';
import {
  DEFAULT_PRESET,
  getPresetWeights,
  normalizeScoringPreset,
} from './presets';
import type {
  FactorScore,
  RecommendationResult,
  ScoredEvent,
  ScoringContext,
  ScoringPreset,
  ScoringWeights,
} from './types';

function clampScore(score: unknown, fallback: number = 50): number {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return fallback;
  }
  return Math.min(100, Math.max(0, Math.round(score * 10) / 10));
}

function computeWeightedContribution(score: number, weight: number): number {
  const safeS = clampScore(score);
  const safeW =
    typeof weight === 'number' && Number.isFinite(weight) ? weight : 0;
  const raw = (safeS * safeW) / 100;
  return Math.min(100, Math.max(0, Math.round(raw * 10) / 10));
}

/**
 * Scores an individual canonical event against a user's scoring context.
 */
export function scoreEvent(
  event: CanonicalEventSummary,
  context: ScoringContext,
): { scoredEvent: ScoredEvent; isPast: boolean } {
  const rawPreset =
    context.presetOverride ||
    context.userProfile?.recommendationPreset ||
    DEFAULT_PRESET;
  const preset: ScoringPreset = normalizeScoringPreset(rawPreset);
  const weights: ScoringWeights = getPresetWeights(preset);

  // 1. Artist Interest Factor
  const artistResult = calculateArtistInterestFactor(
    event.artists,
    context.artistPreferences,
  );

  const isFavorite = artistResult.matchedArtist?.isFavorite ?? false;

  // 2. Distance Factor
  const distanceResult = calculateDistanceFactor({
    userLat: context.userProfile?.homeLatApprox,
    userLng: context.userProfile?.homeLngApprox,
    venueLat: event.lat,
    venueLng: event.lng,
    preferredRadiusMiles: context.userProfile?.defaultRadiusMiles,
    isFavoriteArtist: isFavorite,
  });

  // 3. Ticket Price Affordability Factor
  const priceResult = calculatePriceFactor({
    minPrice: event.minPrice,
    maxPrice: event.maxPrice,
    currency: event.currency,
    eventKind: event.eventKind,
    maxNormalTicketPrice: context.userProfile?.maxNormalTicketPrice,
    maxFavoriteArtistPrice: context.userProfile?.maxFavoriteArtistPrice,
    maxSpontaneousPrice: context.userProfile?.maxSpontaneousPrice,
    artistPreferenceLevel: artistResult.matchedArtist?.preferenceLevel,
  });

  // 4. Timing Suitability Factor
  const timingResult = calculateTimingFactor({
    localStartDate: event.localStartDate,
    startsAt: event.startsAt,
    timezone: event.timezone,
    startTimePrecision: event.startTimePrecision,
    referenceDate: context.referenceDate,
    referenceInstant: context.referenceInstant,
    preferredDays: context.timingPreferences?.preferredDays,
  });

  // Assemble full factor scores with guaranteed finite weights and contributions
  const artistScore = clampScore(artistResult.factorScore.score, 50);
  const artistFactor: FactorScore = {
    ...artistResult.factorScore,
    score: artistScore,
    weight: weights.artist,
    weightedContribution: computeWeightedContribution(
      artistScore,
      weights.artist,
    ),
  };

  const distanceScore = clampScore(distanceResult.factorScore.score, 50);
  const distanceFactor: FactorScore = {
    ...distanceResult.factorScore,
    score: distanceScore,
    weight: weights.distance,
    weightedContribution: computeWeightedContribution(
      distanceScore,
      weights.distance,
    ),
  };

  const priceScore = clampScore(priceResult.factorScore.score, 50);
  const priceFactor: FactorScore = {
    ...priceResult.factorScore,
    score: priceScore,
    weight: weights.price,
    weightedContribution: computeWeightedContribution(
      priceScore,
      weights.price,
    ),
  };

  const timingScore = clampScore(timingResult.factorScore.score, 50);
  const timingFactor: FactorScore = {
    ...timingResult.factorScore,
    score: timingScore,
    weight: weights.timing,
    weightedContribution: computeWeightedContribution(
      timingScore,
      weights.timing,
    ),
  };

  // Check event status suppression
  let isSuppressed = artistResult.isSuppressed;
  let suppressionReason = artistResult.suppressionReason;

  if (event.status === 'cancelled' || event.status === 'postponed') {
    isSuppressed = true;
    suppressionReason = `Event is ${event.status}`;
  }

  // Composite score calculation (guaranteed finite, strictly bounded to 0-100)
  const rawComposite =
    artistFactor.weightedContribution +
    distanceFactor.weightedContribution +
    priceFactor.weightedContribution +
    timingFactor.weightedContribution;

  const score = isSuppressed ? 0 : clampScore(rawComposite, 50);

  const explanation = buildRecommendationExplanation({
    artistFactor,
    distanceFactor,
    priceFactor,
    timingFactor,
    matchedArtist: artistResult.matchedArtist,
    isSuppressed,
    suppressionReason,
    isExploratory: artistResult.isExploratory,
  });

  const scoredEvent: ScoredEvent = {
    eventId: event.id,
    event,
    score,
    factors: {
      artist: artistFactor,
      distance: distanceFactor,
      price: priceFactor,
      timing: timingFactor,
    },
    presetUsed: preset,
    weights,
    explanation,
    matchedArtist: artistResult.matchedArtist,
    isSuppressed,
    suppressionReason,
    isExploratory: artistResult.isExploratory,
    diagnostics: {
      dataAvailability: {
        hasArtistMatch: artistFactor.isAvailable,
        hasPriceData: priceFactor.isAvailable,
        hasCoordinates: distanceFactor.isAvailable,
        hasTimingPreferences: timingFactor.isAvailable,
      },
      rawMetrics: {
        distanceMiles: distanceResult.distanceMiles,
        minPrice: priceResult.minPrice,
        budgetCeiling: priceResult.budgetCeiling,
      },
    },
  };

  return { scoredEvent, isPast: timingResult.isPast };
}

/**
 * Deterministic tie-breaker function for scored events:
 * 1. Score descending
 * 2. Artist factor score descending
 * 3. Local start date ascending (sooner shows first)
 * 4. Event ID ascending (lexicographical)
 */
export function compareScoredEvents(a: ScoredEvent, b: ScoredEvent): number {
  const scoreA = Number.isFinite(a.score) ? a.score : 0;
  const scoreB = Number.isFinite(b.score) ? b.score : 0;
  if (scoreB !== scoreA) {
    return scoreB - scoreA;
  }
  const artistA = Number.isFinite(a.factors.artist.score)
    ? a.factors.artist.score
    : 0;
  const artistB = Number.isFinite(b.factors.artist.score)
    ? b.factors.artist.score
    : 0;
  if (artistB !== artistA) {
    return artistB - artistA;
  }
  if (a.event.localStartDate !== b.event.localStartDate) {
    return a.event.localStartDate.localeCompare(b.event.localStartDate);
  }
  return a.eventId.localeCompare(b.eventId);
}

/**
 * Ranks a pool of canonical events for a user and partitions them into:
 * - recommendations (primary matches)
 * - exploratory (unmarked artists)
 * - suppressed (not-interested or cancelled)
 */
export function rankEvents(
  events: CanonicalEventSummary[],
  context: ScoringContext,
): RecommendationResult {
  const rawPreset =
    context.presetOverride ||
    context.userProfile?.recommendationPreset ||
    DEFAULT_PRESET;
  const preset: ScoringPreset = normalizeScoringPreset(rawPreset);
  const weights = getPresetWeights(preset);

  // Invariant 4: Deduplicate events by ID to prevent duplicate recommendations
  const seenEventIds = new Set<string>();
  const uniqueEvents: CanonicalEventSummary[] = [];

  for (const ev of events) {
    if (!seenEventIds.has(ev.id)) {
      seenEventIds.add(ev.id);
      uniqueEvents.push(ev);
    }
  }

  const recommendations: ScoredEvent[] = [];
  const exploratory: ScoredEvent[] = [];
  const suppressed: ScoredEvent[] = [];
  let ineligibleCount = 0;

  for (const event of uniqueEvents) {
    const { scoredEvent, isPast } = scoreEvent(event, context);

    if (isPast) {
      ineligibleCount++;
      continue;
    }

    if (scoredEvent.isSuppressed) {
      suppressed.push(scoredEvent);
    } else if (scoredEvent.isExploratory) {
      exploratory.push(scoredEvent);
    } else {
      recommendations.push(scoredEvent);
    }
  }

  // Stable deterministic sorting
  recommendations.sort(compareScoredEvents);
  exploratory.sort(compareScoredEvents);
  suppressed.sort(compareScoredEvents);

  return {
    recommendations,
    exploratory,
    suppressed,
    ineligibleCount,
    totalScored: uniqueEvents.length,
    preset,
    weights,
  };
}
