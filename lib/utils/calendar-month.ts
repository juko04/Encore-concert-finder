/**
 * Pure helpers for choosing which month the /calendar view opens on.
 * The default is always the current month (never the first event's month).
 */

export interface CalendarAnchor {
  year: number;
  /** 0-indexed month */
  month: number;
  /** YYYY-MM-DD highlighted day */
  selectedDate: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Formats a Date's local calendar day as YYYY-MM-DD. */
export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parses "YYYY-MM" (as used by ?month=). Returns null when invalid. */
export function parseMonthParam(
  value: string | null | undefined,
): { year: number; month: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value.trim());
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1 };
}

/**
 * Resolves the calendar anchor. Precedence: explicit referenceDate
 * (YYYY-MM-DD), then a valid ?month=YYYY-MM param, then `now`.
 */
export function resolveCalendarAnchor(options: {
  now: Date;
  referenceDate?: string | null;
  monthParam?: string | null;
}): CalendarAnchor {
  const { now, referenceDate, monthParam } = options;
  if (referenceDate && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
    const [y, m] = referenceDate.split('-').map(Number);
    return { year: y, month: m - 1, selectedDate: referenceDate };
  }
  const parsed = parseMonthParam(monthParam);
  if (parsed) {
    const isNowMonth =
      parsed.year === now.getFullYear() && parsed.month === now.getMonth();
    return {
      ...parsed,
      selectedDate: isNowMonth
        ? formatLocalDate(now)
        : `${parsed.year}-${pad(parsed.month + 1)}-01`,
    };
  }
  return {
    year: now.getFullYear(),
    month: now.getMonth(),
    selectedDate: formatLocalDate(now),
  };
}
