import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseIndependentVenueEvents,
  parseArtistsFromTitle,
  resolveVenue,
  LARIMER_LOUNGE_CONFIG,
  LOST_LAKE_CONFIG,
  GLOBE_HALL_CONFIG,
} from '@/lib/sources/venue';

describe('Denver Independent Venue Group Parser', () => {
  const larimerHtml = fs.readFileSync(
    path.resolve(
      process.cwd(),
      'tests/fixtures/larimer-lounge-events-response.html',
    ),
    'utf-8',
  );

  const lostLakeHtml = fs.readFileSync(
    path.resolve(
      process.cwd(),
      'tests/fixtures/lost-lake-events-response.html',
    ),
    'utf-8',
  );

  const globeHallHtml = fs.readFileSync(
    path.resolve(
      process.cwd(),
      'tests/fixtures/globe-hall-events-response.html',
    ),
    'utf-8',
  );

  describe('Larimer Lounge (Grid View with Stages)', () => {
    it('parses real Larimer Lounge calendar fixture into 70 valid event candidates', () => {
      const candidates = parseIndependentVenueEvents(larimerHtml, {
        sourceId: LARIMER_LOUNGE_CONFIG.id!,
        sourceUrl: LARIMER_LOUNGE_CONFIG.calendarUrl,
        fetchedAt: '2026-11-07T20:00:00.000Z',
        defaultVenueConfig: LARIMER_LOUNGE_CONFIG,
      });

      expect(candidates).toHaveLength(70);

      // Verify all candidates have proper local start dates
      for (const c of candidates) {
        expect(c.localStartDate).toMatch(/^202[67]-\d{2}-\d{2}$/);
        expect(c.timezone).toBe('America/Denver');
        expect(c.country).toBe('US');
        expect(c.state).toBe('CO');
        // Non-negotiable price invariant: prices must be undefined (Price TBA)
        expect(c.price).toBeUndefined();
      }
    });

    it('correctly maps multi-stage spaces to physical venue identity', () => {
      const candidates = parseIndependentVenueEvents(larimerHtml, {
        sourceId: LARIMER_LOUNGE_CONFIG.id!,
        sourceUrl: LARIMER_LOUNGE_CONFIG.calendarUrl,
        fetchedAt: '2026-11-07T20:00:00.000Z',
        defaultVenueConfig: LARIMER_LOUNGE_CONFIG,
      });

      // Event 2 is main room Larimer Lounge
      const susto = candidates.find((c) => c.title.includes('Susto'));
      expect(susto).toBeDefined();
      expect(susto?.venueName).toBe('Larimer Lounge');
      expect(susto?.city).toBe('Denver');

      // Event 3 is Treehouse patio stage
      const mashbitPatio = candidates.find((c) =>
        c.title.includes('MashBit w/ Deelo'),
      );
      expect(mashbitPatio).toBeDefined();
      expect(mashbitPatio?.venueName).toBe('Larimer Lounge - Treehouse');

      // Event 4 is Campground outdoor stage
      const trillSain = candidates.find((c) =>
        c.title.includes('Trill Sain Sound Project'),
      );
      expect(trillSain).toBeDefined();
      expect(trillSain?.venueName).toBe('Larimer Lounge - Campground');
    });

    it('handles year rollover across December 2026 into 2027', () => {
      const candidates = parseIndependentVenueEvents(larimerHtml, {
        sourceId: LARIMER_LOUNGE_CONFIG.id!,
        sourceUrl: LARIMER_LOUNGE_CONFIG.calendarUrl,
        fetchedAt: '2026-11-07T20:00:00.000Z',
        defaultVenueConfig: LARIMER_LOUNGE_CONFIG,
      });

      const nyeShow = candidates.find((c) => c.title.includes('CEEJ NYE'));
      expect(nyeShow?.localStartDate).toBe('2026-12-31');

      const janShow = candidates.find((c) => c.title.includes('BJ Barham'));
      expect(janShow?.localStartDate).toBe('2027-01-10');

      const mayShow = candidates.find((c) => c.title.includes('Yellow House'));
      expect(mayShow?.localStartDate).toBe('2027-05-02');
    });

    it('identifies non-music listings without fabricating artists (routes to review)', () => {
      const candidates = parseIndependentVenueEvents(larimerHtml, {
        sourceId: LARIMER_LOUNGE_CONFIG.id!,
        sourceUrl: LARIMER_LOUNGE_CONFIG.calendarUrl,
        fetchedAt: '2026-11-07T20:00:00.000Z',
        defaultVenueConfig: LARIMER_LOUNGE_CONFIG,
      });

      // Gryffin Merch Pop-Up
      const merch = candidates.find((c) => c.title.includes('Merch Pop-Up'));
      expect(merch).toBeDefined();
      expect(merch?.artists).toEqual([]);
      expect(merch?.artistNames).toEqual([]);

      // Gryffin Bus to Show
      const bus = candidates.find((c) =>
        c.title.includes('Bus To Show Pickup Spot'),
      );
      expect(bus).toBeDefined();
      expect(bus?.artists).toEqual([]);

      // Pure Bingo night
      const bingo = candidates.find((c) =>
        c.title.startsWith('BASS BINGO- special'),
      );
      expect(bingo).toBeDefined();
      expect(bingo?.artists).toEqual([]);
    });

    it('extracts headliner and support billing with doors and show times', () => {
      const candidates = parseIndependentVenueEvents(larimerHtml, {
        sourceId: LARIMER_LOUNGE_CONFIG.id!,
        sourceUrl: LARIMER_LOUNGE_CONFIG.calendarUrl,
        fetchedAt: '2026-11-07T20:00:00.000Z',
        defaultVenueConfig: LARIMER_LOUNGE_CONFIG,
      });

      const susto = candidates.find((c) => c.title.includes('Susto'));
      expect(susto?.artists).toEqual([
        { name: 'Susto (solo)', billingPosition: 'headliner', sortOrder: 1 },
        { name: 'Jake Luna', billingPosition: 'support', sortOrder: 2 },
      ]);
      // Doors 4 pm, Show 5 pm Denver time -> UTC instant
      expect(susto?.startsAt).toBe('2026-11-08T00:00:00.000Z');
      expect(susto?.doorsOpenAt).toBe('2026-11-07T23:00:00.000Z');
      expect(susto?.startTimePrecision).toBe('instant');
      // Off-sale show suppresses javascript:void(0) link
      expect(susto?.ticketUrl).toBeUndefined();
    });
  });

  describe('Lost Lake Lounge (List View with Month Separators)', () => {
    it('parses real Lost Lake calendar fixture into 35 valid event candidates', () => {
      const candidates = parseIndependentVenueEvents(lostLakeHtml, {
        sourceId: LOST_LAKE_CONFIG.id!,
        sourceUrl: LOST_LAKE_CONFIG.calendarUrl,
        fetchedAt: '2026-11-07T20:00:00.000Z',
        defaultVenueConfig: LOST_LAKE_CONFIG,
      });

      expect(candidates).toHaveLength(35);

      for (const c of candidates) {
        expect(c.venueName).toBe('Lost Lake Lounge');
        expect(c.city).toBe('Denver');
        expect(c.state).toBe('CO');
        expect(c.ticketUrl).toMatch(/^https:\/\/www\.etix\.com\/ticket\/p\//);
        expect(c.provenance.sourceEventId).toMatch(/^etix-\d+$/);
      }
    });

    it('accurately parses multiple openers and tour titles', () => {
      const candidates = parseIndependentVenueEvents(lostLakeHtml, {
        sourceId: LOST_LAKE_CONFIG.id!,
        sourceUrl: LOST_LAKE_CONFIG.calendarUrl,
        fetchedAt: '2026-11-07T20:00:00.000Z',
        defaultVenueConfig: LOST_LAKE_CONFIG,
      });

      // "Capture This w/ Public Figure, Skiimo + All Things Considered"
      const captureThis = candidates[0];
      expect(captureThis.title).toBe(
        'Capture This w/ Public Figure, Skiimo + All Things Considered',
      );
      expect(captureThis.artists).toBeDefined();
      expect(captureThis.artists).toHaveLength(4);
      expect(captureThis.artists![0]).toEqual({
        name: 'Capture This',
        billingPosition: 'headliner',
        sortOrder: 1,
      });
      expect(captureThis.artists![1].name).toBe('Public Figure');
      expect(captureThis.artists![2].name).toBe('Skiimo');
      expect(captureThis.artists![3].name).toBe('All Things Considered');

      // Tour title stripping from headliner: "LETDOWN. – The Happy Tour w/ Luchiano, Sikarus + Poe The Passenger"
      const letdown = candidates.find((c) => c.title.includes('LETDOWN.'));
      expect(letdown).toBeDefined();
      expect(letdown?.artists?.[0].name).toBe('LETDOWN.');
      expect(letdown?.artists).toHaveLength(4);
    });
  });

  describe('Globe Hall (List View & Session Disambiguation)', () => {
    it('parses real Globe Hall calendar fixture into 44 valid event candidates', () => {
      const candidates = parseIndependentVenueEvents(globeHallHtml, {
        sourceId: GLOBE_HALL_CONFIG.id!,
        sourceUrl: GLOBE_HALL_CONFIG.calendarUrl,
        fetchedAt: '2026-11-07T20:00:00.000Z',
        defaultVenueConfig: GLOBE_HALL_CONFIG,
      });

      expect(candidates).toHaveLength(44);

      for (const c of candidates) {
        expect(c.venueName).toBe('Globe Hall');
        expect(c.city).toBe('Denver');
        expect(c.state).toBe('CO');
      }
    });

    it('distinguishes early and late shows on the same date for the same artist', () => {
      const candidates = parseIndependentVenueEvents(globeHallHtml, {
        sourceId: GLOBE_HALL_CONFIG.id!,
        sourceUrl: GLOBE_HALL_CONFIG.calendarUrl,
        fetchedAt: '2026-11-07T20:00:00.000Z',
        defaultVenueConfig: GLOBE_HALL_CONFIG,
      });

      const earlyShow = candidates.find((c) =>
        c.title.includes('Jonah Kagen (EARLY SHOW ADDED)'),
      );
      const lateShow = candidates.find((c) =>
        c.title.includes('Jonah Kagen (LATE SHOW)'),
      );

      expect(earlyShow).toBeDefined();
      expect(lateShow).toBeDefined();

      // Same date: 2026-11-08
      expect(earlyShow?.localStartDate).toBe('2026-11-08');
      expect(lateShow?.localStartDate).toBe('2026-11-08');

      // Headliner is cleaned of session markers
      expect(earlyShow?.artists?.[0].name).toBe('Jonah Kagen');
      expect(lateShow?.artists?.[0].name).toBe('Jonah Kagen');

      // Start times differ by 4 hours (Doors 3 pm Show 4 pm vs Doors 7 pm Show 8 pm)
      expect(earlyShow?.startsAt).toBe('2026-11-08T23:00:00.000Z');
      expect(lateShow?.startsAt).toBe('2026-11-09T03:00:00.000Z');

      // Distinct Etix ticket links and source event IDs
      expect(earlyShow?.ticketUrl).toContain('93583460');
      expect(lateShow?.ticketUrl).toContain('43050308');
      expect(earlyShow?.provenance.sourceEventId).toBe('etix-93583460');
      expect(lateShow?.provenance.sourceEventId).toBe('etix-43050308');
    });

    it('accurately identifies sold-out events from CSS classes', () => {
      const candidates = parseIndependentVenueEvents(globeHallHtml, {
        sourceId: GLOBE_HALL_CONFIG.id!,
        sourceUrl: GLOBE_HALL_CONFIG.calendarUrl,
        fetchedAt: '2026-11-07T20:00:00.000Z',
        defaultVenueConfig: GLOBE_HALL_CONFIG,
      });

      const soldOut = candidates.filter(
        (c) => c.rawPayload?.isSoldOut === true,
      );
      expect(soldOut.length).toBeGreaterThanOrEqual(8);

      const earlyShow = candidates.find((c) =>
        c.title.includes('Jonah Kagen (EARLY SHOW ADDED)'),
      );
      expect(earlyShow?.rawPayload?.isSoldOut).toBe(true);
    });
  });

  describe('Venue Resolution & Offsite Protection', () => {
    it('resolves known offsite co-promotions correctly', () => {
      const mission = resolveVenue('Mission Ballroom');
      expect(mission.venueName).toBe('Mission Ballroom');
      expect(mission.city).toBe('Denver');
      expect(mission.state).toBe('CO');

      const ogden = resolveVenue('Ogden Theatre');
      expect(ogden.venueName).toBe('Ogden Theatre');
      expect(ogden.city).toBe('Denver');

      const redRocks = resolveVenue('Red Rocks Amphitheatre');
      expect(redRocks.venueName).toBe('Red Rocks Amphitheatre');
      expect(redRocks.city).toBe('Morrison');
    });

    it('extracts city from eventUrl slug if offsite venue is not in known map', () => {
      const offsite = resolveVenue(
        'eTown Hall',
        'https://lost-lake.com/event/acoustic-show/etown-hall/boulder-colorado/',
      );
      expect(offsite.venueName).toBe('eTown Hall');
      expect(offsite.city).toBe('Boulder');
      expect(offsite.state).toBe('CO');
    });

    it('omits city and state when unknown offsite venue has no locality evidence', () => {
      const unknown = resolveVenue('Secret Warehouse');
      expect(unknown.venueName).toBe('Secret Warehouse');
      expect(unknown.city).toBeUndefined();
      expect(unknown.state).toBeUndefined();
    });
  });

  describe('parseArtistsFromTitle Edge Cases', () => {
    it('handles cancelled shows without leaving cancel in artist name', () => {
      const parsed = parseArtistsFromTitle('CANCELLED: The Band w/ Opener');
      expect(parsed.isCanceled).toBe(true);
      expect(parsed.cleanTitle).toBe('The Band w/ Opener');
      expect(parsed.artists[0].name).toBe('The Band');
      expect(parsed.artists[1].name).toBe('Opener');
    });

    it('handles promoter presents prefixes cleanly', () => {
      const parsed = parseArtistsFromTitle(
        'SiriusXM Octane Presents Ninth Key w/ AWAY + Overtime Winner',
      );
      expect(parsed.artists[0].name).toBe('Ninth Key');
      expect(parsed.artists[1].name).toBe('AWAY');
      expect(parsed.artists[2].name).toBe('Overtime Winner');
    });

    it('handles recurring electronic Open House series', () => {
      const parsed = parseArtistsFromTitle(
        'Open House feat. FENIK – Tedd Adam – Calvin Campbell b2b Crisco',
      );
      expect(parsed.artists[0]).toEqual({
        name: 'FENIK',
        billingPosition: 'headliner',
        sortOrder: 1,
      });
      expect(parsed.artists[1].name).toBe('Tedd Adam');
      expect(parsed.artists[2].name).toBe('Calvin Campbell b2b Crisco');
    });
  });
});
