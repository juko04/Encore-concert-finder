/**
 * Factor 4: Event Timing Suitability Scoring
 * Evaluates date/day suitability against user timing preferences and filters past events
 * using timezone-aware calendar dates and confirmed start instants.
 *
 * Invariants:
 * 1. Do NOT compare local dates using UTC strings (toISOString().slice(0, 10)).
 *    Uses the event's validated IANA timezone to calculate its current local calendar date.
 * 2. If an event only has a local date and no confirmed start instant, do not invent a start time.
 *    On the day of the event, it remains eligible (isPast = false).
 * 3. If an event has a confirmed start instant (startTimePrecision === 'instant' and startsAt),
 *    compare directly against the reference instant. Already-started events are ineligible (isPast = true).
 * 4. Missing or invalid timezones use a documented conservative fallback (UTC) with diagnostic notation.
 * 5. If no availability preferences exist, apply documented neutral timing (50).
 * 6. Bounded strictly to [0, 100].
 */

import type { FactorScore } from '../types';

export interface TimingFactorInput {
  localStartDate: string; // YYYY-MM-DD
  startsAt?: string | null; // ISO 8601 UTC timestamp
  timezone?: string | null; // IANA timezone, e.g. 'America/Denver'
  startTimePrecision?: 'instant' | 'date_only';
  referenceDate?: string; // YYYY-MM-DD date or ISO instant string
  referenceInstant?: Date | string; // Explicit instant for deterministic testing
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
 * Validates whether a string is a valid IANA timezone identifier supported by Intl.
 */
export function isValidIanaTimezone(tz?: string | null): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the calendar date (YYYY-MM-DD) for a given instant in a specified IANA timezone.
 */
export function getLocalDateInTimezone(
  instant: Date,
  timeZone: string,
): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(instant);
}

/**
 * Parses YYYY-MM-DD into lowercase day of the week deterministically using UTC noon.
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
 * Evaluates timing suitability and eligibility for an event against user preferences.
 */
export function calculateTimingFactor(
  input: TimingFactorInput,
): TimingFactorResult {
  const {
    localStartDate,
    startsAt,
    timezone,
    startTimePrecision,
    referenceDate,
    referenceInstant,
    preferredDays,
  } = input;

  // 1. Resolve reference instant
  let nowInstant: Date;
  let isExplicitDateOnlyOverride = false;

  if (referenceInstant) {
    nowInstant =
      typeof referenceInstant === 'string'
        ? new Date(referenceInstant)
        : referenceInstant;
  } else if (referenceDate) {
    if (referenceDate.includes('T')) {
      nowInstant = new Date(referenceDate);
    } else {
      // YYYY-MM-DD passed as explicit calendar date for deterministic tests
      isExplicitDateOnlyOverride = true;
      const parts = referenceDate.split('-').map(Number);
      nowInstant = new Date(
        Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0),
      );
    }
  } else {
    nowInstant = new Date();
  }

  // 2. Validate and resolve event timezone
  const hasValidTz = isValidIanaTimezone(timezone);
  const effectiveTimezone = hasValidTz ? timezone! : 'UTC';

  // 3. Determine current local calendar date in the event's timezone
  const currentLocalDateInTz = isExplicitDateOnlyOverride
    ? referenceDate!
    : getLocalDateInTimezone(nowInstant, effectiveTimezone);

  // 4. Timezone-aware past/eligibility check
  let isPast = false;
  let eligibilityReason = 'future_or_today';

  // Case A: Event has confirmed start time instant
  if (
    startTimePrecision === 'instant' &&
    startsAt &&
    !isNaN(new Date(startsAt).getTime())
  ) {
    const eventInstant = new Date(startsAt);
    if (eventInstant.getTime() < nowInstant.getTime()) {
      isPast = true;
      eligibilityReason = 'confirmed_start_instant_passed';
    }
  } else {
    // Case B: Date-only event or missing start instant
    // Do NOT invent a start time. On the day of the event, it remains eligible.
    if (localStartDate < currentLocalDateInTz) {
      isPast = true;
      eligibilityReason = 'calendar_day_passed_in_timezone';
    }
  }

  // 5. Day of week evaluation
  const dayOfWeek = getDayOfWeekFromDateString(localStartDate);

  // Invariant 5: If no availability preferences exist, return neutral score (50)
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
          currentLocalDateInTz,
          eventTimezone: timezone ?? 'unspecified',
          timezoneValid: hasValidTz,
          effectiveTimezone,
          dayOfWeek,
          isPast,
          eligibilityReason,
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
    explanation = `Convenient timing: event is on a preferred day (${capitalizedDay})`;
  } else {
    score = 40;
    explanation = `Event is outside your preferred days (${capitalizedDay})`;
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
        currentLocalDateInTz,
        eventTimezone: timezone ?? 'unspecified',
        timezoneValid: hasValidTz,
        effectiveTimezone,
        dayOfWeek,
        isPast,
        eligibilityReason,
        matchesPreferred,
        preferredDays,
      },
    },
    isPast,
    dayOfWeek,
  };
}
