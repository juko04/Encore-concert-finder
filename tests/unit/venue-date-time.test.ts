import { describe, expect, it } from 'vitest';
import {
  localDateTimeToUtcInstant,
  parseDateString,
  parseTimeText,
} from '@/lib/sources/venue/date-time';

describe('Venue Date-Time Utilities', () => {
  describe('parseTimeText', () => {
    it('parses both doors and show times from standard venue format', () => {
      const result = parseTimeText('Doors: 7 pm | Show: 8 pm');
      expect(result.doorTime).toBe('19:00:00');
      expect(result.showTime).toBe('20:00:00');
    });

    it('parses half-hour times correctly', () => {
      const result = parseTimeText('Doors: 8 pm | Show: 8:30 pm');
      expect(result.doorTime).toBe('20:00:00');
      expect(result.showTime).toBe('20:30:00');
    });

    it('parses single time when only show time is provided', () => {
      const result = parseTimeText('Show: 9:00 PM');
      expect(result.doorTime).toBeNull();
      expect(result.showTime).toBe('21:00:00');
    });

    it('parses single time when only doors time is provided', () => {
      const result = parseTimeText('Doors: 7:00 PM');
      expect(result.doorTime).toBe('19:00:00');
      expect(result.showTime).toBeNull();
    });

    it('parses standalone time string', () => {
      const result = parseTimeText('8:00 PM');
      expect(result.doorTime).toBeNull();
      expect(result.showTime).toBe('20:00:00');
    });

    it('handles null, undefined, and empty string safely', () => {
      expect(parseTimeText(null)).toEqual({ showTime: null, doorTime: null });
      expect(parseTimeText(undefined)).toEqual({
        showTime: null,
        doorTime: null,
      });
      expect(parseTimeText('')).toEqual({ showTime: null, doorTime: null });
      expect(parseTimeText('TBA')).toEqual({
        showTime: null,
        doorTime: null,
        rawText: 'TBA',
      });
    });
  });

  describe('localDateTimeToUtcInstant', () => {
    it('converts Denver winter time (MST, UTC-7) accurately without day skew', () => {
      // 8:00 PM in Denver on Nov 7 = 3:00 AM UTC on Nov 8
      const instant = localDateTimeToUtcInstant(
        '2026-11-07',
        '20:00:00',
        'America/Denver',
      );
      expect(instant).toBe('2026-11-08T03:00:00.000Z');
    });

    it('converts Denver summer time (MDT, UTC-6) accurately with daylight saving', () => {
      // 8:00 PM in Denver on June 15 = 2:00 AM UTC on June 16
      const instant = localDateTimeToUtcInstant(
        '2026-06-15',
        '20:00:00',
        'America/Denver',
      );
      expect(instant).toBe('2026-06-16T02:00:00.000Z');
    });

    it('throws on invalid IANA timezone', () => {
      expect(() =>
        localDateTimeToUtcInstant('2026-11-07', '20:00:00', 'MST'),
      ).toThrow('Invalid IANA timezone');
    });

    it('throws on malformed date or time strings', () => {
      expect(() =>
        localDateTimeToUtcInstant('2026-11', '20:00:00', 'America/Denver'),
      ).toThrow('Invalid localDate format');
      expect(() =>
        localDateTimeToUtcInstant('2026-11-07', 'invalid', 'America/Denver'),
      ).toThrow('Invalid localTime format');
    });
  });

  describe('parseDateString', () => {
    it('parses weekday, month abbreviation, and zero-padded day', () => {
      const date = parseDateString('November 2026', 'Sat, Nov 07');
      expect(date).toBe('2026-11-07');
    });

    it('parses across year boundary from upcoming months', () => {
      const date = parseDateString('January 2027', 'Sat, Jan 30');
      expect(date).toBe('2027-01-30');
    });

    it('parses single-digit day with ordinal suffix', () => {
      const date = parseDateString('December 2026', 'Thu, Dec 3rd');
      expect(date).toBe('2026-12-03');
    });

    it('parses date without weekday', () => {
      const date = parseDateString('March 2027', 'Mar 15');
      expect(date).toBe('2027-03-15');
    });

    it('parses day-first date format', () => {
      const date = parseDateString('April 2027', '20th Apr');
      expect(date).toBe('2027-04-20');
    });

    it('falls back to default month when dateText has only day number', () => {
      const date = parseDateString('November 2026', '07');
      expect(date).toBe('2026-11-07');
    });

    it('returns null on invalid or unparseable input', () => {
      expect(parseDateString(null, null)).toBeNull();
      expect(parseDateString('November 2026', 'Invalid Date')).toBeNull();
    });
  });
});
