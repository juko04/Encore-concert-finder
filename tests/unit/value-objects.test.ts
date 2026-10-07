import { describe, expect, it } from 'vitest';
import {
  deriveLocalDateFromInstant,
  formatCurrencyAmount,
  formatPrice,
  normalizeName,
  normalizeUrl,
  validateCurrency,
  validateIanaTimezone,
  validatePrice,
} from '@/lib/domain/value-objects';

describe('Value Objects & Normalization', () => {
  describe('normalizeUrl', () => {
    it('strips tracking parameters (utm_*, gclid, fbclid)', () => {
      const input =
        'https://example.com/tickets?utm_source=google&utm_medium=cpc&gclid=abc&fbclid=xyz&event_id=42';
      const normalized = normalizeUrl(input);
      expect(normalized).toBe('https://example.com/tickets?event_id=42');
    });

    it('strips fragments (#section)', () => {
      const input = 'https://example.com/shows/123#reviews';
      expect(normalizeUrl(input)).toBe('https://example.com/shows/123');
    });

    it('removes default ports 80 and 443', () => {
      expect(normalizeUrl('http://example.com:80/path')).toBe(
        'http://example.com/path',
      );
      expect(normalizeUrl('https://example.com:443/path')).toBe(
        'https://example.com/path',
      );
    });

    it('preserves non-default ports', () => {
      expect(normalizeUrl('http://example.com:8080/path')).toBe(
        'http://example.com:8080/path',
      );
    });

    it('removes trailing slash from pathname while preserving root', () => {
      expect(normalizeUrl('https://example.com/events/')).toBe(
        'https://example.com/events',
      );
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    });

    it('preserves and deterministically sorts unknown query parameters', () => {
      const input =
        'https://ticketmaster.com/event/1?section=GA&row=5&utm_source=mail&zone=north';
      const normalized = normalizeUrl(input);
      expect(normalized).toBe(
        'https://ticketmaster.com/event/1?row=5&section=GA&zone=north',
      );
    });

    it('throws error for invalid URL', () => {
      expect(() => normalizeUrl('not-a-valid-url')).toThrow();
    });
  });

  describe('normalizeName', () => {
    it('collapses whitespace and lowercases', () => {
      expect(normalizeName('  Red   Rocks   Amphitheatre  ')).toBe(
        'red rocks amphitheatre',
      );
    });

    it('strips leading English articles', () => {
      expect(normalizeName('The National')).toBe('national');
      expect(normalizeName('A Perfect Circle')).toBe('perfect circle');
      expect(normalizeName('An Horse')).toBe('horse');
    });

    it('strips punctuation', () => {
      expect(normalizeName('P!nk')).toBe('p nk');
      expect(normalizeName('Sunn O)))')).toBe('sunn o');
    });
  });

  describe('validateIanaTimezone', () => {
    it('accepts legitimate IANA timezones', () => {
      expect(validateIanaTimezone('America/Denver')).toBe(true);
      expect(validateIanaTimezone('America/New_York')).toBe(true);
      expect(validateIanaTimezone('Europe/London')).toBe(true);
      expect(validateIanaTimezone('Asia/Tokyo')).toBe(true);
      expect(validateIanaTimezone('UTC')).toBe(true);
    });

    it('rejects disallowed 3-letter abbreviations', () => {
      expect(validateIanaTimezone('MST')).toBe(false);
      expect(validateIanaTimezone('MDT')).toBe(false);
      expect(validateIanaTimezone('EST')).toBe(false);
      expect(validateIanaTimezone('EDT')).toBe(false);
      expect(validateIanaTimezone('PST')).toBe(false);
      expect(validateIanaTimezone('CST')).toBe(false);
    });

    it('rejects empty or invalid strings', () => {
      expect(validateIanaTimezone('')).toBe(false);
      expect(validateIanaTimezone('Invalid/Timezone_Name')).toBe(false);
    });
  });

  describe('deriveLocalDateFromInstant (Finding 4)', () => {
    it('correctly calculates local calendar date when UTC rolled over past midnight', () => {
      // 02:00:00 UTC on Oct 15 is 20:00:00 (8 PM) on Oct 14 in America/Denver (MDT is UTC-6)
      const instant = '2026-10-15T02:00:00Z';
      const localDate = deriveLocalDateFromInstant(instant, 'America/Denver');
      expect(localDate).toBe('2026-10-14');
    });

    it('correctly handles same-day UTC and local times', () => {
      // 18:00:00 UTC in Europe/London is 19:00:00 (BST) or 18:00:00 (GMT) on same date
      const instant = '2026-06-15T18:00:00Z';
      const localDate = deriveLocalDateFromInstant(instant, 'Europe/London');
      expect(localDate).toBe('2026-06-15');
    });

    it('throws when given invalid timezone or instant', () => {
      expect(() =>
        deriveLocalDateFromInstant('2026-10-15T02:00:00Z', 'MST'),
      ).toThrow();
      expect(() =>
        deriveLocalDateFromInstant('not-a-date', 'America/Denver'),
      ).toThrow();
    });
  });

  describe('Currency & Price Formatting (Finding 12)', () => {
    it('validates ISO-4217 currencies and prices', () => {
      expect(validateCurrency('USD')).toBe(true);
      expect(validateCurrency('EUR')).toBe(true);
      expect(validateCurrency('GBP')).toBe(true);
      expect(validateCurrency('CAD')).toBe(true);
      expect(validateCurrency('dollars')).toBe(false);
      expect(validatePrice(50.5)).toBe(true);
      expect(validatePrice(-5)).toBe(false);
      expect(formatPrice(49.999)).toBe(50.0);
    });

    it('formats monetary values using stored ISO currency code without hardcoding $', () => {
      const usdFormatted = formatCurrencyAmount(59.5, 'USD', 'en-US');
      expect(usdFormatted).toContain('59.50');
      expect(usdFormatted).toContain('$');

      const eurFormatted = formatCurrencyAmount(45.0, 'EUR', 'en-US');
      expect(eurFormatted).toContain('45.00');
      expect(eurFormatted).toContain('€');

      const gbpFormatted = formatCurrencyAmount(65.0, 'GBP', 'en-US');
      expect(gbpFormatted).toContain('65.00');
      expect(gbpFormatted).toContain('£');
    });

    it('renders neutral numeric amount without fabricating USD when currency is invalid or missing (Finding 16)', () => {
      // Invalid code
      const invalidFormatted = formatCurrencyAmount(50.0, 'INVALID', 'en-US');
      expect(invalidFormatted).toBe('50.00');
      expect(invalidFormatted).not.toContain('$');
      expect(invalidFormatted).not.toContain('USD');

      // Missing code (null)
      const nullFormatted = formatCurrencyAmount(75.5, null, 'en-US');
      expect(nullFormatted).toBe('75.50');
      expect(nullFormatted).not.toContain('$');
      expect(nullFormatted).not.toContain('USD');

      // Missing code (undefined)
      const undefinedFormatted = formatCurrencyAmount(30.0, undefined, 'en-US');
      expect(undefinedFormatted).toBe('30.00');
      expect(undefinedFormatted).not.toContain('$');
      expect(undefinedFormatted).not.toContain('USD');
    });
  });

  describe('Candidate Fingerprint Computation', () => {
    it('uses sourceEventId when present for stable upstream identity', async () => {
      const { computeCandidateFingerprint } =
        await import('@/lib/domain/value-objects');
      const fp = computeCandidateFingerprint({
        sourceEventId: 'upstream_123',
        title: 'Some Concert',
        venueName: 'Some Venue',
      });
      expect(fp).toBe('src_evt:upstream_123');
    });

    it('computes deterministic fingerprint based on normalized attributes when sourceEventId is missing', async () => {
      const { computeCandidateFingerprint } =
        await import('@/lib/domain/value-objects');
      const fp1 = computeCandidateFingerprint({
        title: 'The National Live',
        artistNames: ['The National', 'Bartees Strange'],
        venueName: 'Mission Ballroom',
        localStartDate: '2026-10-15',
        ticketUrl: 'https://tickets.example.com/events/101?utm_source=fb',
      });

      const fp2 = computeCandidateFingerprint({
        title: '  the national live  ',
        artistNames: ['Bartees Strange', 'The National'],
        venueName: '  mission ballroom  ',
        localStartDate: '2026-10-15',
        ticketUrl: 'https://tickets.example.com/events/101?utm_campaign=winter',
      });

      expect(fp1).toBe(fp2);
    });

    it('produces distinct fingerprints for different events in the same raw observation', async () => {
      const { computeCandidateFingerprint } =
        await import('@/lib/domain/value-objects');
      const fpA = computeCandidateFingerprint({
        title: 'Event A',
        artistNames: ['Artist A'],
        venueName: 'Venue V',
        localStartDate: '2026-10-15',
      });

      const fpB = computeCandidateFingerprint({
        title: 'Event B',
        artistNames: ['Artist B'],
        venueName: 'Venue V',
        localStartDate: '2026-10-16',
      });

      expect(fpA).not.toBe(fpB);
    });
  });
});
