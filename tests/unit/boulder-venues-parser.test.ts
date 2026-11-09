import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseVelvetElkEvents,
  parseVelvetElkArtistsFromTitle,
  parseDateHeading,
  VELVET_ELK_CONFIG,
  parseRootsMusicProjectEvents,
  parseRootsArtistsFromTitle,
  ROOTS_MUSIC_PROJECT_CONFIG,
} from '@/lib/sources/venue';

describe('Boulder Independent Venues Parsers', () => {
  const velvetListingHtml = fs.readFileSync(
    path.resolve(
      process.cwd(),
      'tests/fixtures/velvet-elk-events-response.html',
    ),
    'utf-8',
  );

  const velvetSingleEventHtml = fs.readFileSync(
    path.resolve(
      process.cwd(),
      'tests/fixtures/velvet-elk-single-event-response.html',
    ),
    'utf-8',
  );

  const rootsHtml = fs.readFileSync(
    path.resolve(
      process.cwd(),
      'tests/fixtures/roots-music-project-events-response.html',
    ),
    'utf-8',
  );

  describe('Velvet Elk Lounge (BentoBox)', () => {
    it('parses real Velvet Elk Lounge calendar listing fixture into 6 candidates', () => {
      const candidates = parseVelvetElkEvents(velvetListingHtml, {
        sourceId: VELVET_ELK_CONFIG.id!,
        sourceUrl: VELVET_ELK_CONFIG.calendarUrl,
        fetchedAt: '2026-11-09T20:00:00.000Z',
        defaultVenueConfig: VELVET_ELK_CONFIG,
      });

      expect(candidates).toHaveLength(6);

      // Verify non-music Happy Hour candidate
      const happyHour = candidates.find((c) => c.title === 'Happy Hour');
      expect(happyHour).toBeDefined();
      expect(happyHour?.artists).toHaveLength(0);
      expect(happyHour?.artistNames).toHaveLength(0);
      expect(happyHour?.localStartDate).toBeUndefined();

      // Verify The Galentines with Abernathy
      const galentines = candidates.find((c) =>
        c.title.includes('The Galentines'),
      );
      expect(galentines).toBeDefined();
      expect(galentines?.localStartDate).toBe('2026-11-13');
      expect(galentines?.startTimePrecision).toBe('date_only');
      expect(galentines?.venueName).toBe('Velvet Elk Lounge');
      expect(galentines?.city).toBe('Boulder');
      expect(galentines?.state).toBe('CO');
      expect(galentines?.timezone).toBe('America/Denver');
      expect(galentines?.artists).toHaveLength(2);
      expect(galentines?.artists?.[0]).toEqual({
        name: 'The Galentines',
        billingPosition: 'headliner',
        sortOrder: 1,
      });
      expect(galentines?.artists?.[1]).toEqual({
        name: 'Abernathy',
        billingPosition: 'support',
        sortOrder: 2,
      });

      // Verify Peach Rat
      const peachRat = candidates.find((c) => c.title === 'Peach Rat');
      expect(peachRat).toBeDefined();
      expect(peachRat?.localStartDate).toBe('2026-11-15');
      expect(peachRat?.artists).toHaveLength(1);
      expect(peachRat?.artists?.[0].name).toBe('Peach Rat');

      // Verify cancelled show: Robert Ellis with Wheelwright
      const cancelledShow = candidates.find((c) =>
        c.title.includes('Robert Ellis'),
      );
      expect(cancelledShow).toBeDefined();
      expect(cancelledShow?.localStartDate).toBe('2026-11-20');
      expect(cancelledShow?.resolutionProvenance).toEqual({
        status: 'cancelled',
      });
      expect(cancelledShow?.artists).toHaveLength(2);
      expect(cancelledShow?.artists?.[0].name).toBe('Robert Ellis');
      expect(cancelledShow?.artists?.[1].name).toBe('Wheelwright');
    });

    it('parses real Velvet Elk Lounge single event detail page fixture with instant precision and Etix link', () => {
      const candidates = parseVelvetElkEvents(velvetSingleEventHtml, {
        sourceId: VELVET_ELK_CONFIG.id!,
        sourceUrl:
          'https://www.velvetelklounge.com/event/november-13-the-galentine-with-abernathy/',
        fetchedAt: '2026-11-09T20:00:00.000Z',
        defaultVenueConfig: VELVET_ELK_CONFIG,
      });

      expect(candidates).toHaveLength(1);
      const event = candidates[0];

      expect(event.title).toBe('The Galentines with Abernathy');
      expect(event.localStartDate).toBe('2026-11-13');
      expect(event.startTimePrecision).toBe('instant');
      expect(event.startsAt).toBe('2026-11-14T03:00:00.000Z'); // 8:00 PM MST (UTC-7) = 03:00 UTC next day
      expect(event.ticketUrl).toBe(
        'https://www.etix.com/ticket/p/96771462/the-galentines-with-abernathy-boulder-velvet-elk-lounge',
      );
      expect(event.artists).toHaveLength(2);
      expect(event.artists?.[0].name).toBe('The Galentines');
      expect(event.artists?.[1].name).toBe('Abernathy');
    });

    describe('Velvet Elk Title & Date Utilities', () => {
      it('correctly splits headliner and support acts', () => {
        const res = parseVelvetElkArtistsFromTitle('Peach Rat with Abernathy');
        expect(res.cleanTitle).toBe('Peach Rat with Abernathy');
        expect(res.artists).toHaveLength(2);
        expect(res.artists[0].name).toBe('Peach Rat');
        expect(res.artists[0].billingPosition).toBe('headliner');
        expect(res.artists[1].name).toBe('Abernathy');
        expect(res.artists[1].billingPosition).toBe('support');
      });

      it('detects and strips cancellation markers', () => {
        const res = parseVelvetElkArtistsFromTitle(
          'Robert Ellis with Wheelwright (CANCELLED)',
        );
        expect(res.isCanceled).toBe(true);
        expect(res.cleanTitle).toBe('Robert Ellis with Wheelwright');
        expect(res.artists).toHaveLength(2);
      });

      it('detects explicit free show indicators', () => {
        const res = parseVelvetElkArtistsFromTitle(
          'Local Showcase (FREE SHOW)',
        );
        expect(res.isExplicitFree).toBe(true);
        expect(res.cleanTitle).toBe('Local Showcase');
      });

      it('identifies non-music bar events and returns empty artists array', () => {
        const res = parseVelvetElkArtistsFromTitle('Happy Hour');
        expect(res.artists).toHaveLength(0);
      });

      it('parses date headings across months and year boundaries', () => {
        const nov = parseDateHeading(
          'November 13, The Galentines',
          '2026-11-09T00:00:00Z',
        );
        expect(nov.localStartDate).toBe('2026-11-13');
        expect(nov.remainingTitle).toBe('The Galentines');

        const nextYearJan = parseDateHeading(
          'January 15th, Winter Residency',
          '2026-11-09T00:00:00Z',
        );
        expect(nextYearJan.localStartDate).toBe('2027-01-15');
        expect(nextYearJan.remainingTitle).toBe('Winter Residency');
      });
    });
  });

  describe('Roots Music Project (Eventbrite / Next.js JSON)', () => {
    it('parses real Roots Music Project calendar fixture into 12 candidates', () => {
      const candidates = parseRootsMusicProjectEvents(rootsHtml, {
        sourceId: ROOTS_MUSIC_PROJECT_CONFIG.id!,
        sourceUrl: ROOTS_MUSIC_PROJECT_CONFIG.calendarUrl,
        fetchedAt: '2026-11-09T20:00:00.000Z',
        defaultVenueConfig: ROOTS_MUSIC_PROJECT_CONFIG,
      });

      expect(candidates).toHaveLength(12);

      // Verify 2 non-music listings (workshop & art show) have empty artists for review routing
      const workshop = candidates.find((c) =>
        c.title.includes('RMP ONLINE WORKSHOP'),
      );
      expect(workshop).toBeDefined();
      expect(workshop?.artists).toHaveLength(0);
      expect(workshop?.artistNames).toHaveLength(0);

      const artShow = candidates.find((c) =>
        c.title.includes('Rock Photography Art Show'),
      );
      expect(artShow).toBeDefined();
      expect(artShow?.artists).toHaveLength(0);

      // Verify verified free admission show: OPEN DECKS DJ night (series without named performer routes to review)
      const openDecks = candidates.find((c) => c.title.includes('OPEN DECKS'));
      expect(openDecks).toBeDefined();
      expect(openDecks?.eventKind).toBe('free_event');
      expect(openDecks?.price).toEqual({
        isFree: true,
        min: 0,
        max: 0,
        currency: 'USD',
      });
      // Does not fabricate an artist named "OPEN DECKS"
      expect(openDecks?.artists).toHaveLength(0);
      expect(openDecks?.artistNames).toHaveLength(0);

      // Verify Assembly of Dust multi-night stand
      const night1 = candidates.find(
        (c) =>
          c.title.includes('Assembly of Dust') && c.title.includes('Night 1'),
      );
      expect(night1).toBeDefined();
      expect(night1?.localStartDate).toBe('2026-11-13');
      expect(night1?.startTimePrecision).toBe('instant');
      expect(night1?.price?.min).toBe(29.63);
      expect(night1?.price?.currency).toBe('USD');
      expect(night1?.artists?.[0].name).toBe('Assembly of Dust');

      const night2 = candidates.find(
        (c) =>
          c.title.includes('Assembly of Dust') && c.title.includes('Night 2'),
      );
      expect(night2).toBeDefined();
      expect(night2?.localStartDate).toBe('2026-11-14');
      expect(night2?.startTimePrecision).toBe('instant');
      expect(night2?.artists?.[0].name).toBe('Assembly of Dust');

      // Verify Dave ABear Jerry Band
      const jerryBand = candidates.find((c) =>
        c.title.includes('Dave ABear’s A Very Jerry Band'),
      );
      expect(jerryBand).toBeDefined();
      expect(jerryBand?.artists?.[0].name).toBe(
        'Dave ABear’s A Very Jerry Band',
      );
      expect(jerryBand?.price?.min).toBe(22.9);

      // Verify Lit Society w/ Riley J Band
      const litSociety = candidates.find((c) =>
        c.title.includes('Lit Society'),
      );
      expect(litSociety).toBeDefined();
      expect(litSociety?.artists).toHaveLength(2);
      expect(litSociety?.artists?.[0]).toEqual({
        name: 'Lit Society',
        billingPosition: 'headliner',
        sortOrder: 1,
      });
      expect(litSociety?.artists?.[1]).toEqual({
        name: 'Riley J Band',
        billingPosition: 'support',
        sortOrder: 2,
      });

      // Verify Soulsis multi-artist bill
      const soulsis = candidates.find((c) => c.title.includes('Soulsis'));
      expect(soulsis).toBeDefined();
      expect(soulsis?.artists).toHaveLength(5);
      expect(soulsis?.artists?.[0].name).toBe('Soulsis');
      expect(soulsis?.artists?.[1].name).toBe('Sierra Marin');
      expect(soulsis?.artists?.[2].name).toBe('Malka Russell');
      expect(soulsis?.artists?.[3].name).toBe('Kathleen Hooper of LVDY');
      expect(soulsis?.artists?.[4].name).toBe('Stella Lumina');

      // Verify event series / showcases without named artists route to review with empty artists
      const underground = candidates.find((c) =>
        c.title.includes('Roots Underground'),
      );
      expect(underground).toBeDefined();
      expect(underground?.artists).toHaveLength(0);

      const studentShowcase = candidates.find((c) =>
        c.title.includes('Student Songwriter'),
      );
      expect(studentShowcase).toBeDefined();
      expect(studentShowcase?.artists).toHaveLength(0);

      // Verify venue attribution across all candidates
      for (const c of candidates) {
        expect(c.venueName).toBe('Roots Music Project');
        expect(c.city).toBe('Boulder');
        expect(c.state).toBe('CO');
        expect(c.country).toBe('US');
        expect(c.timezone).toBe('America/Denver');
        expect(c.ticketUrl).toMatch(/^https:\/\/www\.eventbrite\.com\/e\//);
      }
    });

    describe('Roots Music Project Title Utilities', () => {
      it('correctly extracts headliner from pipe subtitle format', () => {
        const res = parseRootsArtistsFromTitle(
          "Assembly of Dust | Reid Genauer's Epic Two-Night Stand (Night 1)",
        );
        expect(res.artists).toHaveLength(1);
        expect(res.artists[0].name).toBe('Assembly of Dust');
      });

      it('correctly handles promoter presents patterns with actual performing artists', () => {
        const res = parseRootsArtistsFromTitle(
          'Live Nation presents The Wood Brothers',
        );
        expect(res.artists).toHaveLength(1);
        expect(res.artists[0].name).toBe('The Wood Brothers');
      });

      it('does not fabricate artists for event series, DJ nights, or open showcases', () => {
        const openDecks = parseRootsArtistsFromTitle(
          "OPEN DECKS: Boulder's Free All-Ages DJ Night",
        );
        expect(openDecks.artists).toHaveLength(0);
        expect(openDecks.isExplicitFree).toBe(true);

        const showcase = parseRootsArtistsFromTitle(
          "CU Student Songwriter's Showcase",
        );
        expect(showcase.artists).toHaveLength(0);

        const underground = parseRootsArtistsFromTitle(
          'Nonstandard Sound presents Roots Underground',
        );
        expect(underground.artists).toHaveLength(0);
      });

      it('identifies non-music workshops and art sales', () => {
        expect(
          parseRootsArtistsFromTitle(
            'RMP ONLINE WORKSHOP - Marketing for Musicians',
          ).artists,
        ).toHaveLength(0);
        expect(
          parseRootsArtistsFromTitle('Photography Art Show & Sale').artists,
        ).toHaveLength(0);
        expect(
          parseRootsArtistsFromTitle('Volunteer Kick-Off Meeting').artists,
        ).toHaveLength(0);
      });
    });
  });
});
