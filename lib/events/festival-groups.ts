/**
 * Multi-day festival grouping (TypeScript twin of the SQL function public.refresh_festival_groups,
 * migration 20261126070000; keep the two in sync). Used by the in-memory repository and as the
 * executable specification the integration test checks the SQL against.
 *
 * A group is: same venue, same base name (day / night / weekday suffixes stripped), each day starting
 * within MAX_GAP_DAYS of the previous day's end, spanning at least two calendar days
 * (endDate > first startDate), and either (a) at least one day is classified as a festival (or
 * explicitly named "Fest" / "Festival"), or (b) the run is 3+ consecutive days (gap <= 1): big
 * festivals such as EDC are ingested as plain concerts. Weekly club nights never chain; 2-night
 * band stands and same-day doubleheaders stay separate. The first day is the group's primary card.
 */

import type { Event } from '@/lib/domain/catalog';

export const FESTIVAL_GROUP_MAX_GAP_DAYS = 3;
/** Runs of plain concerts need this many consecutive days (gap <= 1) to count as a festival. */
export const FESTIVAL_RUN_MIN_DAYS = 3;

const DAY_SUFFIX =
  /\s*[-–:(]*\s*\b((?:day|night)\s*\d+|(thurs|fri|satur|sun)day)\b.*$/;
const FESTIVAL_NAME = /\b(fest|festival)\b/i;

export function festivalBaseName(name: string): string {
  const lower = name.toLowerCase();
  const stripped = lower.replace(DAY_SUFFIX, '');
  return stripped.trim().length > 0 ? stripped : lower;
}

function dayNumber(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);
}

export interface FestivalGroup {
  primary: Event;
  members: Event[];
  /** Last local date of the run. */
  endDate: string;
}

type GroupableEvent = Pick<
  Event,
  | 'id'
  | 'name'
  | 'venueId'
  | 'eventKind'
  | 'status'
  | 'localStartDate'
  | 'localEndDate'
>;

export function groupFestivalDays<T extends GroupableEvent>(
  events: readonly T[],
): Array<{ primary: T; members: T[]; endDate: string }> {
  const buckets = new Map<string, T[]>();
  for (const e of events) {
    if (!e.venueId) continue;
    if (e.status === 'cancelled') continue;
    const key = `${e.venueId}\u0000${festivalBaseName(e.name)}`;
    const list = buckets.get(key);
    if (list) list.push(e);
    else buckets.set(key, [e]);
  }

  const groups: Array<{ primary: T; members: T[]; endDate: string }> = [];
  for (const list of buckets.values()) {
    list.sort(
      (a, b) =>
        a.localStartDate.localeCompare(b.localStartDate) ||
        a.id.localeCompare(b.id),
    );
    let current: T[] = [];
    let currentEnd = '';
    let prevEnd = '';
    let maxGap = 0;
    let anyFestival = false;
    const flush = () => {
      const accepted =
        current.length > 1 &&
        currentEnd > current[0].localStartDate &&
        (anyFestival ||
          (current.length >= FESTIVAL_RUN_MIN_DAYS && maxGap <= 1));
      if (accepted) {
        groups.push({
          primary: current[0],
          members: current,
          endDate: currentEnd,
        });
      }
    };
    for (const e of list) {
      const end = e.localEndDate || e.localStartDate;
      const gap =
        current.length > 0
          ? dayNumber(e.localStartDate) - dayNumber(prevEnd)
          : 0;
      const isFestival =
        e.eventKind === 'festival' ||
        e.eventKind === 'multi_day_festival' ||
        FESTIVAL_NAME.test(e.name);
      if (current.length > 0 && gap <= FESTIVAL_GROUP_MAX_GAP_DAYS) {
        current.push(e);
        if (end > currentEnd) currentEnd = end;
        prevEnd = end;
        maxGap = Math.max(maxGap, gap);
        anyFestival = anyFestival || isFestival;
      } else {
        flush();
        current = [e];
        currentEnd = end;
        prevEnd = end;
        maxGap = 0;
        anyFestival = isFestival;
      }
    }
    flush();
  }
  return groups;
}
