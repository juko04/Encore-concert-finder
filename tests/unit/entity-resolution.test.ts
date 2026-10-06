import { beforeEach, describe, expect, it } from 'vitest';
import type { Event } from '@/lib/domain/catalog';
import type { EventCandidate } from '@/lib/domain/event-candidate';
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

    it('disallows name-only matching against existing artist without external ID (routes to ambiguous)', async () => {
      await catalogRepo.createArtist({
        name: 'Khruangbin',
        normalizedName: 'khruangbin',
      });

      const outcome = await resolver.resolveOrPrepare(catalogRepo, {
        name: '  Khruangbin  ',
      });

      expect(outcome.status).toBe('ambiguous');
      expect(outcome.reasons).toContain(
        'name_only_match_against_existing_artist_requires_external_id_disambiguation',
      );
    });

    it('creates new canonical artist when no match exists', async () => {
      const result = await resolver.resolve(catalogRepo, {
        name: 'Unknown New Artist',
      });

      expect(result.isNew).toBe(true);
      expect(result.artist.name).toBe('Unknown New Artist');
      expect(result.matchMethod).toBe('created');
    });

    it('detects ambiguity when multiple artists share the same normalized name (Finding 5)', async () => {
      await catalogRepo.createArtist({
        name: 'Ghost (Swedish Metal)',
        normalizedName: 'ghost',
      });
      await catalogRepo.createArtist({
        name: 'Ghost (Japanese Psych Rock)',
        normalizedName: 'ghost',
      });

      const outcome = await resolver.resolveOrPrepare(catalogRepo, {
        name: 'Ghost',
      });

      expect(outcome.status).toBe('ambiguous');
      expect(outcome.reasons).toContain(
        'multiple_artists_with_same_name_requires_external_id',
      );
    });

    it('detects distinct artist when candidate external ID disagrees with existing artist external ID (Finding 5)', async () => {
      const existing = await catalogRepo.createArtist({
        name: 'Aurora',
        normalizedName: 'aurora',
      });
      await catalogRepo.addArtistExternalId({
        artistId: existing.id,
        provider: 'spotify',
        externalId: 'spotify_aurora_original',
      });

      const outcome = await resolver.resolveOrPrepare(catalogRepo, {
        name: 'Aurora',
        externalIds: [
          { provider: 'spotify', externalId: 'spotify_aurora_different' },
        ],
      });

      expect(outcome.status).toBe('to_create');
      expect(outcome.reasons).toContain(
        'conflicting_external_id_distinct_artist',
      );
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

    it('distinguishes identically named venues across different cities and regions', async () => {
      const sfVenue = await catalogRepo.createVenue({
        name: 'The Fillmore',
        normalizedName: 'the fillmore',
        city: 'San Francisco',
        region: 'CA',
        countryCode: 'US',
      });

      const outcome = await resolver.resolveOrPrepare(catalogRepo, {
        name: 'The Fillmore',
        city: 'Detroit',
        region: 'MI',
        countryCode: 'US',
      });

      // Must NOT match San Francisco venue
      expect(outcome.isNew).toBe(true);
      expect(outcome.venue?.id).not.toBe(sfVenue.id);
    });
  });

  describe('EventMatcher (Finding 6)', () => {
    const matcher = new EventMatcher();

    it('matches stable upstream sourceEventId as step 0 (Finding 7)', async () => {
      const venue = await catalogRepo.createVenue({
        name: 'Bluebird Theater',
        normalizedName: 'bluebird theater',
        city: 'Denver',
        timezone: 'America/Denver',
      });

      const existingEvent = await catalogRepo.createEvent({
        name: 'Local Show',
        normalizedName: 'local show',
        eventKind: 'concert',
        status: 'scheduled',
        venueId: venue.id,
        timezone: 'America/Denver',
        localStartDate: '2026-09-01',
        startTimePrecision: 'instant',
        isMultiDay: false,
      });

      // Record source record with sourceEventId
      await catalogRepo.recordEventSource({
        eventId: existingEvent.id,
        sourceId: 'a0000000-0000-0000-0000-000000000001',
        sourceEventId: 'event_998877',
        sourceUrl: 'https://example.com/events/998877',
        confidence: 0.95,
      });

      const candidate = {
        ...fixtures.single_show,
        sourceId: 'a0000000-0000-0000-0000-000000000001',
        sourceEventId: 'event_998877',
        localStartDate: '2026-09-01',
      };

      const result = await matcher.match(catalogRepo, candidate, venue.id, [
        '30000000-0000-0000-0000-000000000001',
      ]);
      expect(result.decision).toBe('match');
      expect(result.matchedEvent?.id).toBe(existingEvent.id);
      expect(result.reasons).toContain('exact_source_event_id_match');
      expect(result.confidence).toBe(1.0);
    });

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
        '30000000-0000-0000-0000-000000000002',
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
        id: '10000000-0000-0000-0000-000000000001',
        name: 'Bon Iver',
        normalizedName: 'bon iver',
        eventKind: 'concert',
        status: 'scheduled',
        venueId: '20000000-0000-0000-0000-000000000001',
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
        id: '10000000-0000-0000-0000-000000000002',
        name: 'The Staves',
        normalizedName: 'staves',
        eventKind: 'concert',
        status: 'scheduled',
        venueId: '20000000-0000-0000-0000-000000000001',
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

    it('handles rescheduling merge from Friday 8 PM to Saturday 9 PM and emits distinct evidence', () => {
      const current: Event = {
        id: '10000000-0000-0000-0000-000000000003',
        name: 'The Smile',
        normalizedName: 'the smile',
        eventKind: 'concert',
        status: 'scheduled',
        venueId: '20000000-0000-0000-0000-000000000001',
        timezone: 'America/Denver',
        localStartDate: '2026-10-16', // Friday
        startsAt: '2026-10-17T02:00:00Z', // Friday 8 PM MDT
        startTimePrecision: 'instant',
        isMultiDay: false,
      };

      const candidate: EventCandidate = {
        title: 'The Smile',
        artistNames: ['The Smile'],
        venueName: 'Mission Ballroom',
        timezone: 'America/Denver',
        localStartDate: '2026-10-17', // Saturday
        startsAt: '2026-10-18T03:00:00Z', // Saturday 9 PM MDT
        startTimePrecision: 'instant',
        confidence: 0.95,
        provenance: {
          sourceId: 'src_venue',
          sourceType: 'venue',
          acquisitionMethod: 'structured_json',
          sourceUrl: 'https://venue.com/rescheduled',
          contentHash: 'hash_reschedule',
          fetchedAt: '2026-10-10T12:00:00Z',
          confidence: 0.95,
          parserVersion: '1.0.0',
        },
        rawPayload: {
          isRescheduled: true,
          status: 'rescheduled',
        },
      };

      const outcome = evaluateFieldMerge(current, candidate);

      expect(outcome.updates.localStartDate).toBe('2026-10-17');
      expect(outcome.updates.startsAt).toBe('2026-10-18T03:00:00Z');
      expect(outcome.updates.status).toBe('rescheduled');

      const fieldNames = outcome.evidences.map((e) => e.fieldName);
      expect(fieldNames).toContain('local_start_date');
      expect(fieldNames).toContain('starts_at');
      expect(fieldNames).toContain('status');
      expect(outcome.evidences.length).toBe(3);
    });
  });
});
