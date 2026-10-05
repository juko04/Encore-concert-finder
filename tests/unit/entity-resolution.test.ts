import { beforeEach, describe, expect, it } from 'vitest';
import type { Event } from '@/lib/domain/catalog';
import { ArtistResolver } from '@/lib/entity-resolution/artist-resolver';
import { EventMatcher } from '@/lib/entity-resolution/event-matcher';
import { evaluateFieldMerge } from '@/lib/entity-resolution/field-merge';
import { VenueResolver } from '@/lib/entity-resolution/venue-resolver';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';
import { loadFixtures } from '../fixtures/fixture-helper';

describe('Entity Resolution Pipeline', () => {
  let catalogRepo: MemoryCatalogRepository;
  const fixtures = loadFixtures();

  beforeEach(() => {
    catalogRepo = new MemoryCatalogRepository();
  });

  describe('ArtistResolver', () => {
    const resolver = new ArtistResolver();

    it('resolves by stable external ID first', async () => {
      const created = await catalogRepo.createArtist({
        name: 'The National',
        normalizedName: 'national',
      });
      await catalogRepo.addArtistExternalId({
        artistId: created.id,
        provider: 'spotify',
        externalId: 'spotify_nat_123',
      });

      const result = await resolver.resolve(catalogRepo, {
        name: 'The National Band',
        externalIds: [{ provider: 'spotify', externalId: 'spotify_nat_123' }],
      });

      expect(result.artist.id).toBe(created.id);
      expect(result.isNew).toBe(false);
      expect(result.matchMethod).toBe('external_id');
    });

    it('resolves by normalized name if external ID is not present', async () => {
      const created = await catalogRepo.createArtist({
        name: 'Khruangbin',
        normalizedName: 'khruangbin',
      });

      const result = await resolver.resolve(catalogRepo, {
        name: '  Khruangbin  ',
      });

      expect(result.artist.id).toBe(created.id);
      expect(result.isNew).toBe(false);
      expect(result.matchMethod).toBe('normalized_name');
    });

    it('creates new canonical artist when no match exists', async () => {
      const result = await resolver.resolve(catalogRepo, {
        name: 'Unknown New Artist',
      });

      expect(result.isNew).toBe(true);
      expect(result.artist.name).toBe('Unknown New Artist');
      expect(result.matchMethod).toBe('created');
    });
  });

  describe('VenueResolver', () => {
    const resolver = new VenueResolver();

    it('resolves bidirectional alias: suffix to stripped and stripped to suffix', async () => {
      const venue = await catalogRepo.createVenue({
        name: 'Red Rocks Amphitheatre',
        normalizedName: 'red rocks amphitheatre',
        city: 'Morrison',
        region: 'CO',
        timezone: 'America/Denver',
      });

      // Query with stripped name
      const matchStripped = await resolver.resolve(catalogRepo, {
        name: 'Red Rocks',
        city: 'Morrison',
      });
      expect(matchStripped.id).toBe(venue.id);

      // Query with exact name
      const matchExact = await resolver.resolve(catalogRepo, {
        name: 'Red Rocks Amphitheatre',
        city: 'Morrison',
      });
      expect(matchExact.id).toBe(venue.id);
    });

    it('does not fabricate Colorado geography for non-Colorado venues (Finding 3)', async () => {
      const austinVenue = await resolver.resolve(catalogRepo, {
        name: 'Moody Amphitheater',
        city: 'Austin',
        region: 'TX',
        countryCode: 'US',
        timezone: 'America/Chicago',
      });

      expect(austinVenue.city).toBe('Austin');
      expect(austinVenue.region).toBe('TX');
      expect(austinVenue.timezone).toBe('America/Chicago');
      expect(austinVenue.city).not.toBe('Denver');
    });
  });

  describe('EventMatcher (Finding 6)', () => {
    const matcher = new EventMatcher();

    it('matches exact normalized ticket URL regardless of query tracking params', async () => {
      const venue = await catalogRepo.createVenue({
        name: 'Red Rocks Amphitheatre',
        normalizedName: 'red rocks amphitheatre',
        city: 'Morrison',
        timezone: 'America/Denver',
      });

      const existingEvent = await catalogRepo.createEvent({
        name: 'Khruangbin Live',
        normalizedName: 'khruangbin live',
        eventKind: 'concert',
        status: 'scheduled',
        venueId: venue.id,
        timezone: 'America/Denver',
        localStartDate: '2026-08-15',
        startTimePrecision: 'instant',
        isMultiDay: false,
      });

      await catalogRepo.linkTicketUrl({
        eventId: existingEvent.id,
        url: 'https://www.axs.com/events/10001/khruangbin',
        normalizedUrl: 'https://www.axs.com/events/10001/khruangbin',
      });

      // Candidate with dirty tracking parameters
      const candidate = fixtures.single_show;
      const result = await matcher.match(catalogRepo, candidate, venue.id, [
        'art_khruangbin',
      ]);

      expect(result.decision).toBe('match');
      expect(result.matchedEvent?.id).toBe(existingEvent.id);
      expect(result.reasons).toContain('exact_ticket_url_match');
    });

    it('prevents false merges when two shows at same venue and date share only an opening artist (Finding 6)', async () => {
      const venue = await catalogRepo.createVenue({
        name: 'Larimer Lounge',
        normalizedName: 'larimer lounge',
        city: 'Denver',
        timezone: 'America/Denver',
      });

      const opener = await catalogRepo.createArtist({
        name: 'Common Opener',
        normalizedName: 'common opener',
      });
      const acousticHeadliner = await catalogRepo.createArtist({
        name: 'Acoustic Master',
        normalizedName: 'acoustic master',
      });
      const rockHeadliner = await catalogRepo.createArtist({
        name: 'Electric Headliner',
        normalizedName: 'electric headliner',
      });

      // Existing Early Show: Acoustic Master (headliner), Common Opener (support)
      const earlyEvent = await catalogRepo.createEvent({
        name: 'Early Acoustic Showcase',
        normalizedName: 'early acoustic showcase',
        eventKind: 'concert',
        status: 'scheduled',
        venueId: venue.id,
        timezone: 'America/Denver',
        localStartDate: '2026-10-30',
        startTimePrecision: 'instant',
        isMultiDay: false,
      });
      await catalogRepo.linkEventArtist(
        earlyEvent.id,
        acousticHeadliner.id,
        'headliner',
        0,
      );
      await catalogRepo.linkEventArtist(earlyEvent.id, opener.id, 'support', 1);

      // Incoming Late Show candidate: Electric Headliner (headliner), Common Opener (support)
      const lateCandidate = fixtures.late_show_with_shared_opener;
      const resolvedArtistIds = [rockHeadliner.id, opener.id];

      const result = await matcher.match(
        catalogRepo,
        lateCandidate,
        venue.id,
        resolvedArtistIds,
      );

      // Must NOT auto-merge! Must be routed to needs_review
      expect(result.decision).toBe('needs_review');
      expect(result.reasons).toContain(
        'same_venue_and_date_opening_artist_overlap_requires_review',
      );
    });

    it('matches when same primary/headline artist is performing at same venue and date', async () => {
      const venue = await catalogRepo.createVenue({
        name: 'Red Rocks Amphitheatre',
        normalizedName: 'red rocks amphitheatre',
        city: 'Morrison',
        timezone: 'America/Denver',
      });

      const artist = await catalogRepo.createArtist({
        name: 'Khruangbin',
        normalizedName: 'khruangbin',
      });

      const existingEvent = await catalogRepo.createEvent({
        name: 'Khruangbin',
        normalizedName: 'khruangbin',
        eventKind: 'concert',
        status: 'scheduled',
        venueId: venue.id,
        timezone: 'America/Denver',
        localStartDate: '2026-08-15',
        startTimePrecision: 'instant',
        isMultiDay: false,
      });
      await catalogRepo.linkEventArtist(
        existingEvent.id,
        artist.id,
        'headliner',
        0,
      );

      // Candidate has no ticket URL but same venue, date, and headliner
      const candidate = {
        ...fixtures.single_show,
        ticketUrl: undefined,
      };

      const result = await matcher.match(catalogRepo, candidate, venue.id, [
        artist.id,
      ]);

      expect(result.decision).toBe('match');
      expect(result.matchedEvent?.id).toBe(existingEvent.id);
      expect(result.reasons).toContain('same_primary_artist');
    });
  });

  describe('FieldMerge', () => {
    it('upgrades date_only precision to instant when time is learned', () => {
      const current: Event = {
        id: 'evt_1',
        name: 'Bon Iver',
        normalizedName: 'bon iver',
        eventKind: 'concert',
        status: 'scheduled',
        venueId: 'ven_1',
        timezone: 'America/Denver',
        localStartDate: '2026-09-25',
        startTimePrecision: 'date_only',
        isMultiDay: false,
      };

      const candidate = fixtures.time_upgrade_observation;
      const outcome = evaluateFieldMerge(current, candidate);

      expect(outcome.updates.startTimePrecision).toBe('instant');
      expect(outcome.updates.startsAt).toBe(candidate.startsAt);
      expect(outcome.evidences.some((e) => e.fieldName === 'starts_at')).toBe(
        true,
      );
    });

    it('updates status to cancelled without deleting the event', () => {
      const current: Event = {
        id: 'evt_2',
        name: 'The Staves',
        normalizedName: 'staves',
        eventKind: 'concert',
        status: 'scheduled',
        venueId: 'ven_1',
        timezone: 'America/Denver',
        localStartDate: '2026-10-05',
        startTimePrecision: 'instant',
        isMultiDay: false,
      };

      const candidate = fixtures.cancelled_show;
      const outcome = evaluateFieldMerge(current, candidate);

      expect(outcome.updates.status).toBe('cancelled');
      expect(outcome.evidences.some((e) => e.fieldName === 'status')).toBe(
        true,
      );
    });
  });
});
