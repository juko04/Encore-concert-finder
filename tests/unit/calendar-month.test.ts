import { describe, it, expect } from 'vitest';
import {
  parseMonthParam,
  resolveCalendarAnchor,
} from '@/lib/utils/calendar-month';

describe('calendar default month', () => {
  const now = new Date(2026, 10, 25, 9, 0, 0); // 25 Nov 2026 local

  it('defaults to the current month and day from the mocked date', () => {
    expect(resolveCalendarAnchor({ now })).toEqual({
      year: 2026,
      month: 10,
      selectedDate: '2026-11-25',
    });
  });

  it('follows the mocked date across a year boundary', () => {
    const jan = new Date(2027, 0, 3);
    expect(resolveCalendarAnchor({ now: jan })).toEqual({
      year: 2027,
      month: 0,
      selectedDate: '2027-01-03',
    });
  });

  it('honors a valid ?month= param, selecting day 1 for other months', () => {
    expect(resolveCalendarAnchor({ now, monthParam: '2027-03' })).toEqual({
      year: 2027,
      month: 2,
      selectedDate: '2027-03-01',
    });
  });

  it('selects today when ?month= is the current month', () => {
    expect(resolveCalendarAnchor({ now, monthParam: '2026-11' })).toEqual({
      year: 2026,
      month: 10,
      selectedDate: '2026-11-25',
    });
  });

  it('ignores invalid ?month= values', () => {
    for (const bad of ['2026-13', 'nov', '2026-1', '', null, undefined]) {
      expect(parseMonthParam(bad)).toBeNull();
      expect(resolveCalendarAnchor({ now, monthParam: bad }).month).toBe(10);
    }
  });

  it('explicit referenceDate wins', () => {
    expect(
      resolveCalendarAnchor({
        now,
        referenceDate: '2026-09-20',
        monthParam: '2027-03',
      }),
    ).toEqual({ year: 2026, month: 8, selectedDate: '2026-09-20' });
  });
});
