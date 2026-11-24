import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';
import type { Event, Artist, Venue, EventArtist } from '@/lib/domain/catalog';

describe('Opener Search & Deduplication Invariants (Agent 4 & QA)', () => {
  let repo: MemoryCatalogRepository;

  beforeEach(() => {
    repo = new MemoryCatalogRepository();

    // 1. Venues
    const venue: Venue = {
      id: 'venue-gothic',
      name: 'Gothic Theatre',
      normalizedName: 'gothic-theatre',
      city: 'Englewood',
      region: 'CO',
      countryCode: 'US',
      timezone: 'America/Denver',
    };
    repo.venues.set(venue.id, venue);

    // 2. Artists: Headliner and 2 Openers
    const headliner: Artist = {
      id: 'artist-khruangbin',
      name: 'Khruangbin',
      normalizedName: 'khruangbin',
    };
    const opener1: Artist = {
      id: 'artist-men-i-trust',
      name: 'Men I Trust',
      normalizedName: 'men-i-trust',
    };
    const opener2: Artist = {
      id: 'artist-peter-cat',
      name: 'Peter Cat Recording Co.',
      normalizedName: 'peter-cat-recording-co',
    };
    repo.artists.set(headliner.id, headliner);
    repo.artists.set(opener1.id, opener1);
    repo.artists.set(opener2.id, opener2);

    // 3. Event
    const event: Event = {
      id: 'event-khruangbin-gothic',
      name: 'Khruangbin with Men I Trust',
      normalizedName: 'khruangbin-with-men-i-trust',
      eventKind: 'concert',
      status: 'scheduled',
      venueId: venue.id,
      city: 'Englewood',
      region: 'CO',
      countryCode: 'US',
      timezone: 'America/Denver',
      localStartDate: '2026-10-10',
      startsAt: '2026-10-10T20:00:00-06:00',
      startTimePrecision: 'instant',
      isMultiDay: false,
      minPrice: 45,
      maxPrice: 85,
      currency: 'USD',
    };
    repo.events.set(event.id, event);

    // 4. Many-to-many Event-Artists relationships
    const eaHeadliner: EventArtist = {
      id: 'ea-1',
      eventId: event.id,
      artistId: headliner.id,
      billingPosition: 'headliner',
      sortOrder: 1,
    };
    const eaOpener1: EventArtist = {
      id: 'ea-2',
      eventId: event.id,
      artistId: opener1.id,
      billingPosition: 'support',
      sortOrder: 2,
    };
    const eaOpener2: EventArtist = {
      id: 'ea-3',
      eventId: event.id,
      artistId: opener2.id,
      billingPosition: 'support',
      sortOrder: 3,
    };
    repo.eventArtists.set(eaHeadliner.id!, eaHeadliner);
    repo.eventArtists.set(eaOpener1.id!, eaOpener1);
    repo.eventArtists.set(eaOpener2.id!, eaOpener2);
  });

  it('finds concert by searching for the opener / supporting artist name', async () => {
    const results = await repo.listEvents({
      searchQuery: 'Men I Trust',
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('event-khruangbin-gothic');
    expect(results[0].title).toBe('Khruangbin with Men I Trust');
    expect(results[0].artists).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Men I Trust',
          billingPosition: 'support',
        }),
      ]),
    );
  });

  it('finds concert by searching for a second supporting act not in the main event title', async () => {
    const results = await repo.listEvents({
      searchQuery: 'Peter Cat',
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('event-khruangbin-gothic');
    expect(results[0].artists).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Peter Cat Recording Co.',
          billingPosition: 'support',
        }),
      ]),
    );
  });

  it('never duplicates a concert when query matches both headliner and support artists', async () => {
    // Add another artist to event that shares a common keyword
    const commonArtist: Artist = {
      id: 'artist-common',
      name: 'Khruangbin Sound System',
      normalizedName: 'khruangbin-sound-system',
    };
    repo.artists.set(commonArtist.id, commonArtist);
    const eaCommon: EventArtist = {
      id: 'ea-4',
      eventId: 'event-khruangbin-gothic',
      artistId: commonArtist.id,
      billingPosition: 'support',
      sortOrder: 4,
    };
    repo.eventArtists.set(eaCommon.id!, eaCommon);

    // Query 'Khruangbin' matches headliner, event name, and support act
    const results = await repo.listEvents({
      searchQuery: 'Khruangbin',
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('event-khruangbin-gothic');
  });

  it('returns empty array when search query matches no performer or venue', async () => {
    const results = await repo.listEvents({
      searchQuery: 'Nonexistent Band Name 12345',
    });

    expect(results).toHaveLength(0);
  });
});
