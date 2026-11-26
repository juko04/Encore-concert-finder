import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPersonalizedFeed,
  RecommendationService,
  rankEvents,
  scoreEvent,
} from '@/lib/recommendation';
import {
  MemoryCatalogRepository,
  MemoryProfileRepository,
  MemorySpotifyConnectionRepository,
  MemoryUserPreferenceRepository,
} from '@/lib/repositories/memory-repositories';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { ScoringContext } from '@/lib/recommendation/types';

function seedTestEvent(
  repo: MemoryCatalogRepository,
  event: {
    id: string;
    title: string;
    localStartDate: string;
    startsAt?: string | null;
    timezone?: string;
    startTimePrecision?: 'instant' | 'date_only';
    status?: 'scheduled' | 'cancelled' | 'postponed';
    eventKind?: 'concert' | 'festival' | 'free_event';
    venueName?: string;
    venueId?: string;
    city?: string;
    region?: string;
    lat?: number | null;
    lng?: number | null;
    minPrice?: number | null;
    maxPrice?: number | null;
    currency?: string | null;
    inventoryStatus?: 'available' | 'low_inventory' | 'sold_out' | 'cancelled';
    artists?: Array<{
      id: string;
      name: string;
      billingPosition: 'headliner' | 'support' | 'subheadliner' | 'mid_card';
      spotifyArtistId?: string | null;
    }>;
  },
) {
  const evId = event.id;
  const vId = event.venueId ?? `venue-${evId}`;

  repo.events.set(evId, {
    id: evId,
    name: event.title,
    normalizedName: event.title.toLowerCase(),
    eventKind: event.eventKind ?? 'concert',
    status: event.status ?? 'scheduled',
    venueId: vId,
    city: event.city ?? 'Denver',
    region: event.region ?? 'CO',
    countryCode: 'US',
    lat: event.lat ?? 39.7392,
    lng: event.lng ?? -104.9903,
    timezone: event.timezone ?? 'America/Denver',
    localStartDate: event.localStartDate,
    localEndDate: null,
    startsAt: event.startsAt ?? `${event.localStartDate}T20:00:00Z`,
    endsAt: null,
    startTimePrecision: event.startTimePrecision ?? 'instant',
    doorsAt: null,
    isMultiDay: false,
    officialUrl: null,
    primaryTicketUrl: `https://tickets.example.com/${evId}`,
    announcedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  });

  repo.venues.set(vId, {
    id: vId,
    name: event.venueName ?? 'Red Rocks Amphitheatre',
    normalizedName: (event.venueName ?? 'Red Rocks Amphitheatre').toLowerCase(),
    city: event.city ?? 'Morrison',
    region: event.region ?? 'CO',
    countryCode: 'US',
    lat: event.lat ?? 39.6654,
    lng: event.lng ?? -105.2057,
    timezone: event.timezone ?? 'America/Denver',
    website: 'https://redrocksonline.com',
    capacity: 9525,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  });

  if (event.minPrice !== undefined && event.minPrice !== null) {
    repo.eventTicketLinks.set(`tl-${evId}`, {
      id: `tl-${evId}`,
      eventId: evId,
      ticketProviderSourceId: 'ticketmaster',
      url: `https://tickets.example.com/${evId}`,
      normalizedUrl: `https://tickets.example.com/${evId}`,
      minPrice: event.minPrice,
      maxPrice: event.maxPrice ?? event.minPrice + 25,
      currency: event.currency ?? 'USD',
      inventoryStatus: event.inventoryStatus ?? 'available',
      verifiedAt: '2026-10-01T00:00:00Z',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    });
  }

  if (event.artists) {
    for (let i = 0; i < event.artists.length; i++) {
      const a = event.artists[i];
      repo.artists.set(a.id, {
        id: a.id,
        name: a.name,
        normalizedName: a.name.toLowerCase(),
        imageUrl: `https://images.example.com/${a.id}.jpg`,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      });

      if (a.spotifyArtistId) {
        repo.artistExternalIds.set(`ext-${a.id}-spotify`, {
          id: `ext-${a.id}-spotify`,
          artistId: a.id,
          provider: 'spotify',
          externalId: a.spotifyArtistId,
          createdAt: '2026-10-01T00:00:00Z',
        });
      }

      repo.eventArtists.set(`ea-${evId}-${a.id}`, {
        id: `ea-${evId}-${a.id}`,
        eventId: evId,
        artistId: a.id,
        billingPosition: a.billingPosition,
        sortOrder: i,
        createdAt: '2026-10-01T00:00:00Z',
      });
    }
  }
}

describe('Index Search & Catalog Filtering Capabilities', () => {
  let catalogRepo: MemoryCatalogRepository;

  beforeEach(() => {
    catalogRepo = new MemoryCatalogRepository();
  });

  it('searches across BOTH headliners and support acts (openers)', async () => {
    seedTestEvent(catalogRepo, {
      id: 'event-bill-1',
      title: 'Tame Impala with Clairo',
      localStartDate: '2026-11-15',
      venueName: 'Mission Ballroom',
      artists: [
        { id: 'art-tame', name: 'Tame Impala', billingPosition: 'headliner' },
        { id: 'art-clairo', name: 'Clairo', billingPosition: 'support' },
      ],
    });

    seedTestEvent(catalogRepo, {
      id: 'event-bill-2',
      title: 'Khruangbin with Hermanos Gutiérrez',
      localStartDate: '2026-11-20',
      venueName: 'Red Rocks',
      artists: [
        { id: 'art-khru', name: 'Khruangbin', billingPosition: 'headliner' },
        {
          id: 'art-herm',
          name: 'Hermanos Gutiérrez',
          billingPosition: 'support',
        },
      ],
    });

    // Search by opener name
    const openerResults = await catalogRepo.listEvents({
      searchQuery: 'Clairo',
    });
    expect(openerResults).toHaveLength(1);
    expect(openerResults[0].id).toBe('event-bill-1');
    expect(openerResults[0].artists).toHaveLength(2);
    expect(
      openerResults[0].artists.some(
        (a) => a.name === 'Clairo' && a.billingPosition === 'support',
      ),
    ).toBe(true);

    // Search by headliner name
    const headlinerResults = await catalogRepo.listEvents({
      searchQuery: 'Khruangbin',
    });
    expect(headlinerResults).toHaveLength(1);
    expect(headlinerResults[0].id).toBe('event-bill-2');
  });

  it('searches by venue name', async () => {
    seedTestEvent(catalogRepo, {
      id: 'event-venue-1',
      title: 'Indie Night',
      localStartDate: '2026-11-10',
      venueName: 'Bluebird Theater',
    });
    seedTestEvent(catalogRepo, {
      id: 'event-venue-2',
      title: 'Rock Showcase',
      localStartDate: '2026-11-12',
      venueName: 'Ogden Theatre',
    });

    const results = await catalogRepo.listEvents({ searchQuery: 'Bluebird' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('event-venue-1');
    expect(results[0].venueName).toBe('Bluebird Theater');
  });

  it('filters by date range (fromDate / toDate)', async () => {
    seedTestEvent(catalogRepo, {
      id: 'event-nov-05',
      title: 'Early Nov Show',
      localStartDate: '2026-11-05',
    });
    seedTestEvent(catalogRepo, {
      id: 'event-nov-15',
      title: 'Mid Nov Show',
      localStartDate: '2026-11-15',
    });
    seedTestEvent(catalogRepo, {
      id: 'event-nov-25',
      title: 'Late Nov Show',
      localStartDate: '2026-11-25',
    });

    const filtered = await catalogRepo.listEvents({
      fromDate: '2026-11-10',
      toDate: '2026-11-20',
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('event-nov-15');
  });

  it('filters free events (freeOnly: true) capturing eventKind free_event and $0 tickets', async () => {
    seedTestEvent(catalogRepo, {
      id: 'event-free-kind',
      title: 'Civic Center Park Music Series',
      localStartDate: '2026-11-10',
      eventKind: 'free_event',
    });

    seedTestEvent(catalogRepo, {
      id: 'event-free-price',
      title: 'Community Open Mic',
      localStartDate: '2026-11-11',
      minPrice: 0,
    });

    seedTestEvent(catalogRepo, {
      id: 'event-paid',
      title: 'Major Touring Concert',
      localStartDate: '2026-11-12',
      minPrice: 45,
    });

    const freeEvents = await catalogRepo.listEvents({ freeOnly: true });
    expect(freeEvents).toHaveLength(2);
    const ids = freeEvents.map((e) => e.id);
    expect(ids).toContain('event-free-kind');
    expect(ids).toContain('event-free-price');
    expect(ids).not.toContain('event-paid');
  });

  it('filters by minPrice and maxPrice bounds', async () => {
    seedTestEvent(catalogRepo, {
      id: 'event-cheap',
      title: 'Local Band Night',
      localStartDate: '2026-11-10',
      minPrice: 15,
    });
    seedTestEvent(catalogRepo, {
      id: 'event-mid',
      title: 'Club Show',
      localStartDate: '2026-11-12',
      minPrice: 40,
    });
    seedTestEvent(catalogRepo, {
      id: 'event-expensive',
      title: 'Arena Tour',
      localStartDate: '2026-11-15',
      minPrice: 120,
    });

    const midRange = await catalogRepo.listEvents({
      minPrice: 20,
      maxPrice: 50,
    });

    expect(midRange).toHaveLength(1);
    expect(midRange[0].id).toBe('event-mid');
  });

  it('sorts by date ascending (date_asc)', async () => {
    seedTestEvent(catalogRepo, {
      id: 'show-c',
      title: 'Show Later',
      localStartDate: '2026-11-20',
    });
    seedTestEvent(catalogRepo, {
      id: 'show-a',
      title: 'Show Soon',
      localStartDate: '2026-11-05',
    });
    seedTestEvent(catalogRepo, {
      id: 'show-b',
      title: 'Show Mid',
      localStartDate: '2026-11-12',
    });

    const sorted = await catalogRepo.listEvents({ sortBy: 'date_asc' });
    expect(sorted.map((e) => e.id)).toEqual(['show-a', 'show-b', 'show-c']);
  });

  it('sorts by price ascending (price_asc) with unpriced events at the end', async () => {
    seedTestEvent(catalogRepo, {
      id: 'show-free',
      title: 'Free Park Show',
      localStartDate: '2026-11-10',
      eventKind: 'free_event',
    });
    seedTestEvent(catalogRepo, {
      id: 'show-tba',
      title: 'Price TBA Show',
      localStartDate: '2026-11-11',
      minPrice: null,
    });
    seedTestEvent(catalogRepo, {
      id: 'show-100',
      title: 'Expensive Show',
      localStartDate: '2026-11-12',
      minPrice: 100,
    });
    seedTestEvent(catalogRepo, {
      id: 'show-25',
      title: 'Affordable Show',
      localStartDate: '2026-11-13',
      minPrice: 25,
    });

    const sorted = await catalogRepo.listEvents({ sortBy: 'price_asc' });
    expect(sorted.map((e) => e.id)).toEqual([
      'show-free',
      'show-25',
      'show-100',
      'show-tba',
    ]);
  });

  it('returns complete CanonicalEventSummary with venues and ticket links with inventoryStatus', async () => {
    seedTestEvent(catalogRepo, {
      id: 'event-detailed',
      title: 'LCD Soundsystem 4-Night Run',
      localStartDate: '2026-11-18',
      venueName: 'Red Rocks Amphitheatre',
      venueId: 'venue-red-rocks',
      minPrice: 65,
      maxPrice: 120,
      inventoryStatus: 'low_inventory',
      artists: [
        {
          id: 'art-lcd',
          name: 'LCD Soundsystem',
          billingPosition: 'headliner',
        },
        { id: 'art-peaches', name: 'Peaches', billingPosition: 'support' },
      ],
    });

    const events = await catalogRepo.listEvents({ searchQuery: 'LCD' });
    expect(events).toHaveLength(1);
    const ev = events[0];

    // Verify complete artists
    expect(ev.artists).toHaveLength(2);
    expect(ev.artists[0].name).toBe('LCD Soundsystem');
    expect(ev.artists[0].billingPosition).toBe('headliner');
    expect(ev.artists[1].name).toBe('Peaches');
    expect(ev.artists[1].billingPosition).toBe('support');

    // Verify venue object
    expect(ev.venue).toBeDefined();
    expect(ev.venue?.name).toBe('Red Rocks Amphitheatre');
    expect(ev.venue?.capacity).toBe(9525);

    // Verify ticketLinks with inventoryStatus
    expect(ev.ticketLinks).toBeDefined();
    expect(ev.ticketLinks).toHaveLength(1);
    expect(ev.ticketLinks![0].inventoryStatus).toBe('low_inventory');
    expect(ev.ticketLinks![0].minPrice).toBe(65);
    expect(ev.ticketLinks![0].maxPrice).toBe(120);
  });
});

describe('Index Feed Integration & Factor Breakdown', () => {
  let catalogRepo: MemoryCatalogRepository;
  let profileRepo: MemoryProfileRepository;
  let prefRepo: MemoryUserPreferenceRepository;
  let spotifyRepo: MemorySpotifyConnectionRepository;

  const testUserId = 'user-index-editorial-01';

  beforeEach(async () => {
    catalogRepo = new MemoryCatalogRepository();
    profileRepo = new MemoryProfileRepository();
    prefRepo = new MemoryUserPreferenceRepository(catalogRepo);
    spotifyRepo = new MemorySpotifyConnectionRepository();

    await profileRepo.upsertProfile(testUserId, {
      homeLatApprox: 39.7392,
      homeLngApprox: -104.9903,
      defaultRadiusMiles: 25,
      maxNormalTicketPrice: 60,
      maxFavoriteArtistPrice: 120,
      maxSpontaneousPrice: 30,
      travelWillingness: 'moderate',
      recommendationPreset: 'balanced',
    });
  });

  it('produces clean ScoredEvent[] array with factor breakdowns and human-readable explanation', async () => {
    seedTestEvent(catalogRepo, {
      id: 'event-feed-1',
      title: 'Khruangbin at Red Rocks',
      localStartDate: '2026-11-20',
      minPrice: 50,
      lat: 39.6654,
      lng: -105.2057,
      artists: [
        { id: 'art-khru', name: 'Khruangbin', billingPosition: 'headliner' },
      ],
    });

    await prefRepo.savePreference({
      userId: testUserId,
      artistId: 'art-khru',
      artistName: 'Khruangbin',
      preferenceLevel: 'favorite',
    });

    const feed = await getPersonalizedFeed({
      userId: testUserId,
      catalogRepo,
      profileRepo,
      prefRepo,
      spotifyRepo,
      referenceDate: '2026-11-01',
    });

    expect(feed).toHaveLength(1);
    const scored = feed[0];

    // Assert ScoredEvent structure
    expect(scored.eventId).toBe('event-feed-1');
    expect(scored.score).toBeGreaterThan(0);
    expect(scored.matchedArtist?.name).toBe('Khruangbin');
    expect(scored.matchedArtist?.isFavorite).toBe(true);

    // Assert 4-factor breakdown format
    expect(scored.factors.artist).toBeDefined();
    expect(scored.factors.artist.factor).toBe('artist');
    expect(scored.factors.artist.score).toBe(100);
    expect(scored.factors.artist.weight).toBeGreaterThan(0);
    expect(scored.factors.artist.fieldStatus).toBe('verified');

    expect(scored.factors.distance).toBeDefined();
    expect(scored.factors.distance.factor).toBe('distance');
    expect(scored.factors.distance.score).toBeGreaterThan(0);
    expect(scored.factors.distance.isAvailable).toBe(true);

    expect(scored.factors.price).toBeDefined();
    expect(scored.factors.price.factor).toBe('price');
    expect(scored.factors.price.score).toBeGreaterThan(0);
    expect(scored.factors.price.isAvailable).toBe(true);

    // Timing is no longer a scored factor (only past-event eligibility remains)
    expect((scored.factors as Record<string, unknown>).timing).toBeUndefined();

    // Assert clean user-facing explanation for Index UI editorial view
    expect(scored.explanation).toContain('Favorite artist (Khruangbin)');
    expect(scored.explanation).toContain('mi');
    expect(scored.explanation).toContain('$50');
  });

  it('supports sorting in getPersonalizedFeed (score_desc, price_asc, date_asc)', async () => {
    seedTestEvent(catalogRepo, {
      id: 'event-fav-expensive',
      title: 'Favorite Artist Arena Show',
      localStartDate: '2026-11-25',
      minPrice: 90,
      artists: [
        { id: 'art-fav', name: 'Radiohead', billingPosition: 'headliner' },
      ],
    });
    seedTestEvent(catalogRepo, {
      id: 'event-like-cheap',
      title: 'Liked Artist Club Show',
      localStartDate: '2026-11-10',
      minPrice: 20,
      artists: [
        { id: 'art-like', name: 'Foals', billingPosition: 'headliner' },
      ],
    });

    await prefRepo.savePreference({
      userId: testUserId,
      artistId: 'art-fav',
      artistName: 'Radiohead',
      preferenceLevel: 'favorite',
    });
    await prefRepo.savePreference({
      userId: testUserId,
      artistId: 'art-like',
      artistName: 'Foals',
      preferenceLevel: 'like',
    });

    // Default score_desc: Favorite artist should rank highest
    const scoreSorted = await getPersonalizedFeed({
      userId: testUserId,
      catalogRepo,
      profileRepo,
      prefRepo,
      spotifyRepo,
      referenceDate: '2026-11-01',
      sortBy: 'score_desc',
    });
    expect(scoreSorted[0].eventId).toBe('event-fav-expensive');

    // price_asc: $20 show should rank first
    const priceSorted = await getPersonalizedFeed({
      userId: testUserId,
      catalogRepo,
      profileRepo,
      prefRepo,
      spotifyRepo,
      referenceDate: '2026-11-01',
      sortBy: 'price_asc',
    });
    expect(priceSorted[0].eventId).toBe('event-like-cheap');

    // date_asc: Nov 10 show should rank before Nov 25 show
    const dateSorted = await getPersonalizedFeed({
      userId: testUserId,
      catalogRepo,
      profileRepo,
      prefRepo,
      spotifyRepo,
      referenceDate: '2026-11-01',
      sortBy: 'date_asc',
    });
    expect(dateSorted[0].eventId).toBe('event-like-cheap');
  });

  it('supports RecommendationService object methods', () => {
    expect(typeof RecommendationService.rankEvents).toBe('function');
    expect(typeof RecommendationService.scoreEvent).toBe('function');
    expect(typeof RecommendationService.getPersonalizedFeed).toBe('function');
    expect(typeof RecommendationService.getPersonalizedDiscoverData).toBe(
      'function',
    );
  });
});

describe('Invariant 11: Manual Preference Precedence & Lineup Suppression', () => {
  const baseEventSummary: CanonicalEventSummary = {
    id: 'test-event-suppression',
    title: 'Festival Headliner Event',
    venueName: 'Ball Arena',
    venueId: 'venue-ball-arena',
    city: 'Denver',
    region: 'CO',
    lat: 39.7487,
    lng: -105.0076,
    localStartDate: '2026-11-20',
    startsAt: '2026-11-20T20:00:00Z',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    artists: [
      {
        id: 'art-headliner',
        name: 'Headliner Artist',
        billingPosition: 'headliner',
      },
      { id: 'art-support', name: 'Support Act', billingPosition: 'support' },
    ],
    minPrice: 50,
    maxPrice: 80,
    currency: 'USD',
  };

  function makePref(
    artistId: string,
    artistName: string,
    preferenceLevel: 'favorite' | 'like' | 'dislike',
  ) {
    return {
      id: `pref-${artistId}`,
      userId: 'user-1',
      artistId,
      artistName,
      normalizedArtistName: artistName.toLowerCase(),
      preferenceLevel,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    };
  }

  it('Invariant 11.1: Disliked headliner unconditionally suppresses event', () => {
    const context: ScoringContext = {
      artistPreferences: [
        makePref('art-headliner', 'Headliner Artist', 'dislike'),
        makePref('art-support', 'Support Act', 'favorite'),
      ],
      referenceDate: '2026-11-01',
    };

    const { scoredEvent } = scoreEvent(baseEventSummary, context);
    expect(scoredEvent.isSuppressed).toBe(true);
    expect(scoredEvent.score).toBe(0);
    expect(scoredEvent.suppressionReason).toContain('Headliner');
    expect(scoredEvent.suppressionReason).toContain('Not Interested');

    const ranked = rankEvents([baseEventSummary], context);
    expect(ranked.recommendations).toHaveLength(0);
    expect(ranked.suppressed).toHaveLength(1);
    expect(ranked.suppressed[0].eventId).toBe('test-event-suppression');
  });

  it('Invariant 11.2: Explicit Favorite headliner overrides disliked support act', () => {
    const context: ScoringContext = {
      artistPreferences: [
        makePref('art-headliner', 'Headliner Artist', 'favorite'),
        makePref('art-support', 'Support Act', 'dislike'),
      ],
      referenceDate: '2026-11-01',
    };

    const { scoredEvent } = scoreEvent(baseEventSummary, context);
    // MUST NOT be suppressed: Favorite headliner takes precedence!
    expect(scoredEvent.isSuppressed).toBe(false);
    expect(scoredEvent.score).toBeGreaterThan(0);
    expect(scoredEvent.factors.artist.score).toBe(100);
    expect(scoredEvent.factors.artist.explanation).toContain(
      'Favorite headliner',
    );
    expect(scoredEvent.factors.artist.explanation).toContain(
      'Support Act is marked Not Interested',
    );

    const ranked = rankEvents([baseEventSummary], context);
    expect(ranked.recommendations).toHaveLength(1);
    expect(ranked.suppressed).toHaveLength(0);
  });

  it('Invariant 11.3: Non-favorite headliner (liked or neutral) does NOT override disliked support act', () => {
    const context: ScoringContext = {
      artistPreferences: [
        makePref('art-headliner', 'Headliner Artist', 'like'),
        makePref('art-support', 'Support Act', 'dislike'),
      ],
      referenceDate: '2026-11-01',
    };

    const { scoredEvent } = scoreEvent(baseEventSummary, context);
    // Must be suppressed because headliner is only 'like', not 'favorite'
    expect(scoredEvent.isSuppressed).toBe(true);
    expect(scoredEvent.score).toBe(0);
  });

  it('Invariant 11.4: Manual preferences strictly take precedence over Spotify listening affinity', () => {
    // Artist is manual 'dislike' but Spotify #1 top artist
    const contextDislike: ScoringContext = {
      artistPreferences: [
        makePref('art-headliner', 'Headliner Artist', 'dislike'),
      ],
      spotifyTopArtists: [
        {
          id: 'spot-headliner',
          canonicalArtistId: 'art-headliner',
          name: 'Headliner Artist',
          rank: 1,
          timeRange: 'short_term',
          imageUrl: null,
          spotifyUrl: 'https://open.spotify.com/artist/spot-headliner',
          genres: ['rock'],
          popularity: 80,
        },
      ],
      referenceDate: '2026-11-01',
    };

    const { scoredEvent: scoredDislike } = scoreEvent(
      baseEventSummary,
      contextDislike,
    );
    // Manual dislike wins over Spotify affinity #1
    expect(scoredDislike.isSuppressed).toBe(true);
    expect(scoredDislike.score).toBe(0);

    // Artist is manual 'like' (score: 75) vs Spotify #1 affinity (score: 85)
    const contextLike: ScoringContext = {
      artistPreferences: [
        makePref('art-headliner', 'Headliner Artist', 'like'),
      ],
      spotifyTopArtists: [
        {
          id: 'spot-headliner',
          canonicalArtistId: 'art-headliner',
          name: 'Headliner Artist',
          rank: 1,
          timeRange: 'short_term',
          imageUrl: null,
          spotifyUrl: 'https://open.spotify.com/artist/spot-headliner',
          genres: ['rock'],
          popularity: 80,
        },
      ],
      referenceDate: '2026-11-01',
    };

    const { scoredEvent: scoredLike } = scoreEvent(
      baseEventSummary,
      contextLike,
    );
    // Explicit manual preference wins: scores 75 (Liked artist), not Spotify 85
    expect(scoredLike.factors.artist.score).toBe(75);
    expect(scoredLike.explanation).toContain('Liked artist');
    expect(scoredLike.explanation).not.toContain('Spotify');
  });
});
