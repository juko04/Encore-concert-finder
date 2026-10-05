import { describe, expect, it } from 'vitest';
import {
  formatPrice,
  normalizeName,
  normalizeUrl,
  validateCurrency,
  validateIanaTimezone,
  validatePrice,
} from '@/lib/domain/value-objects';

describe('Value Objects & Normalization', () => {
  describe('normalizeUrl', () => {
    it('normalizes scheme and hostname to lowercase', () => {
      const url = normalizeUrl('HTTPS://EXAMPLE.COM/events/123');
      expect(url).toBe('https://example.com/events/123');
    });

    it('removes default ports 80 and 443', () => {
      expect(normalizeUrl('http://example.com:80/path')).toBe(
        'http://example.com/path',
      );
      expect(normalizeUrl('https://example.com:443/path')).toBe(
        'https://example.com/path',
      );
      expect(normalizeUrl('https://example.com:8443/path')).toBe(
        'https://example.com:8443/path',
      );
    });

    it('removes trailing slash from pathname while preserving root /', () => {
      expect(normalizeUrl('https://example.com/events/')).toBe(
        'https://example.com/events',
      );
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    });

    it('strips fragments', () => {
      expect(normalizeUrl('https://example.com/events/123#details')).toBe(
        'https://example.com/events/123',
      );
    });

    it('strips known tracking parameters: utm_*, gclid, fbclid', () => {
      const url =
        'https://example.com/events/123?utm_source=twitter&utm_medium=social&utm_campaign=fall&gclid=abc12345&fbclid=fb9876';
      expect(normalizeUrl(url)).toBe('https://example.com/events/123');
    });

    it('preserves and deterministically sorts unknown query parameters', () => {
      const url =
        'https://example.com/tickets?section=GA&utm_medium=cpc&promo=FALL26&artist_id=456&gclid=test';
      const normalized = normalizeUrl(url);
      expect(normalized).toBe(
        'https://example.com/tickets?artist_id=456&promo=FALL26&section=GA',
      );
    });

    it('throws error for invalid URLs', () => {
      expect(() => normalizeUrl('')).toThrow('URL must be a non-empty string');
      expect(() => normalizeUrl('not-a-valid-url')).toThrow('Invalid URL');
    });
  });

  describe('normalizeName', () => {
    it('trims and collapses whitespace', () => {
      expect(normalizeName('   Red    Rocks   Amphitheatre   ')).toBe(
        'red rocks amphitheatre',
      );
    });

    it('removes leading English articles', () => {
      expect(normalizeName('The Mountain Goats')).toBe('mountain goats');
      expect(normalizeName('A Perfect Circle')).toBe('perfect circle');
      expect(normalizeName('An Horse')).toBe('horse');
    });

    it('strips punctuation marks and symbols', () => {
      expect(normalizeName('Sunn O)))')).toBe('sunn o');
      expect(normalizeName('Godspeed You! Black Emperor')).toBe(
        'godspeed you black emperor',
      );
      expect(normalizeName('King Gizzard & The Lizard Wizard')).toBe(
        'king gizzard the lizard wizard',
      );
    });

    it('handles unicode normalization', () => {
      expect(normalizeName('Hermanos Gutiérrez')).toBe('hermanos gutiérrez');
      expect(normalizeName('Björk')).toBe('björk');
    });
  });

  describe('validateIanaTimezone', () => {
    it('accepts valid IANA time zone identifiers', () => {
      expect(validateIanaTimezone('America/Denver')).toBe(true);
      expect(validateIanaTimezone('America/New_York')).toBe(true);
      expect(validateIanaTimezone('America/Los_Angeles')).toBe(true);
      expect(validateIanaTimezone('UTC')).toBe(true);
      expect(validateIanaTimezone('Europe/London')).toBe(true);
    });

    it('rejects 3-letter abbreviations such as MST, EST, PST', () => {
      expect(validateIanaTimezone('MST')).toBe(false);
      expect(validateIanaTimezone('MDT')).toBe(false);
      expect(validateIanaTimezone('EST')).toBe(false);
      expect(validateIanaTimezone('EDT')).toBe(false);
      expect(validateIanaTimezone('PST')).toBe(false);
      expect(validateIanaTimezone('PDT')).toBe(false);
      expect(validateIanaTimezone('CST')).toBe(false);
    });

    it('rejects invalid or arbitrary strings', () => {
      expect(validateIanaTimezone('')).toBe(false);
      expect(validateIanaTimezone('Invalid/Zone')).toBe(false);
      expect(validateIanaTimezone('Colorado')).toBe(false);
    });
  });

  describe('Money and Currency validation', () => {
    it('validates ISO-4217 3-letter currency codes', () => {
      expect(validateCurrency('USD')).toBe(true);
      expect(validateCurrency('CAD')).toBe(true);
      expect(validateCurrency('EUR')).toBe(true);
      expect(validateCurrency('GBP')).toBe(true);
      expect(validateCurrency('usd')).toBe(false);
      expect(validateCurrency('US')).toBe(false);
      expect(validateCurrency('USDT')).toBe(false);
    });

    it('validates price amounts', () => {
      expect(validatePrice(0)).toBe(true);
      expect(validatePrice(25.5)).toBe(true);
      expect(validatePrice(-1)).toBe(false);
      expect(validatePrice(NaN)).toBe(false);
      expect(validatePrice(Infinity)).toBe(false);
    });

    it('formats price to two decimal places', () => {
      expect(formatPrice(25.555)).toBe(25.56);
      expect(formatPrice(10)).toBe(10);
      expect(formatPrice(19.991)).toBe(19.99);
    });
  });
});
