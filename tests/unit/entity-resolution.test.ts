import { describe, expect, it } from 'vitest';
import { ArtistResolver } from '@/lib/entity-resolution/artist-resolver';
import { VenueResolver } from '@/lib/entity-resolution/venue-resolver';
import { EventMatcher } from '@/lib/entity-resolution/event-matcher';
import { evaluateFieldMerge } from '@/lib/entity-resolution/field-merge';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';
import type { Event } from '@/lib/domain/catalog';
import type { EventCandidate } from '@/lib/domain/event-candidate';

describe('Entity Resolution Components', () => {
  describe('ArtistResolver', () => {
    it('creates a new canonical artist when none exists', async () => {
      const repo = new MemoryCatalogRepository();
      const resolver = new ArtistResolver();

      const artist = await resolver.resolve(repo, {
        name: 'The Mountain Goats',
      });
      expect(artist.id).toBeDefined();
      expect(artist.name).toBe('The Mountain Goats');
      expect(artist.normalizedName).toBe('mountain goats');

      const found = await repo.findArtistByName('mountain goats');
      expect(found?.id).toBe(artist.id);
    });

    it('reuses existing artist with matching normalized name', async () => {
      const repo = new MemoryCatalogRepository();
      const resolver = new ArtistResolver();

      const artist1 = await resolver.resolve(repo, { name: 'Mountain Goats' });
      const artist2 = await resolver.resolve(repo, {
        name: 'The Mountain Goats',
      });

      expect(artist1.id).toBe(artist2.id);
    });

    it('resolves and links external provider IDs', async () => {
      const repo = new MemoryCatalogRepository();
      const resolver = new ArtistResolver();

      const artist = await resolver.resolve(repo, {
        name: 'Big Thief',
        externalId: {
          provider: 'ticketmaster',
          externalId: 'tm_12345',
        },
      });

      const matchedByExt = await repo.findArtistByExternalId(
        'ticketmaster',
        'tm_12345',
      );
      expect(matchedByExt?.id).toBe(artist.id);
    });
  });

  describe('VenueResolver', () => {
    it('creates a new venue when none exists', async () => {
      const repo = new MemoryCatalogRepository();
      const resolver = new VenueResolver();

      const venue = await resolver.resolve(repo, {
        name: 'Gothic Theatre',
        city: 'Englewood',
        region: 'CO',
      });

      expect(venue.id).toBeDefined();
      expect(venue.name).toBe('Gothic Theatre');
      expect(venue.city).toBe('Englewood');
    });

    it('reuses existing venue in same city with normalized name', async () => {
      const repo = new MemoryCatalogRepository();
      const resolver = new VenueResolver();

      const v1 = await resolver.resolve(repo, {
        name: 'Gothic Theatre',
        city: 'Englewood',
      });
      const v2 = await resolver.resolve(repo, {
        name: 'The Gothic Theatre',
        city: 'Englewood',
      });

      expect(v1.id).toBe(v2.id);
    });

    it('resolves common venue aliases in same city', async () => {
      const repo = new MemoryCatalogRepository();
      const resolver = new VenueResolver();

      const v1 = await resolver.resolve(repo, {
        name: 'Red Rocks Amphitheatre',
        city: 'Morrison',
      });
      const v2 = await resolver.resolve(repo, {
        name: 'Red Rocks',
        city: 'Morrison',
      });

      expect(v1.id).toBe(v2.id);
    });

    it('does not merge venues with same name in different cities', async () => {
      const repo = new MemoryCatalogRepository();
      const resolver = new VenueResolver();

      const vDenver = await resolver.resolve(repo, {
        name: 'Bluebird Theater',
        city: 'Denver',
      });
      const vBloomington = await resolver.resolve(repo, {
        name: 'Bluebird Nightclub',
        city: 'Bloomington',
      });

      expect(vDenver.id).not.toBe(vBloomington.id);
    });
  });

  describe('EventMatcher', () => {
    it('matches by exact normalized ticket URL', async () => {
      const repo = new MemoryCatalogRepository();
      const matcher = new EventMatcher();

      const event = await repo.createEvent({
        name: 'Waxahatchee Live',
        normalizedName: 'waxahatchee live',
        eventKind: 'concert',
        status: 'scheduled',
        venueId: 'v1',
        timezone: 'America/Denver',
        localStartDate: '2026-10-15',
        startTimePrecision: 'instant',
        isMultiDay: false,
      });

      await repo.addEventTicketLink({
        eventId: event.id,
        url: 'https://tickets.example.com/events/waxa-1015',
        inventoryStatus: 'available',
      });

      const candidate: EventCandidate = {
        title: 'Waxahatchee at Bluebird',
        artistNames: ['Waxahatchee'],
        venueName: 'Bluebird Theater',
        localStartDate: '2026-10-15',
        ticketUrl: 'https://tickets.example.com/events/waxa-1015?utm_source=ig',
        confidence: 0.95,
        provenance: {} as any,
      };

      const result = await matcher.match(repo, candidate, 'v1', []);
      expect(result.decision).toBe('match');
      expect(result.matchedEvent?.id).toBe(event.id);
      expect(result.reasons).toContain('exact_ticket_url_match');
    });

    it('matches when same venue, same date, and artists overlap', async () => {
      const repo = new MemoryCatalogRepository();
      const matcher = new EventMatcher();

      const artist = await repo.createArtist({
        name: 'Khruangbin',
        normalizedName: 'khruangbin',
      });

      const event = await repo.createEvent({
        name: 'Khruangbin at Red Rocks',
        normalizedName: 'khruangbin at red rocks',
        eventKind: 'concert',
        status: 'scheduled',
        venueId: 'v_rr',
        timezone: 'America/Denver',
        localStartDate: '2026-09-15',
        startTimePrecision: 'instant',
        isMultiDay: false,
      });

      await repo.linkEventArtist(event.id, artist.id, 'headliner', 0);

      const candidate: EventCandidate = {
        title: 'Khruangbin with Hermanos Gutiérrez',
        artistNames: ['Khruangbin', 'Hermanos Gutiérrez'],
        venueName: 'Red Rocks Amphitheatre',
        localStartDate: '2026-09-15',
        confidence: 0.95,
        provenance: {} as any,
      };

      const result = await matcher.match(repo, candidate, 'v_rr', [artist.id]);
      expect(result.decision).toBe('match');
      expect(result.matchedEvent?.id).toBe(event.id);
      expect(result.reasons).toContain('overlapping_artists');
    });

    it('marks needs_review when same venue and date but artists differ completely', async () => {
      const repo = new MemoryCatalogRepository();
      const matcher = new EventMatcher();

      const artistA = await repo.createArtist({
        name: 'Indie Rock Band',
        normalizedName: 'indie rock band',
      });

      const event = await repo.createEvent({
        name: 'Indie Rock Show',
        normalizedName: 'indie rock show',
        eventKind: 'concert',
        status: 'scheduled',
        venueId: 'v_bluebird',
        timezone: 'America/Denver',
        localStartDate: '2026-10-12',
        startTimePrecision: 'instant',
        isMultiDay: false,
      });

      await repo.linkEventArtist(event.id, artistA.id, 'headliner', 0);

      const candidate: EventCandidate = {
        title: 'Standup Comedy Night',
        artistNames: ['Comedian One', 'Comedian Two'],
        venueName: 'Bluebird Theater',
        localStartDate: '2026-10-12',
        confidence: 0.9,
        provenance: {} as any,
      };

      const result = await matcher.match(repo, candidate, 'v_bluebird', []);
      expect(result.decision).toBe('needs_review');
      expect(result.reasons).toContain('same_venue_and_date_different_artists');
    });
  });

  describe('FieldMerge rules', () => {
    it('upgrades date_only precision to instant when startsAt is provided', () => {
      const current: Event = {
        id: 'e1',
        name: 'Big Thief',
        normalizedName: 'big thief',
        eventKind: 'concert',
        status: 'scheduled',
        timezone: 'America/Denver',
        localStartDate: '2026-10-20',
        startTimePrecision: 'date_only',
        isMultiDay: false,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      };

      const candidate: EventCandidate = {
        title: 'Big Thief Live',
        artistNames: ['Big Thief'],
        venueName: 'Red Rocks',
        startsAt: '2026-10-21T01:30:00Z',
        confidence: 0.95,
        provenance: {} as any,
      };

      const { updates, evidences } = evaluateFieldMerge(current, candidate);
      expect(updates.startTimePrecision).toBe('instant');
      expect(updates.startsAt).toBe('2026-10-21T01:30:00Z');
      expect(evidences.some((e) => e.fieldName === 'starts_at')).toBe(true);
    });

    it('updates status to cancelled without deleting the canonical event', () => {
      const current: Event = {
        id: 'e1',
        name: 'Japanese Breakfast',
        normalizedName: 'japanese breakfast',
        eventKind: 'concert',
        status: 'scheduled',
        timezone: 'America/Denver',
        localStartDate: '2026-09-22',
        startTimePrecision: 'instant',
        startsAt: '2026-09-23T02:00:00Z',
        isMultiDay: false,
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
      };

      const candidate: EventCandidate = {
        title: 'Japanese Breakfast (CANCELLED)',
        artistNames: ['Japanese Breakfast'],
        venueName: 'Gothic Theatre',
        confidence: 0.95,
        rawPayload: { status: 'cancelled' },
        provenance: {} as any,
      };

      const { updates, evidences } = evaluateFieldMerge(current, candidate);
      expect(updates.status).toBe('cancelled');
      expect(evidences.some((e) => e.fieldName === 'status')).toBe(true);
    });
  });
});
