import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseZ2Events,
  parseZ2RawEvents,
  parseZ2Artists,
  parseZ2Date,
  parseZ2Price,
  resolveZ2Venue,
} from '@/lib/sources/venue/z2-entertainment/parser';
import {
  Z2_ENTERTAINMENT_CONFIG,
  Z2_ENTERTAINMENT_SOURCE_ID,
} from '@/lib/sources/venue/source-registry';

describe('Z2 Entertainment Parser', () => {
  const fixturePath = path.resolve(
    process.cwd(),
    'tests/fixtures/z2-events-response.html',
  );
  const fixtureHtml = fs.readFileSync(fixturePath, 'utf-8');

  const defaultContext = {
    sourceId: Z2_ENTERTAINMENT_SOURCE_ID,
    sourceUrl: 'https://z2ent.com/events',
    fetchedAt: '2026-11-20T00:00:00.000Z',
    contentHash: 'hash-z2-test',
    parserVersion: '1.0.0',
    defaultVenueConfig: Z2_ENTERTAINMENT_CONFIG,
  };

  describe('Multi-Venue Identification in a Shared Feed', () => {
    it('parses all 6 concerts spanning multiple distinct Colorado venues', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      expect(candidates).toHaveLength(6);
    });

    it('correctly identifies Boulder Theater with Boulder address and locality', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const motetShow = candidates.find((c) => c.title.includes('The Motet'));

      expect(motetShow).toBeDefined();
      expect(motetShow?.venueName).toBe('Boulder Theater');
      expect(motetShow?.city).toBe('Boulder');
      expect(motetShow?.state).toBe('CO');
      expect(motetShow?.timezone).toBe('America/Denver');
      expect(motetShow?.rawPayload?.address).toBe('2032 14th St');
    });

    it('correctly identifies Fox Theatre with Boulder address and locality', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const kitchenDwellers = candidates.find((c) =>
        c.title.includes('Kitchen Dwellers'),
      );

      expect(kitchenDwellers).toBeDefined();
      expect(kitchenDwellers?.venueName).toBe('Fox Theatre');
      expect(kitchenDwellers?.city).toBe('Boulder');
      expect(kitchenDwellers?.state).toBe('CO');
      expect(kitchenDwellers?.timezone).toBe('America/Denver');
      expect(kitchenDwellers?.rawPayload?.address).toBe('1135 13th St');
    });

    it('correctly identifies Aggie Theatre with Fort Collins locality (NOT Boulder)', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const lettuceShow = candidates.find((c) => c.title.includes('Lettuce'));

      expect(lettuceShow).toBeDefined();
      expect(lettuceShow?.venueName).toBe('Aggie Theatre');
      expect(lettuceShow?.city).toBe('Fort Collins'); // Invariant: Fort Collins, not default Boulder
      expect(lettuceShow?.state).toBe('CO');
      expect(lettuceShow?.timezone).toBe('America/Denver');
      expect(lettuceShow?.rawPayload?.address).toBe('204 S College Ave');
    });

    it('correctly identifies Chautauqua Auditorium with Boulder locality', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const isakovShow = candidates.find((c) =>
        c.title.includes('Gregory Alan Isakov'),
      );

      expect(isakovShow).toBeDefined();
      expect(isakovShow?.venueName).toBe('Chautauqua Auditorium');
      expect(isakovShow?.city).toBe('Boulder');
      expect(isakovShow?.state).toBe('CO');
      expect(isakovShow?.timezone).toBe('America/Denver');
      expect(isakovShow?.rawPayload?.address).toBe('900 Baseline Rd');
    });

    it('resolves venue aliases robustly via resolveZ2Venue helper', () => {
      expect(resolveZ2Venue('Boulder Theater').venueName).toBe(
        'Boulder Theater',
      );
      expect(resolveZ2Venue('The Boulder Theater').venueName).toBe(
        'Boulder Theater',
      );
      expect(resolveZ2Venue('bouldertheater').venueName).toBe(
        'Boulder Theater',
      );

      expect(resolveZ2Venue('Fox Theatre').venueName).toBe('Fox Theatre');
      expect(resolveZ2Venue('The Fox Theatre').venueName).toBe('Fox Theatre');
      expect(resolveZ2Venue('Fox Theater').venueName).toBe('Fox Theatre');

      expect(resolveZ2Venue('Aggie Theatre').venueName).toBe('Aggie Theatre');
      expect(resolveZ2Venue('The Aggie').venueName).toBe('Aggie Theatre');
      expect(resolveZ2Venue('Aggie Theater').venueName).toBe('Aggie Theatre');

      expect(resolveZ2Venue('Chautauqua Auditorium').venueName).toBe(
        'Chautauqua Auditorium',
      );

      // A non-Z2 room whose shows Z2 sells: located correctly, never defaulted to Boulder.
      for (const raw of [
        '10 Mile Music Hall',
        '10 Mile Music Hall - Frisco',
        'Ten Mile Music Hall',
      ]) {
        const v = resolveZ2Venue(raw) as { venueName: string; city?: string };
        expect(v.venueName).toBe('10 Mile Music Hall');
        expect(v.city).toBe('Frisco');
      }
      expect(resolveZ2Venue('Chautauqua').venueName).toBe(
        'Chautauqua Auditorium',
      );
    });
  });

  describe('America/Denver Timezone & Local Date Handling', () => {
    it('computes exact startsAt and doorsOpenAt UTC instants in Denver winter MST (UTC-7)', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const motetShow = candidates.find((c) => c.title.includes('The Motet'));

      expect(motetShow?.localStartDate).toBe('2026-11-20');
      expect(motetShow?.timezone).toBe('America/Denver');
      expect(motetShow?.startTimePrecision).toBe('instant');
      // Show 8:00 PM MST = 03:00 AM UTC next day
      expect(motetShow?.startsAt).toBe('2026-11-21T03:00:00.000Z');
      // Doors 7:00 PM MST = 02:00 AM UTC next day
      expect(motetShow?.doorsOpenAt).toBe('2026-11-21T02:00:00.000Z');
    });

    it('computes exact startsAt and doorsOpenAt UTC instants in Denver summer MDT (UTC-6) across DST', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const isakovShow = candidates.find((c) =>
        c.title.includes('Gregory Alan Isakov'),
      );

      expect(isakovShow?.localStartDate).toBe('2027-07-16');
      expect(isakovShow?.timezone).toBe('America/Denver');
      expect(isakovShow?.startTimePrecision).toBe('instant');
      // Show 7:30 PM MDT = 01:30 AM UTC next day
      expect(isakovShow?.startsAt).toBe('2027-07-17T01:30:00.000Z');
      // Doors 6:30 PM MDT = 00:30 AM UTC next day
      expect(isakovShow?.doorsOpenAt).toBe('2027-07-17T00:30:00.000Z');
    });

    it('handles show-only events without doors open time', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const freeShow = candidates.find((c) =>
        c.title.includes('Boulder Philharmonic'),
      );

      expect(freeShow?.localStartDate).toBe('2026-12-20');
      // Show 2:00 PM MST = 21:00 PM UTC same day
      expect(freeShow?.startsAt).toBe('2026-12-20T21:00:00.000Z');
      expect(freeShow?.doorsOpenAt).toBeUndefined();
    });

    it('parses multiple date formats using parseZ2Date', () => {
      expect(parseZ2Date('Fri, Nov 20, 2026')).toBe('2026-11-20');
      expect(parseZ2Date('November 20, 2026')).toBe('2026-11-20');
      expect(parseZ2Date('2026-11-20')).toBe('2026-11-20');
      expect(parseZ2Date('11/20/2026')).toBe('2026-11-20');
      expect(parseZ2Date(null)).toBeNull();
      expect(parseZ2Date('')).toBeNull();
    });
  });

  describe('Billing Order & Artist Lineup Extraction', () => {
    it('correctly assigns headliner and multiple support acts with billing order and positions', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const motetShow = candidates.find((c) => c.title.includes('The Motet'));

      expect(motetShow?.artists).toBeDefined();
      expect(motetShow?.artists).toHaveLength(3);

      // Headliner
      const headliner = motetShow?.artists?.[0];
      expect(headliner?.name).toBe('The Motet');
      expect(headliner?.billingPosition).toBe('headliner');
      expect(headliner?.sortOrder).toBe(1);

      // Support 1
      const support1 = motetShow?.artists?.[1];
      expect(support1?.name).toBe('SunSquabi');
      expect(support1?.billingPosition).toBe('support');
      expect(support1?.sortOrder).toBe(2);

      // Support 2
      const support2 = motetShow?.artists?.[2];
      expect(support2?.name).toBe('Late Night Radio');
      expect(support2?.billingPosition).toBe('support');
      expect(support2?.sortOrder).toBe(3);

      expect(motetShow?.artistNames).toEqual([
        'The Motet',
        'SunSquabi',
        'Late Night Radio',
      ]);
    });

    it('verifies raw model position mapping where headliner position is 0 and support acts are position > 0', () => {
      const rawEvents = parseZ2RawEvents(fixtureHtml);
      const motetRaw = rawEvents.find((e) => e.title.includes('The Motet'));

      expect(motetRaw).toBeDefined();
      const headlinerRaw = motetRaw?.artists.find((a) => a.position === 0);
      expect(headlinerRaw?.name).toBe('The Motet');
      expect(headlinerRaw?.billingPosition).toBe('headliner');

      const supportActsRaw = motetRaw?.artists.filter((a) => a.position > 0);
      expect(supportActsRaw).toHaveLength(2);
      expect(supportActsRaw?.map((a) => a.name)).toEqual([
        'SunSquabi',
        'Late Night Radio',
      ]);
      expect(
        supportActsRaw?.every((a) => a.billingPosition === 'support'),
      ).toBe(true);
    });

    it('extracts embedded support acts from event titles using parseZ2Artists', () => {
      const parsed = parseZ2Artists(
        'Colorado Punk Rock Night w/ The Nobodys, The Frisk',
      );
      expect(parsed.cleanTitle).toBe('Colorado Punk Rock Night');
      expect(parsed.artists[0]).toEqual({
        name: 'Colorado Punk Rock Night',
        billingPosition: 'headliner',
        sortOrder: 1,
      });
      expect(parsed.artists[1]).toEqual({
        name: 'The Nobodys',
        billingPosition: 'support',
        sortOrder: 2,
      });
      expect(parsed.artists[2]).toEqual({
        name: 'The Frisk',
        billingPosition: 'support',
        sortOrder: 3,
      });
    });
  });

  describe('Sold-Out Flag Detection', () => {
    it('detects sold-out badges and classes, setting isSoldOut: true and inventoryStatus: sold_out', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const lettuceShow = candidates.find((c) => c.title.includes('Lettuce'));

      expect(lettuceShow).toBeDefined();
      expect(lettuceShow?.inventoryStatus).toBe('sold_out');
      expect(lettuceShow?.rawPayload?.isSoldOut).toBe(true);

      const rawEvents = parseZ2RawEvents(fixtureHtml);
      const lettuceRaw = rawEvents.find((e) => e.title.includes('Lettuce'));
      expect(lettuceRaw?.isSoldOut).toBe(true);
    });

    it('sets available inventory status and isSoldOut: false for non-sold-out shows', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const motetShow = candidates.find((c) => c.title.includes('The Motet'));

      expect(motetShow).toBeDefined();
      expect(motetShow?.inventoryStatus).toBe('unknown');
      expect(motetShow?.rawPayload?.isSoldOut).toBe(false);

      const rawEvents = parseZ2RawEvents(fixtureHtml);
      const motetRaw = rawEvents.find((e) => e.title.includes('The Motet'));
      expect(motetRaw?.isSoldOut).toBe(false);
    });
  });

  describe('Price Extraction & Free Admission', () => {
    it('extracts price ranges with min, max, and USD currency', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const motetShow = candidates.find((c) => c.title.includes('The Motet'));

      expect(motetShow?.price).toEqual({
        min: 25,
        max: 35,
        currency: 'USD',
        isFree: false,
      });
    });

    it('extracts ADV and DOS pricing as min/max range', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const kitchenDwellers = candidates.find((c) =>
        c.title.includes('Kitchen Dwellers'),
      );

      expect(kitchenDwellers?.price).toEqual({
        min: 20,
        max: 25,
        currency: 'USD',
        isFree: false,
      });
    });

    it('extracts flat single price as min === max', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const lettuceShow = candidates.find((c) => c.title.includes('Lettuce'));

      expect(lettuceShow?.price).toEqual({
        min: 30,
        max: 30,
        currency: 'USD',
        isFree: false,
      });
    });

    it('verifies free admission shows with isFree: true and eventKind: free_event', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const freeShow = candidates.find((c) =>
        c.title.includes('Boulder Philharmonic'),
      );

      expect(freeShow?.eventKind).toBe('free_event');
      expect(freeShow?.price).toEqual({
        isFree: true,
        min: 0,
        max: 0,
        currency: 'USD',
      });
    });

    it('safely handles missing or TBA prices without fabricating values', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const punkShow = candidates.find((c) =>
        c.title.includes('Colorado Punk Rock Night'),
      );

      expect(punkShow?.eventKind).toBe('concert');
      expect(punkShow?.price).toBeUndefined();
    });

    it('tests parseZ2Price utility against various representations', () => {
      expect(parseZ2Price('$25.00 - $35.00')).toEqual({
        min: 25,
        max: 35,
        currency: 'USD',
        isFree: false,
      });
      expect(parseZ2Price('$20 ADV / $25 DOS')).toEqual({
        min: 20,
        max: 25,
        currency: 'USD',
        isFree: false,
      });
      expect(parseZ2Price('$30')).toEqual({
        min: 30,
        max: 30,
        currency: 'USD',
        isFree: false,
      });
      expect(parseZ2Price('FREE')).toEqual({
        min: 0,
        max: 0,
        currency: 'USD',
        isFree: true,
      });
      expect(parseZ2Price('$0.00')).toEqual({
        min: 0,
        max: 0,
        currency: 'USD',
        isFree: true,
      });
      expect(parseZ2Price('TBA')).toBeUndefined();
      expect(parseZ2Price(null)).toBeUndefined();
      expect(parseZ2Price('')).toBeUndefined();
    });
  });

  describe('Edge Cases & Missing Attributes', () => {
    it('cleanly handles missing event image without throwing', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const punkShow = candidates.find((c) =>
        c.title.includes('Colorado Punk Rock Night'),
      );

      expect(punkShow).toBeDefined();
      expect(punkShow?.rawPayload?.imageUrl).toBeUndefined();
    });

    it('extracts primary AXS ticketing URLs and normalizes them', () => {
      const candidates = parseZ2Events(fixtureHtml, defaultContext);
      const motetShow = candidates.find((c) => c.title.includes('The Motet'));

      expect(motetShow?.ticketUrl).toBe(
        'https://www.axs.com/events/501001/the-motet-tickets',
      );
      expect(motetShow?.sourceEventId).toBe('axs-501001');
    });

    it('handles empty or malformed HTML safely without throwing', () => {
      expect(parseZ2Events('', defaultContext)).toEqual([]);
      expect(
        parseZ2Events('<div>No concerts here</div>', defaultContext),
      ).toEqual([]);
    });
  });
});
