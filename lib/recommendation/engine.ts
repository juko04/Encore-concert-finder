/**
 * Recommendation Scoring Engine
 * Pure, deterministic, multi-factor ranking coordinator for canonical events.
 *
 * Scoring Formula:
 *   Composite Score = (S_artist * W_artist + S_dist * W_dist + S_price * W_price) / 100
 *
 * Invariants:
 * 1. Zero ML black-box scoring; 100% deterministic and unit-testable.
 * 2. Relevance gate: events with no artist-fit signal (no preference, Spotify or genre match)
 *    are partitioned into a separate exploratory section regardless of price/distance.
 * 3. Not-interested artists or cancelled events are suppressed.
 * 4. Deduplication: Duplicate canonical event IDs are rejected / deduplicated.
 * 5. Stable tie-breaking: score desc -> artistScore desc -> localStartDate asc -> id asc.
 */

import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import { calculateArtistInterestFactor } from './factors/artist-interest';
import { calculateDistanceFactor, isValidCoordinate } from './factors/distance';
import { findCityByName } from '@/lib/location/cities';
import { calculatePriceFactor } from './factors/price';
import { checkEventEligibility } from './factors/eligibility';
import { buildGenreTasteProfile } from './genre';
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
  const weights: ScoringWeights =
    context.weightsOverride ?? getPresetWeights(preset);

  // 1. Artist Interest Factor
  const artistResult = calculateArtistInterestFactor(
    event.artists,
    context.artistPreferences,
    context.spotifyTopArtists,
    context.genreTasteProfile ??
      buildGenreTasteProfile({
        artistPreferences: context.artistPreferences,
        spotifyTopArtists: context.spotifyTopArtists,
      }),
  );

  const isFavorite = artistResult.matchedArtist?.isFavorite ?? false;

  // 2. Distance Factor
  // Many events lack venue coordinates. Fall back to the city centroid so a
  // chosen home city still produces a distance signal; flagged as approximate.
  let eventLat = event.lat;
  let eventLng = event.lng;
  let cityLevelApprox = false;
  if (!isValidCoordinate(eventLat, eventLng)) {
    const city = findCityByName(event.city, event.region);
    if (city) {
      eventLat = city.lat;
      eventLng = city.lng;
      cityLevelApprox = true;
    }
  }

  const distanceResult = calculateDistanceFactor({
    userLat:
      context.locationOverride?.lat ?? context.userProfile?.homeLatApprox,
    userLng:
      context.locationOverride?.lng ?? context.userProfile?.homeLngApprox,
    venueLat: eventLat,
    venueLng: eventLng,
    preferredRadiusMiles:
      context.locationOverride?.radiusMiles ??
      context.userProfile?.defaultRadiusMiles,
    isFavoriteArtist: isFavorite,
  });

  // 3. Ticket Price Affordability Factor
  const priceResult = calculatePriceFactor({
    minPrice: event.minPrice,
    maxPrice: event.maxPrice,
    currency: event.currency,
    eventKind: event.eventKind,
    maxNormalTicketPrice:
      context.budgetOverride?.maxNormalTicketPrice ??
      context.userProfile?.maxNormalTicketPrice,
    maxFavoriteArtistPrice:
      context.budgetOverride?.maxFavoriteArtistPrice ??
      context.userProfile?.maxFavoriteArtistPrice,
    maxSpontaneousPrice:
      context.budgetOverride?.maxSpontaneousPrice ??
      context.userProfile?.maxSpontaneousPrice,
    artistPreferenceLevel: artistResult.matchedArtist?.preferenceLevel,
  });

  // 4. Eligibility (past events are excluded; this is not a scored factor)
  const eligibility = checkEventEligibility({
    localStartDate: event.localStartDate,
    startsAt: event.startsAt,
    timezone: event.timezone,
    startTimePrecision: event.startTimePrecision,
    referenceDate: context.referenceDate,
    referenceInstant: context.referenceInstant,
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
    diagnostics: cityLevelApprox
      ? {
          ...(distanceResult.factorScore.diagnostics ?? {}),
          locationPrecision: 'city_level_approximation',
        }
      : distanceResult.factorScore.diagnostics,
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
    priceFactor.weightedContribution;

  const score = isSuppressed ? 0 : clampScore(rawComposite, 50);

  const explanation = buildRecommendationExplanation({
    artistFactor,
    distanceFactor,
    priceFactor,
    genreMatch: artistResult.genreMatch,
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
    },
    presetUsed: preset,
    weights,
    explanation,
    matchedArtist: artistResult.matchedArtist,
    isSuppressed,
    suppressionReason,
    isExploratory: artistResult.isExploratory,
    genreMatch: artistResult.genreMatch,
    diagnostics: {
      dataAvailability: {
        hasArtistMatch: artistFactor.isAvailable,
        hasPriceData: priceFactor.isAvailable,
        hasCoordinates: distanceFactor.isAvailable,
        hasGenreSignal: artistResult.genreMatch !== undefined,
      },
      rawMetrics: {
        distanceMiles: distanceResult.distanceMiles,
        minPrice: priceResult.minPrice,
        budgetCeiling: priceResult.budgetCeiling,
      },
    },
  };

  return { scoredEvent, isPast: eligibility.isPast };
}

/**
 * Deterministic tie-breaker function for scored events:
 * 1. Score descending
 * 2. Artist factor score descending
 * 3. Local start date ascending (sooner shows first)
 * 4. Event ID ascending (lexicographical)
 */
export function compareFeedOrder(a: ScoredEvent, b: ScoredEvent): number {
  // Relevance tier first: events with an artist-fit signal always precede exploratory ones
  if (a.isExploratory !== b.isExploratory) return a.isExploratory ? 1 : -1;
  return compareScoredEvents(a, b);
}

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
  const weights = context.weightsOverride ?? getPresetWeights(preset);

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
