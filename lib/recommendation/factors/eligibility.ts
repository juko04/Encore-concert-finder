/**
 * Event Eligibility (past-event detection)
 *
 * The former "timing suitability" scoring factor was removed: it only ever scored the
 * day of the week and added a number users could not interpret. What remains is the
 * essential, timezone-aware check that already-started or already-finished shows are
 * never recommended.
 *
 * Invariants:
 * 1. Do NOT compare local dates using UTC strings (toISOString().slice(0, 10)).
 *    Uses the event's validated IANA timezone to calculate its current local calendar date.
 * 2. If an event only has a local date and no confirmed start instant, do not invent a start time.
 *    On the day of the event, it remains eligible (isPast = false).
 * 3. If an event has a confirmed start instant (startTimePrecision === 'instant' and startsAt),
 *    compare directly against the reference instant. Already-started events are ineligible (isPast = true).
 * 4. Missing or invalid timezones use a documented conservative fallback (UTC).
 */

export interface EligibilityInput {
  localStartDate: string; // YYYY-MM-DD
  startsAt?: string | null; // ISO 8601 UTC timestamp
  timezone?: string | null; // IANA timezone, e.g. 'America/New_York'
  startTimePrecision?: 'instant' | 'date_only';
  referenceDate?: string; // YYYY-MM-DD date or ISO instant string
  referenceInstant?: Date | string; // Explicit instant for deterministic testing
}

export interface EligibilityResult {
  isPast: boolean;
  dayOfWeek: string;
  eligibilityReason: string;
  currentLocalDateInTz: string;
  timezoneValid: boolean;
  effectiveTimezone: string;
}

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
 * Determines whether an event has already started/passed in its own timezone.
 */
export function checkEventEligibility(
  input: EligibilityInput,
): EligibilityResult {
  const {
    localStartDate,
    startsAt,
    timezone,
    startTimePrecision,
    referenceDate,
    referenceInstant,
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
  const timezoneValid = isValidIanaTimezone(timezone);
  const effectiveTimezone = timezoneValid ? timezone! : 'UTC';

  // 3. Determine current local calendar date in the event's timezone
  const currentLocalDateInTz = isExplicitDateOnlyOverride
    ? referenceDate!
    : getLocalDateInTimezone(nowInstant, effectiveTimezone);

  // 4. Timezone-aware past/eligibility check
  let isPast = false;
  let eligibilityReason = 'future_or_today';

  if (
    startTimePrecision === 'instant' &&
    startsAt &&
    !isNaN(new Date(startsAt).getTime())
  ) {
    // Case A: Event has confirmed start time instant
    const eventInstant = new Date(startsAt);
    if (eventInstant.getTime() < nowInstant.getTime()) {
      isPast = true;
      eligibilityReason = 'confirmed_start_instant_passed';
    }
  } else if (localStartDate < currentLocalDateInTz) {
    // Case B: Date-only event or missing start instant.
    // Do NOT invent a start time. On the day of the event, it remains eligible.
    isPast = true;
    eligibilityReason = 'calendar_day_passed_in_timezone';
  }

  return {
    isPast,
    dayOfWeek: getDayOfWeekFromDateString(localStartDate),
    eligibilityReason,
    currentLocalDateInTz,
    timezoneValid,
    effectiveTimezone,
  };
}
