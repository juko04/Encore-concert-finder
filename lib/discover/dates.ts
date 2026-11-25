import { deriveLocalDateFromInstant } from '@/lib/domain/value-objects';
import { calculateWeekendWindow } from '@/lib/recommendation/modes';
import { FALLBACK_TIMEZONE } from '@/lib/location/timezone';

export interface DiscoverDateWindows {
  /** Local calendar date (YYYY-MM-DD) in the viewer's timezone. */
  today: string;
  /** today + 7 days. */
  nextWeekEnd: string;
  /** Friday–Sunday window, with the start clamped so it is never in the past. */
  weekend: { startDate: string; endDate: string };
  /** today + 30 days (start of the "plan ahead" window). */
  planAheadStart: string;
  /** today + 365 days. */
  horizonEnd: string;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Date windows ("today", "this weekend", "next 7 days", ...) in the VIEWER's timezone. Callers
 * resolve it with resolveViewerTimeZone / getViewerTimeZone (cookie -> home city -> UTC).
 */
export function getDiscoverDateWindows(
  now: Date = new Date(),
  timeZone: string = FALLBACK_TIMEZONE,
): DiscoverDateWindows {
  const today = deriveLocalDateFromInstant(now.toISOString(), timeZone);
  const rawWeekend = calculateWeekendWindow({
    referenceInstant: now,
    timeZone,
  });
  const weekend = {
    startDate: rawWeekend.startDate < today ? today : rawWeekend.startDate,
    endDate: rawWeekend.endDate,
  };

  return {
    today,
    nextWeekEnd: addDays(today, 7),
    weekend,
    planAheadStart: addDays(today, 30),
    horizonEnd: addDays(today, 365),
  };
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-31). */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** True when the IANA timezone identifier is usable by Intl. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide the lower date bound for a catalog query.
 *
 * Rule: upcoming results never include shows that have already started. A
 * requested startDate in the past (or "today", the Tonight chip) is clamped to
 * today and the repository drops same-day showtimes earlier than "now".
 * Only an explicit includePast=true (not used by any public UI) opts out.
 */
export function resolveCatalogFromDate(opts: {
  startDate?: string;
  today: string;
  includePast?: boolean;
}): { fromDate: string; excludePastShowtimes: boolean } {
  const { startDate, today, includePast } = opts;
  if (includePast) {
    return { fromDate: startDate || today, excludePastShowtimes: false };
  }
  const fromDate = startDate && startDate > today ? startDate : today;
  return { fromDate, excludePastShowtimes: true };
}

/**
 * The windows relative to an already-known local calendar date (YYYY-MM-DD), e.g. the "today"
 * a server resolved in the viewer's timezone. Evaluated at local noon so the weekend rule that
 * depends on the hour of day (Friday after 17:00) is the same for every timezone.
 */
export function getDiscoverDateWindowsForDate(
  today: string,
): DiscoverDateWindows {
  return getDiscoverDateWindows(new Date(`${today}T12:00:00Z`), 'UTC');
}
