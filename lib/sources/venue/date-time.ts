import { validateIanaTimezone } from '@/lib/domain/value-objects';
import type { ParsedTimeInfo } from './types';

const MONTH_MAP: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

/**
 * Parses time text like "Doors: 7 pm | Show: 8 pm" into 24-hour time strings.
 */
export function parseTimeText(timeText?: string | null): ParsedTimeInfo {
  if (!timeText || typeof timeText !== 'string') {
    return { showTime: null, doorTime: null };
  }

  function parse12hTo24h(timeStr?: string): string | null {
    if (!timeStr) return null;
    const match = timeStr.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (!match) return null;

    let hour = parseInt(match[1], 10);
    const minute = match[2] ? parseInt(match[2], 10) : 0;
    const meridiem = match[3].toLowerCase();

    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  }

  let doorTime: string | null = null;
  let showTime: string | null = null;

  // 1. Check for explicit Doors time
  const doorMatch = timeText.match(
    /doors?[:\s]+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i,
  );
  if (doorMatch) {
    doorTime = parse12hTo24h(doorMatch[1]);
  }

  // 2. Check for explicit Show time
  const showMatch = timeText.match(
    /(?:show|starts?)[:\s]+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i,
  );
  if (showMatch) {
    showTime = parse12hTo24h(showMatch[1]);
  } else {
    // If no explicit "show:", look for general time that doesn't match doors
    const allTimes = Array.from(
      timeText.matchAll(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))/gi),
    );
    if (allTimes.length === 1 && !doorMatch) {
      showTime = parse12hTo24h(allTimes[0][1]);
    } else if (allTimes.length >= 2 && doorMatch) {
      // The second time is usually the show time
      const secondTime = allTimes.find(
        (t) => t[1].toLowerCase() !== doorMatch[1].toLowerCase(),
      );
      if (secondTime) {
        showTime = parse12hTo24h(secondTime[1]);
      }
    }
  }

  return { showTime, doorTime, rawText: timeText };
}

/**
 * Converts a calendar date (YYYY-MM-DD) and local time (HH:mm:ss) in a given IANA
 * timezone into an authoritative UTC ISO string.
 *
 * Uses Intl wall-clock adjustment to accurately respect DST transitions without
 * naive UTC string slicing.
 */
export function localDateTimeToUtcInstant(
  localDate: string,
  localTime: string,
  timeZone: string = 'America/Denver',
): string {
  if (!validateIanaTimezone(timeZone)) {
    throw new Error(`Invalid IANA timezone: ${timeZone}`);
  }

  const dateParts = localDate.split('-').map(Number);
  if (dateParts.length !== 3 || dateParts.some(isNaN)) {
    throw new Error(
      `Invalid localDate format (expected YYYY-MM-DD): ${localDate}`,
    );
  }

  const timeParts = localTime.split(':').map(Number);
  if (timeParts.length < 2 || timeParts.some(isNaN)) {
    throw new Error(
      `Invalid localTime format (expected HH:mm[:ss]): ${localTime}`,
    );
  }

  const [year, month, day] = dateParts;
  const [hour, minute, second = 0] = timeParts;

  // Approximate UTC instant assuming nominal offset
  const approxUtc = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second),
  );

  // Format approxUtc in target timeZone to measure actual wall-clock disparity
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const parts = dtf.formatToParts(approxUtc);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const targetWallMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const formattedWallMs = Date.UTC(
    Number(partMap.year),
    Number(partMap.month) - 1,
    Number(partMap.day),
    partMap.hour === '24' ? 0 : Number(partMap.hour),
    Number(partMap.minute),
    Number(partMap.second || 0),
  );

  const diffMs = targetWallMs - formattedWallMs;
  const exactDate = new Date(approxUtc.getTime() + diffMs);

  return exactDate.toISOString();
}

/**
 * Combines a month/year separator (e.g. "November 2026") and day string (e.g. "Sat, Nov 07")
 * into a standardized YYYY-MM-DD date string.
 */
export function parseDateString(
  monthYearSeparator?: string | null,
  dateText?: string | null,
): string | null {
  if (!dateText) return null;

  let year = new Date().getFullYear();
  let defaultMonth: string | null = null;

  if (monthYearSeparator) {
    const ym = monthYearSeparator.match(/\b(20\d{2})\b/);
    if (ym) {
      year = parseInt(ym[1], 10);
    }

    const mm = monthYearSeparator.match(/\b([a-zA-Z]{3,9})\b/i);
    if (mm && MONTH_MAP[mm[1].toLowerCase()]) {
      defaultMonth = MONTH_MAP[mm[1].toLowerCase()];
    }
  }

  // 1. Try "Sat, Nov 07" or "Nov 07" or "November 7th"
  const match = dateText.match(
    /(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?/i,
  );
  if (match) {
    const monthNum = MONTH_MAP[match[1].toLowerCase()];
    if (monthNum) {
      const day = String(parseInt(match[2], 10)).padStart(2, '0');
      return `${year}-${monthNum}-${day}`;
    }
  }

  // 2. Try day-first "07 Nov" or "7th November"
  const altMatch = dateText.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})/i);
  if (altMatch) {
    const monthNum = MONTH_MAP[altMatch[2].toLowerCase()];
    if (monthNum) {
      const day = String(parseInt(altMatch[1], 10)).padStart(2, '0');
      return `${year}-${monthNum}-${day}`;
    }
  }

  // 3. If only day number is in dateText (e.g. "07") and defaultMonth is known
  const dayOnlyMatch = dateText.match(/\b(\d{1,2})\b/);
  if (dayOnlyMatch && defaultMonth) {
    const day = String(parseInt(dayOnlyMatch[1], 10)).padStart(2, '0');
    return `${year}-${defaultMonth}-${day}`;
  }

  return null;
}
