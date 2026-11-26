/** Display helpers shared by the catalog and personalized discover event cards. */

const UNKNOWN_VENUE_NAMES = new Set([
  'unknown venue',
  'venue tba',
  'venue tba / unknown',
]);

/** Venue name to show, or null when it is blank or a placeholder such as "Venue TBA". */
export function getDisplayVenueName(
  rawVenueName?: string | null,
): string | null {
  const trimmed = rawVenueName?.trim();
  if (!trimmed || UNKNOWN_VENUE_NAMES.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

const TIME_TBA = 'Time TBA (Date confirmed)';

/** Venue-local show time, or a TBA label when the time is unknown / date-only. */
export function formatEventShowTime(event: {
  startsAt?: string | null;
  startTimePrecision?: string | null;
  timezone?: string | null;
}): string {
  if (event.startTimePrecision === 'date_only' || !event.startsAt) {
    return TIME_TBA;
  }
  try {
    return new Date(event.startsAt).toLocaleTimeString('en-US', {
      timeZone: event.timezone ?? undefined,
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return TIME_TBA;
  }
}
