import { describe, expect, it } from 'vitest';
import { CITIES } from '@/lib/location/cities';
import {
  FALLBACK_TIMEZONE,
  TIMEZONE_COOKIE,
  isValidIanaTimeZone,
  parseTimeZoneCookie,
  readTimeZoneFromCookieString,
  resolveViewerTimeZone,
  timeZoneForHome,
} from '@/lib/location/timezone';
import {
  getDiscoverDateWindows,
  getDiscoverDateWindowsForDate,
} from '@/lib/discover/dates';
import {
  calculate14DayLookaheadEndDate,
  calculateWeekendWindow,
  getZonedTimeParts,
  isEventEligibleForMode,
} from '@/lib/recommendation/modes';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';

const NY = 'America/New_York';
const LA = 'America/Los_Angeles';
const HNL = 'Pacific/Honolulu';
const LON = 'Europe/London';
const DEN = 'America/Denver';

describe('timezone validation and cookie parsing', () => {
  it('accepts real IANA names and rejects garbage', () => {
    for (const tz of [NY, LA, HNL, LON, DEN, 'UTC', 'America/Argentina/Salta'])
      expect(isValidIanaTimeZone(tz)).toBe(true);
    for (const bad of [
      '',
      ' ',
      'Mars/Olympus',
      'not a zone',
      '+01:00',
      '../etc/passwd',
      'A'.repeat(80),
      null,
      undefined,
      42,
    ])
      expect(isValidIanaTimeZone(bad)).toBe(false);
  });

  it('parses a (URL-encoded) cookie value and ignores invalid ones', () => {
    expect(parseTimeZoneCookie('America%2FNew_York')).toBe(NY);
    expect(parseTimeZoneCookie(NY)).toBe(NY);
    expect(parseTimeZoneCookie('Mars/Olympus')).toBeNull();
    expect(parseTimeZoneCookie('%E0%A4%A')).toBeNull();
    expect(parseTimeZoneCookie(undefined)).toBeNull();
    expect(
      readTimeZoneFromCookieString(
        `a=b; ${TIMEZONE_COOKIE}=${encodeURIComponent(LA)}; c=d`,
      ),
    ).toBe(LA);
    expect(readTimeZoneFromCookieString('a=b')).toBeNull();
  });
});

describe('city table timezones', () => {
  it('every city has a valid IANA timezone', () => {
    for (const c of CITIES) expect(isValidIanaTimeZone(c.timezone)).toBe(true);
  });

  it('is derived from the state, with the split states handled', () => {
    const tz = (name: string, state: string) =>
      CITIES.find((c) => c.name === name && c.state === state)?.timezone;
    expect(tz('Denver', 'CO')).toBe(DEN);
    expect(tz('Boulder', 'CO')).toBe(DEN);
    expect(tz('Salt Lake City', 'UT')).toBe(DEN);
    expect(tz('Cheyenne', 'WY')).toBe(DEN);
    expect(tz('Albuquerque', 'NM')).toBe(DEN);
    // Idaho spans two zones; IANA names its Mountain part America/Boise.
    expect(tz('Boise', 'ID')).toBe('America/Boise');
    // Kansas City exists in two states and both are Central.
    expect(tz('Kansas City', 'MO')).toBe('America/Chicago');
    expect(tz('Kansas City', 'KS')).toBe('America/Chicago');
    expect(tz('Wichita', 'KS')).toBe('America/Chicago');
  });
});

describe('resolveViewerTimeZone: cookie -> home city -> UTC', () => {
  it('prefers a valid cookie over the home city', () => {
    expect(
      resolveViewerTimeZone({
        cookieValue: NY,
        home: { city: 'Denver', state: 'CO' },
      }),
    ).toBe(NY);
  });

  it('falls back to the home city timezone when the cookie is missing or invalid', () => {
    const home = { city: 'Denver', state: 'CO' };
    expect(resolveViewerTimeZone({ home })).toBe(DEN);
    expect(resolveViewerTimeZone({ cookieValue: 'Mars/X', home })).toBe(DEN);
    expect(
      resolveViewerTimeZone({ home: { city: 'Kansas City', state: 'MO' } }),
    ).toBe('America/Chicago');
  });

  it('falls back to UTC with no cookie and no resolvable home (never Denver)', () => {
    expect(resolveViewerTimeZone({})).toBe('UTC');
    expect(resolveViewerTimeZone({ home: null })).toBe(FALLBACK_TIMEZONE);
    expect(resolveViewerTimeZone({ home: { city: undefined } })).toBe('UTC');
    expect(
      resolveViewerTimeZone({ home: { city: 'Unlisted Town', state: 'ZZ' } }),
    ).toBe('UTC');
    expect(timeZoneForHome({ city: 'Boulder', state: 'CO' })).toBe(DEN);
  });
});

describe('discover date windows follow the viewer timezone', () => {
  // Wed 2026-11-25 20:30 in Denver; already Thu 11-26 in London/UTC.
  const evening = new Date('2026-11-26T03:30:00Z');

  it.each([
    [DEN, '2026-11-25'],
    [NY, '2026-11-25'],
    [LA, '2026-11-25'],
    [HNL, '2026-11-25'],
    [LON, '2026-11-26'],
    ['UTC', '2026-11-26'],
  ])('today for %s at 2026-11-26T03:30Z is %s', (tz, today) => {
    expect(getDiscoverDateWindows(evening, tz).today).toBe(today);
  });

  it('the default (no timezone) is UTC, not Denver', () => {
    expect(getDiscoverDateWindows(evening).today).toBe('2026-11-26');
  });

  it('the "today" boundary flips exactly at local midnight', () => {
    // New York midnight 2026-11-26 00:00 EST == 05:00Z.
    expect(
      getDiscoverDateWindows(new Date('2026-11-26T04:59:59Z'), NY).today,
    ).toBe('2026-11-25');
    expect(
      getDiscoverDateWindows(new Date('2026-11-26T05:00:00Z'), NY).today,
    ).toBe('2026-11-26');
    // Los Angeles midnight == 08:00Z.
    expect(
      getDiscoverDateWindows(new Date('2026-11-26T07:59:59Z'), LA).today,
    ).toBe('2026-11-25');
    expect(
      getDiscoverDateWindows(new Date('2026-11-26T08:00:00Z'), LA).today,
    ).toBe('2026-11-26');
    // Honolulu midnight == 10:00Z.
    expect(
      getDiscoverDateWindows(new Date('2026-11-26T09:59:59Z'), HNL).today,
    ).toBe('2026-11-25');
    expect(
      getDiscoverDateWindows(new Date('2026-11-26T10:00:00Z'), HNL).today,
    ).toBe('2026-11-26');
    // London (GMT in November) midnight == 00:00Z; UTC the same.
    expect(
      getDiscoverDateWindows(new Date('2026-11-25T23:59:59Z'), LON).today,
    ).toBe('2026-11-25');
    expect(
      getDiscoverDateWindows(new Date('2026-11-26T00:00:00Z'), LON).today,
    ).toBe('2026-11-26');
    expect(
      getDiscoverDateWindows(new Date('2026-11-25T23:59:59Z'), 'UTC').today,
    ).toBe('2026-11-25');
    // Denver midnight == 07:00Z (behaviour for a Denver viewer is unchanged).
    expect(
      getDiscoverDateWindows(new Date('2026-11-26T06:59:59Z'), DEN).today,
    ).toBe('2026-11-25');
    expect(
      getDiscoverDateWindows(new Date('2026-11-26T07:00:00Z'), DEN).today,
    ).toBe('2026-11-26');
  });

  it('next-7-days and plan-ahead windows hang off the viewer-local today', () => {
    const w = getDiscoverDateWindows(evening, NY);
    expect(w.today).toBe('2026-11-25');
    expect(w.nextWeekEnd).toBe('2026-12-02');
    expect(w.planAheadStart).toBe('2026-12-25');
    expect(w.horizonEnd).toBe('2027-11-25');
    expect(getDiscoverDateWindows(evening, 'UTC').nextWeekEnd).toBe(
      '2026-12-03',
    );
  });

  it('"this weekend" is the viewer-local Friday to Sunday, clamped so it is never in the past', () => {
    // Sat 2026-11-28 01:00Z: Saturday in London/UTC but still Friday evening in the Americas.
    const instant = new Date('2026-11-28T01:00:00Z');
    expect(getDiscoverDateWindows(instant, LON).weekend).toEqual({
      startDate: '2026-11-28', // Friday 27th is already past for this viewer
      endDate: '2026-11-29',
    });
    for (const tz of [NY, LA, HNL, DEN]) {
      const w = getDiscoverDateWindows(instant, tz);
      expect(w.today).toBe('2026-11-27');
      expect(w.weekend).toEqual({
        startDate: '2026-11-27',
        endDate: '2026-11-29',
      });
    }
    // Midweek: the upcoming Friday through Sunday for everyone.
    expect(getDiscoverDateWindows(evening, HNL).weekend).toEqual({
      startDate: '2026-11-27',
      endDate: '2026-11-29',
    });
  });

  it('windows for an already-resolved local date do not depend on any timezone', () => {
    const w = getDiscoverDateWindowsForDate('2026-11-25');
    expect(w.today).toBe('2026-11-25');
    expect(w.weekend).toEqual({
      startDate: '2026-11-27',
      endDate: '2026-11-29',
    });
    // Friday: weekend starts today (noon is before the 17:00 evening rule).
    expect(getDiscoverDateWindowsForDate('2026-11-27').weekend.startDate).toBe(
      '2026-11-27',
    );
  });
});

describe('scoring modes use the supplied viewer timezone, never a Denver default', () => {
  it('getZonedTimeParts defaults to UTC and honours an explicit zone', () => {
    const at = new Date('2026-11-26T03:30:00Z');
    expect(getZonedTimeParts(at).dateString).toBe('2026-11-26');
    expect(getZonedTimeParts(at, DEN).dateString).toBe('2026-11-25');
    expect(getZonedTimeParts(at, HNL).hour).toBe(17);
  });

  it('weekend window and 14-day lookahead depend on the zone passed in', () => {
    const at = new Date('2026-11-28T01:00:00Z');
    // Saturday in London: weekend is the active Fri-Sun window already.
    expect(
      calculateWeekendWindow({ referenceInstant: at, timeZone: LON }),
    ).toEqual({ startDate: '2026-11-27', endDate: '2026-11-29' });
    expect(calculate14DayLookaheadEndDate(undefined, at, LON)).toBe(
      '2026-12-12',
    );
    expect(calculate14DayLookaheadEndDate(undefined, at, HNL)).toBe(
      '2026-12-11',
    );
    // No zone: UTC (Saturday 28th + 14).
    expect(calculate14DayLookaheadEndDate(undefined, at)).toBe('2026-12-12');
  });

  const event = (over: Partial<CanonicalEventSummary>) =>
    ({
      id: 'e1',
      title: 'Show',
      venueName: 'V',
      localStartDate: '2026-11-27',
      startsAt: '2026-11-28T03:00:00Z',
      timezone: undefined,
      status: 'scheduled',
      artists: [],
      ...over,
    }) as unknown as CanonicalEventSummary;

  it('an event with its own timezone is judged in that timezone; one without uses the viewer zone', () => {
    // Friday 20:00 local show. Friday shows count for the weekend from 17:00 local.
    const nyShow = event({ timezone: NY, startsAt: '2026-11-28T01:00:00Z' });
    expect(
      isEventEligibleForMode(nyShow, 'this_weekend', {
        referenceInstant: '2026-11-25T15:00:00Z',
        timeZone: HNL,
      }),
    ).toBe(true);
    // No event timezone: the viewer's zone decides the local hour of the same instant
    // (2026-11-28T01:00Z is Friday 15:00 in Honolulu, before the 17:00 rule, but 20:00 in New York).
    const untimed = event({
      timezone: undefined,
      startsAt: '2026-11-28T01:00:00Z',
    });
    const ctx = { referenceInstant: '2026-11-25T15:00:00Z' };
    expect(
      isEventEligibleForMode(untimed, 'this_weekend', {
        ...ctx,
        timeZone: HNL,
      }),
    ).toBe(false);
    expect(
      isEventEligibleForMode(untimed, 'this_weekend', { ...ctx, timeZone: NY }),
    ).toBe(true);
  });
});
