import { describe, it, expect } from 'vitest';
import {
  formatIndexDate,
  formatEventDate,
  formatDoorsTime,
  formatIndexPrice,
  formatPrice,
  getStatusBadge,
  calculateDistanceMiles,
} from '@/components/index/formatters';

describe('Index Formatters Unit Tests', () => {
  describe('formatIndexDate & formatEventDate', () => {
    it('formats ISO YYYY-MM-DD date correctly without timezone shift', () => {
      const formatted = formatIndexDate('2026-11-14');
      expect(formatted).toBe('Sat, Nov 14');
    });

    it('formats date with formatted door time', () => {
      const formatted = formatIndexDate('2026-11-14', '7:30 PM');
      expect(formatted).toBe('Sat, Nov 14 · 7:30 PM');
    });

    it('formats date with 24-hour door time string', () => {
      const formatted = formatIndexDate('2026-11-14', '19:30');
      expect(formatted).toBe('Sat, Nov 14 · 7:30 PM');
    });

    it('formats date with ISO start timestamp', () => {
      const formatted = formatIndexDate(
        '2026-11-14',
        '2026-11-14T20:00:00Z',
        'UTC',
      );
      expect(formatted).toContain('Nov 14');
      expect(formatted).toContain('8:00 PM');
    });

    it('handles empty or invalid date string gracefully', () => {
      expect(formatIndexDate('')).toBe('Date TBA');
      expect(formatIndexDate('invalid-date')).toBe('invalid-date');
    });

    it('provides formatEventDate alias identical to formatIndexDate', () => {
      expect(formatEventDate('2026-12-05')).toBe(formatIndexDate('2026-12-05'));
    });
  });

  describe('formatDoorsTime', () => {
    it('converts 24-hour time string to 12-hour AM/PM', () => {
      expect(formatDoorsTime('19:30')).toBe('7:30 PM');
      expect(formatDoorsTime('09:15')).toBe('9:15 AM');
      expect(formatDoorsTime('12:00')).toBe('12:00 PM');
      expect(formatDoorsTime('00:30')).toBe('12:30 AM');
    });

    it('preserves existing AM/PM formatted strings', () => {
      expect(formatDoorsTime('Doors at 7:00 PM')).toBe('Doors at 7:00 PM');
      expect(formatDoorsTime('8:00 PM')).toBe('8:00 PM');
    });

    it('handles ISO instant string with timezone', () => {
      const time = formatDoorsTime('2026-11-14T19:30:00Z', 'UTC');
      expect(time).toBe('7:30 PM');
    });

    it('returns Time TBA for empty or missing time', () => {
      expect(formatDoorsTime(null)).toBe('Time TBA');
      expect(formatDoorsTime(undefined)).toBe('Time TBA');
      expect(formatDoorsTime('')).toBe('Time TBA');
    });
  });

  describe('formatIndexPrice & formatPrice', () => {
    it('formats price range with USD symbol', () => {
      const price = formatIndexPrice(18, 22, 'USD');
      expect(price).toBe('$18–$22');
    });

    it('formats single price without range when min and max are equal', () => {
      const price = formatIndexPrice(25, 25, 'USD');
      expect(price).toBe('$25');
    });

    it('formats single price when only minPrice is present', () => {
      const price = formatIndexPrice(15, null, 'USD');
      expect(price).toBe('$15');
    });

    it('formats upper ceiling when only maxPrice is present', () => {
      const price = formatIndexPrice(null, 30, 'USD');
      expect(price).toBe('Up to $30');
    });

    it('formats verified free events with $0 price', () => {
      expect(formatIndexPrice(0, 0, 'USD')).toBe('Free ($0)');
      expect(formatIndexPrice(0, null, 'USD')).toBe('Free ($0)');
    });

    it('formats explicit free_event kind as Free ($0)', () => {
      expect(formatIndexPrice(null, null, 'USD', 'free_event')).toBe(
        'Free ($0)',
      );
      expect(formatIndexPrice(0, 0, 'USD', 'free_event')).toBe('Free ($0)');
    });

    it('detects contradictory pricing on free events', () => {
      const price = formatIndexPrice(20, 20, 'USD', 'free_event');
      expect(price).toBe('Contradictory Pricing ($20 / Free Event)');
    });

    it('formats foreign currencies accurately (EUR, GBP, CAD)', () => {
      expect(formatIndexPrice(25, 35, 'EUR')).toBe('€25–€35');
      expect(formatIndexPrice(20, null, 'GBP')).toBe('£20');
      expect(formatIndexPrice(30, 45, 'CAD')).toBe('CAD 30–CAD 45');
    });

    it('formats missing prices as Price TBA', () => {
      expect(formatIndexPrice(null, null)).toBe('Price TBA');
      expect(formatIndexPrice(undefined, undefined)).toBe('Price TBA');
    });

    it('provides formatPrice alias identical to formatIndexPrice', () => {
      expect(formatPrice(10, 20, 'USD')).toBe(formatIndexPrice(10, 20, 'USD'));
    });
  });

  describe('getStatusBadge', () => {
    it('returns appropriate badge configuration for all inventory statuses', () => {
      expect(getStatusBadge('available').label).toBe('Tickets Available');
      expect(getStatusBadge('low_inventory').label).toBe('Low Inventory');
      expect(getStatusBadge('sold_out').label).toBe('Sold Out');
      expect(getStatusBadge('sold_out').bg).toContain('text-rose-700');
      expect(getStatusBadge('cancelled').label).toBe('Cancelled');
      expect(getStatusBadge('presale').label).toBe('Presale Soon');
      expect(getStatusBadge('unknown').label).toBe('Tickets Available');
    });
  });

  describe('calculateDistanceMiles', () => {
    it('calculates distance accurately between coordinates', () => {
      // Red Rocks Amphitheatre: lat ~39.6654, lng ~-105.2057 from central Denver (39.7392, -104.9903)
      const distance = calculateDistanceMiles(39.6654, -105.2057);
      expect(distance).toBeGreaterThan(10);
      expect(distance).toBeLessThan(20);
    });

    it('returns null when coordinates are missing or invalid', () => {
      expect(calculateDistanceMiles(undefined, undefined)).toBeNull();
      expect(calculateDistanceMiles(null, null)).toBeNull();
      expect(calculateDistanceMiles(NaN, 10)).toBeNull();
    });

    it('calculates distance against custom origin accurately', () => {
      const origin = { lat: 40.015, lng: -105.2705 }; // Boulder, CO
      const distance = calculateDistanceMiles(40.015, -105.2705, origin);
      expect(distance).toBe(0);
    });
  });
});
