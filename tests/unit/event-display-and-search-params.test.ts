import { describe, expect, it } from 'vitest';
import {
  formatEventShowTime,
  getDisplayVenueName,
} from '@/components/catalog/event-display';
import {
  isTruthyFlag,
  isUuid,
  parseEventSort,
  parseIncludeUnknownPrice,
} from '@/lib/discover/search-params';
import { annotateEventsForUser } from '@/lib/recommendation/artist-affinity-server';

describe('getDisplayVenueName', () => {
  it('hides blanks and placeholders, trims real names', () => {
    expect(getDisplayVenueName(undefined)).toBeNull();
    expect(getDisplayVenueName('   ')).toBeNull();
    expect(getDisplayVenueName('Unknown Venue')).toBeNull();
    expect(getDisplayVenueName(' Venue TBA ')).toBeNull();
    expect(getDisplayVenueName('venue tba / unknown')).toBeNull();
    expect(getDisplayVenueName('  Red Rocks ')).toBe('Red Rocks');
  });
});

describe('formatEventShowTime', () => {
  it('returns TBA for date-only or missing start', () => {
    expect(formatEventShowTime({ startsAt: null })).toBe(
      'Time TBA (Date confirmed)',
    );
    expect(
      formatEventShowTime({
        startsAt: '2026-01-01T02:00:00Z',
        startTimePrecision: 'date_only',
      }),
    ).toBe('Time TBA (Date confirmed)');
  });
  it('formats in the venue timezone', () => {
    expect(
      formatEventShowTime({
        startsAt: '2026-01-01T02:00:00Z',
        timezone: 'America/Denver',
      }),
    ).toBe('7:00 PM');
  });
});

describe('search param helpers', () => {
  it('parses sort with date_asc fallback', () => {
    expect(parseEventSort('price_desc')).toBe('price_desc');
    expect(parseEventSort('bogus')).toBe('date_asc');
    expect(parseEventSort(null)).toBe('date_asc');
  });
  it('parses flags', () => {
    expect(isTruthyFlag('1')).toBe(true);
    expect(isTruthyFlag('true')).toBe(true);
    expect(isTruthyFlag('yes')).toBe(false);
    expect(isTruthyFlag(null)).toBe(false);
    expect(parseIncludeUnknownPrice(undefined)).toBe(true);
    expect(parseIncludeUnknownPrice(null)).toBe(true);
    expect(parseIncludeUnknownPrice('0')).toBe(false);
    expect(parseIncludeUnknownPrice('1')).toBe(true);
  });
  it('detects UUIDs', () => {
    expect(isUuid('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
    expect(isUuid('Red Rocks')).toBe(false);
  });
});

describe('annotateEventsForUser', () => {
  it('returns guest events unannotated without loading anything', async () => {
    const events = [{ id: 'e1', artists: [{ name: 'A' }] }];
    const out = await annotateEventsForUser(
      events,
      null,
      {} as never,
      {} as never,
    );
    expect(out).toEqual(events);
  });
});
