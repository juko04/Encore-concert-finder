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
import { DEFAULT_PRESET, getPresetWeights } from './presets';
import type {
  FactorScore,
  RecommendationResult,
  ScoredEvent,
  ScoringContext,
  ScoringPreset,
  ScoringWeights,
} from './types';

/**
 * Scores an individual canonical event against a user's scoring context.
 */
export function scoreEvent(
  event: CanonicalEventSummary,
  context: ScoringContext,
): { scoredEvent: ScoredEvent; isPast: boolean } {
  const preset: ScoringPreset =
    context.presetOverride ||
    context.userProfile?.recommendationPreset ||
    DEFAULT_PRESET;

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
    maxNormalTicketPrice: context.userProfile?.maxNormalTicketPrice,
    maxFavoriteArtistPrice: context.userProfile?.maxFavoriteArtistPrice,
    maxSpontaneousPrice: context.userProfile?.maxSpontaneousPrice,
    artistPreferenceLevel: artistResult.matchedArtist?.preferenceLevel,
  });

  // 4. Timing Suitability Factor
  const timingResult = calculateTimingFactor({
    localStartDate: event.localStartDate,
    referenceDate: context.referenceDate,
    startsAt: event.startsAt,
    timezone: event.timezone,
    preferredDays: context.timingPreferences?.preferredDays,
  });

  // Assemble full factor scores with weights and contributions
  const artistFactor: FactorScore = {
    ...artistResult.factorScore,
    weight: weights.artist,
    weightedContribution:
      Math.round(
        ((artistResult.factorScore.score * weights.artist) / 100) * 10,
      ) / 10,
  };

  const distanceFactor: FactorScore = {
    ...distanceResult.factorScore,
    weight: weights.distance,
    weightedContribution:
      Math.round(
        ((distanceResult.factorScore.score * weights.distance) / 100) * 10,
      ) / 10,
  };

  const priceFactor: FactorScore = {
    ...priceResult.factorScore,
    weight: weights.price,
    weightedContribution:
      Math.round(((priceResult.factorScore.score * weights.price) / 100) * 10) /
      10,
  };

  const timingFactor: FactorScore = {
    ...timingResult.factorScore,
    weight: weights.timing,
    weightedContribution:
      Math.round(
        ((timingResult.factorScore.score * weights.timing) / 100) * 10,
      ) / 10,
  };

  // Check event status suppression
  let isSuppressed = artistResult.isSuppressed;
  let suppressionReason = artistResult.suppressionReason;

  if (event.status === 'cancelled' || event.status === 'postponed') {
    isSuppressed = true;
    suppressionReason = `Event is ${event.status}`;
  }

  // Composite score calculation (0 to 100)
  const rawComposite =
    artistFactor.weightedContribution +
    distanceFactor.weightedContribution +
    priceFactor.weightedContribution +
    timingFactor.weightedContribution;

  const score = isSuppressed
    ? 0
    : Math.min(100, Math.max(0, Math.round(rawComposite * 10) / 10));

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
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (b.factors.artist.score !== a.factors.artist.score) {
    return b.factors.artist.score - a.factors.artist.score;
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
  const preset: ScoringPreset =
    context.presetOverride ||
    context.userProfile?.recommendationPreset ||
    DEFAULT_PRESET;

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
