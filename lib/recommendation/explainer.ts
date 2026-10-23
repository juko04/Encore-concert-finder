/**
 * Recommendation Explainer
 * Generates transparent, human-readable rationales for why an event is recommended.
 * Separates end-user explanations from developer diagnostics.
 *
 * Invariant: Never claims uncalibrated probability or statistical certainty.
 */

import type { FactorScore, MatchedArtistInfo } from './types';

export interface ExplainerInput {
  artistFactor: FactorScore;
  distanceFactor: FactorScore;
  priceFactor: FactorScore;
  timingFactor: FactorScore;
  matchedArtist?: MatchedArtistInfo;
  isSuppressed: boolean;
  suppressionReason?: string;
  isExploratory: boolean;
}

/**
 * Builds a concise, informative multi-factor summary line for the user.
 */
export function buildRecommendationExplanation(input: ExplainerInput): string {
  if (input.isSuppressed && input.suppressionReason) {
    return input.suppressionReason;
  }

  const parts: string[] = [];

  // 1. Artist interest part
  if (input.matchedArtist) {
    if (input.matchedArtist.preferenceLevel === 'favorite') {
      parts.push(`★ Favorite artist (${input.matchedArtist.name})`);
    } else if (input.matchedArtist.preferenceLevel === 'like') {
      parts.push(`♥ Liked artist (${input.matchedArtist.name})`);
    } else if (input.matchedArtist.preferenceLevel === 'interested') {
      parts.push(`Interested (${input.matchedArtist.name})`);
    }
  } else if (input.isExploratory) {
    parts.push('Unfamiliar artist (exploratory)');
  }

  // 2. Distance part
  if (input.distanceFactor.isAvailable) {
    const distMiles = input.distanceFactor.diagnostics?.distanceMiles as
      number | undefined;
    if (distMiles !== undefined && distMiles !== null) {
      if (input.distanceFactor.score >= 70) {
        parts.push(`Close to home (${Math.round(distMiles)} mi)`);
      } else {
        parts.push(`${Math.round(distMiles)} mi away`);
      }
    }
  } else {
    parts.push('Location neutral');
  }

  // 3. Price part
  if (input.priceFactor.isAvailable) {
    const isFree = input.priceFactor.diagnostics?.isFree as boolean | undefined;
    const price = input.priceFactor.diagnostics?.price as number | undefined;

    if (isFree) {
      parts.push('Free event');
    } else if (price !== undefined && price !== null) {
      if (input.priceFactor.score >= 75) {
        parts.push(`Under budget ($${price})`);
      } else if (input.priceFactor.score >= 40) {
        parts.push(`Tickets from $${price}`);
      } else {
        parts.push(`Above budget ($${price})`);
      }
    }
  } else {
    parts.push('Price TBA');
  }

  // 4. Timing part (if customized)
  if (input.timingFactor.isAvailable) {
    const day = input.timingFactor.diagnostics?.dayOfWeek as string | undefined;
    if (day && input.timingFactor.score >= 70) {
      const capitalized = day.charAt(0).toUpperCase() + day.slice(1);
      parts.push(`Preferred day (${capitalized})`);
    }
  }

  return parts.join(' · ');
}
