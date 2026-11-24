import { deriveLocalDateFromInstant } from '@/lib/domain/value-objects';
import { calculateWeekendWindow } from '@/lib/recommendation/modes';

/**
 * Timezone used to decide what "today" and "this weekend" mean on the public
 * Discover home. Mirrors the default used by /api/catalog/search.
 */
export const DISCOVER_TIMEZONE = 'America/Denver';

export interface DiscoverDateWindows {
  /** Local calendar date (YYYY-MM-DD) in DISCOVER_TIMEZONE. */
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

export function getDiscoverDateWindows(
  now: Date = new Date(),
  timeZone: string = DISCOVER_TIMEZONE,
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
