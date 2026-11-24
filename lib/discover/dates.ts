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
