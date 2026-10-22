/**
 * Factor 4: Event Timing Suitability Scoring
 * Evaluates date/day suitability against user timing preferences and filters past events.
 *
 * Invariants:
 * 1. If no availability preferences exist, apply documented neutral timing (50)
 *    rather than inventing weekend preferences or claiming the user is available.
 * 2. Events prior to referenceDate are flagged as past events (ineligible).
 * 3. Bounded strictly to [0, 100].
 */

import type { FactorScore } from '../types';

export interface TimingFactorInput {
  localStartDate: string; // YYYY-MM-DD
  referenceDate?: string; // YYYY-MM-DD for deterministic comparison
  startsAt?: string | null;
  timezone?: string | null;
  preferredDays?: string[] | null; // e.g. ['friday', 'saturday', 'sunday']
}

export interface TimingFactorResult {
  factorScore: Omit<FactorScore, 'weight' | 'weightedContribution'>;
  isPast: boolean;
  dayOfWeek: string;
}

export const NEUTRAL_TIMING_SCORE = 50;

const DAYS_OF_WEEK = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

/**
 * Parses YYYY-MM-DD into lowercase day of the week deterministically using UTC.
 */
export function getDayOfWeekFromDateString(dateString: string): string {
  const parts = dateString.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    return 'unknown';
  }
  const [year, month, day] = parts;
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return DAYS_OF_WEEK[d.getUTCDay()] ?? 'unknown';
}

/**
 * Evaluates timing suitability for an event against user preferences.
 */
export function calculateTimingFactor(
  input: TimingFactorInput,
): TimingFactorResult {
  const { localStartDate, referenceDate, preferredDays } = input;

  const today = referenceDate || new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const isPast = localStartDate < today;
  const dayOfWeek = getDayOfWeekFromDateString(localStartDate);

  // Invariant 1: If no availability preferences exist, return neutral score (50)
  if (
    !preferredDays ||
    preferredDays.length === 0 ||
    preferredDays.length === 7
  ) {
    return {
      factorScore: {
        factor: 'timing',
        score: NEUTRAL_TIMING_SCORE,
        isAvailable: false,
        fieldStatus: 'neutral_missing',
        explanation: 'Standard timing (no custom availability preferences set)',
        diagnostics: {
          localStartDate,
          dayOfWeek,
          isPast,
          hasPreferences: false,
        },
      },
      isPast,
      dayOfWeek,
    };
  }

  // User has explicit preferred days
  const normalizedPreferred = preferredDays.map((d) => d.toLowerCase().trim());
  const matchesPreferred = normalizedPreferred.includes(dayOfWeek);

  const capitalizedDay = dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1);

  let score: number;
  let explanation: string;

  if (matchesPreferred) {
    score = 90;
    explanation = `Convenient timing: show is on a ${capitalizedDay} (matches your schedule preferences)`;
  } else {
    score = 40;
    explanation = `Non-preferred day: show is on a ${capitalizedDay} (outside your preferred days)`;
  }

  return {
    factorScore: {
      factor: 'timing',
      score,
      isAvailable: true,
      fieldStatus: 'verified',
      explanation,
      diagnostics: {
        localStartDate,
        dayOfWeek,
        isPast,
        preferredDays: normalizedPreferred,
        matchesPreferred,
      },
    },
    isPast,
    dayOfWeek,
  };
}
