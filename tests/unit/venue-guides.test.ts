import { describe, expect, it } from 'vitest';
import {
  VENUE_GUIDES,
  VENUE_GUIDE_ISSUES,
  matchVenueGuide,
  normalizeVenueName,
  buildDecisionGuide,
} from '@/lib/venues';

describe('venue guide data', () => {
  it('has 20 valid guides with no dropped items', () => {
    expect(VENUE_GUIDES).toHaveLength(20);
    expect(VENUE_GUIDE_ISSUES).toEqual([]);
  });
  it('every item has evidence and http(s) sources', () => {
    for (const g of VENUE_GUIDES) {
      for (const i of [...g.whyPeopleLikeIt, ...g.considerBeforeAttending]) {
        expect(i.text.length).toBeGreaterThan(0);
        expect(i.sourceUrls.length).toBeGreaterThan(0);
        i.sourceUrls.forEach((u) => expect(u).toMatch(/^https?:\/\//));
      }
    }
  });
});

describe('matchVenueGuide', () => {
  it('matches exact and normalized names', () => {
    expect(
      matchVenueGuide({
        venueName: 'Red Rocks Amphitheatre',
        city: 'Morrison',
        region: 'CO',
      })?.guide.name,
    ).toMatch(/Red Rocks/);
    expect(normalizeVenueName('The Gothic Theatre')).toBe('gothic theatre');
  });
  it('returns null for unknown venues and wrong regions', () => {
    expect(
      matchVenueGuide({
        venueName: 'Nowhere Hall',
        city: 'Denver',
        region: 'CO',
      }),
    ).toBeNull();
    expect(
      matchVenueGuide({
        venueName: 'Ogden Theatre',
        city: 'Denver',
        region: 'NY',
      }),
    ).toBeNull();
  });
});

describe('buildDecisionGuide', () => {
  it('uses a generic note when no venue guide exists', () => {
    const g = buildDecisionGuide({
      venueName: 'Nowhere Hall',
      city: 'Denver',
      region: 'CO',
    });
    expect(g.venue).toBeNull();
    expect(g.fallbackNote).toMatch(/don't have a detailed guide/);
  });
  it('produces different, source-backed guides per venue', () => {
    const a = buildDecisionGuide({
      venueName: 'Red Rocks Amphitheatre',
      city: 'Morrison',
      region: 'CO',
    });
    const b = buildDecisionGuide({
      venueName: 'Ogden Theatre',
      city: 'Denver',
      region: 'CO',
    });
    expect(a.venue).not.toBeNull();
    expect(a.consider.map((x) => x.text)).not.toEqual(
      b.consider.map((x) => x.text),
    );
    expect(a.sources.length).toBeGreaterThan(0);
    expect(a.why.length).toBeLessThanOrEqual(4);
    expect(a.consider.length).toBeLessThanOrEqual(5);
  });
  it('flags late starts from real timestamps only', () => {
    const g = buildDecisionGuide({
      venueName: 'Nowhere Hall',
      startsAt: '2026-12-05T05:00:00Z',
      timezone: 'America/Denver',
      startTimePrecision: 'instant',
    });
    expect(
      g.consider.some((c) => /Late start: listed at 10:00 PM/.test(c.text)),
    ).toBe(true);
  });
});
