import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPersonalizedDiscoverData,
  getPublicDiscoverData,
} from '@/lib/recommendation/service';
import {
  MemoryCatalogRepository,
  MemoryProfileRepository,
  MemoryUserPreferenceRepository,
} from '@/lib/repositories/memory-repositories';

function seedEvent(
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
    city?: string;
    region?: string;
    lat?: number | null;
    lng?: number | null;
    minPrice?: number | null;
    currency?: string | null;
    artists?: Array<{
      id: string;
      name: string;
      billingPosition: 'headliner' | 'support';
    }>;
  },
) {
  const evId = event.id;
  repo.events.set(evId, {
    id: evId,
    name: event.title,
    normalizedName: event.title.toLowerCase(),
    eventKind: event.eventKind ?? 'concert',
    status: event.status ?? 'scheduled',
    venueId: `venue-${evId}`,
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

  repo.venues.set(`venue-${evId}`, {
    id: `venue-${evId}`,
    name: event.venueName ?? 'Local Club',
    normalizedName: (event.venueName ?? 'Local Club').toLowerCase(),
    city: event.city ?? 'Denver',
    region: event.region ?? 'CO',
    countryCode: 'US',
    lat: event.lat ?? 39.7392,
    lng: event.lng ?? -104.9903,
    timezone: event.timezone ?? 'America/Denver',
    website: null,
    capacity: null,
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
      maxPrice: event.minPrice + 20,
      currency: event.currency ?? 'USD',
      inventoryStatus: 'available',
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
        imageUrl: null,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      });
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

describe('Production Recommendation Service (getPersonalizedDiscoverData)', () => {
  let catalogRepo: MemoryCatalogRepository;
  let profileRepo: MemoryProfileRepository;
  let prefRepo: MemoryUserPreferenceRepository;

  beforeEach(() => {
    catalogRepo = new MemoryCatalogRepository();
    profileRepo = new MemoryProfileRepository();
    prefRepo = new MemoryUserPreferenceRepository(catalogRepo);
  });

  const referenceDate = '2026-10-25';
  const referenceInstant = '2026-10-25T12:00:00Z';

  it('retrieves preferred-artist events even when outside the general first-page limit', async () => {
    const userA = 'user-a-uuid';

    // Seed Chappell Roan event occurring in late December 2026 (beyond the 150 limit)
    seedEvent(catalogRepo, {
      id: 'event-chappell-future',
      title: 'Chappell Roan Live at Ball Arena',
      localStartDate: '2026-12-30',
      startsAt: '2026-12-30T20:00:00Z',
      venueName: 'Ball Arena',
      city: 'Denver',
      region: 'CO',
      lat: 39.7487,
      lng: -105.0076,
      minPrice: 65,
      currency: 'USD',
      artists: [
        {
          id: 'artist-chappell',
          name: 'Chappell Roan',
          billingPosition: 'headliner',
        },
      ],
    });

    // Seed User A with favorite preference for "Chappell Roan" (id: artist-chappell)
    await profileRepo.upsertProfile(userA, {
      recommendationPreset: 'balanced',
      homeLatApprox: 39.7392,
      homeLngApprox: -104.9903,
      defaultRadiusMiles: 25,
      maxNormalTicketPrice: 75,
    });
    await prefRepo.savePreference({
      userId: userA,
      artistId: 'artist-chappell',
      artistName: 'Chappell Roan',
      preferenceLevel: 'favorite',
    });

    const result = await getPersonalizedDiscoverData({
      userId: userA,
      profileRepo,
      prefRepo,
      catalogRepo,
      referenceDate,
      referenceInstant,
    });

    // Verify Chappell Roan was retrieved and ranked in recommendations
    expect(result.recommendations.length).toBeGreaterThan(0);
    const topRec = result.recommendations.find(
      (r) => r.eventId === 'event-chappell-future',
    );
    expect(topRec).toBeDefined();
    expect(topRec?.event.title).toBe('Chappell Roan Live at Ball Arena');
    expect(topRec?.score).toBeGreaterThan(80);
    expect(topRec?.explanation).toContain('Favorite artist (Chappell Roan)');
  });

  it('guarantees user preference isolation between User A and User B', async () => {
    const userA = 'user-a-isolation';
    const userB = 'user-b-isolation';

    await profileRepo.upsertProfile(userA, {
      recommendationPreset: 'artist_first',
      maxNormalTicketPrice: 50,
    });
    await profileRepo.upsertProfile(userB, {
      recommendationPreset: 'value',
      maxNormalTicketPrice: 100,
    });

    seedEvent(catalogRepo, {
      id: 'event-the-cure-1',
      title: 'The Cure at Fiddler’s Green',
      localStartDate: '2026-11-15',
      startsAt: '2026-11-15T19:00:00Z',
      venueName: 'Fiddler’s Green Amphitheatre',
      city: 'Greenwood Village',
      region: 'CO',
      minPrice: 45,
      currency: 'USD',
      artists: [
        {
          id: 'artist-the-cure',
          name: 'The Cure',
          billingPosition: 'headliner',
        },
      ],
    });

    // User A loves The Cure; User B has no preference
    await prefRepo.savePreference({
      userId: userA,
      artistId: 'artist-the-cure',
      artistName: 'The Cure',
      preferenceLevel: 'favorite',
    });

    const resultA = await getPersonalizedDiscoverData({
      userId: userA,
      profileRepo,
      prefRepo,
      catalogRepo,
      referenceDate,
      referenceInstant,
    });

    const resultB = await getPersonalizedDiscoverData({
      userId: userB,
      profileRepo,
      prefRepo,
      catalogRepo,
      referenceDate,
      referenceInstant,
    });

    // User A should have The Cure as a primary recommendation with high score
    expect(resultA.recommendations).toHaveLength(1);
    expect(resultA.recommendations[0].eventId).toBe('event-the-cure-1');
    expect(resultA.recommendations[0].explanation).toContain('Favorite artist');
    expect(resultA.activePreset).toBe('artist_first');

    // User B has no preference for The Cure: must appear in exploratory, NOT recommendations
    expect(resultB.recommendations).toHaveLength(0);
    expect(resultB.exploratory).toHaveLength(1);
    expect(resultB.exploratory[0].eventId).toBe('event-the-cure-1');
    expect(resultB.exploratory[0].explanation).not.toContain('Favorite artist');
    expect(resultB.activePreset).toBe('value');
  });

  it('returns truthful empty state when catalog has no upcoming events', async () => {
    const userA = 'user-empty-catalog';
    await profileRepo.upsertProfile(userA, {
      recommendationPreset: 'balanced',
    });

    const result = await getPersonalizedDiscoverData({
      userId: userA,
      profileRepo,
      prefRepo,
      catalogRepo,
      referenceDate,
      referenceInstant,
    });

    expect(result.isEmptyCatalog).toBe(true);
    expect(result.recommendations).toHaveLength(0);
    expect(result.exploratory).toHaveLength(0);
    expect(result.totalCandidateCount).toBe(0);
  });

  it('retrieves public discover data for signed-out visitors without personal scoring', async () => {
    seedEvent(catalogRepo, {
      id: 'event-public-1',
      title: 'Denver Jazz Festival',
      localStartDate: '2026-11-01',
      startsAt: '2026-11-01T18:00:00Z',
      eventKind: 'festival',
      venueName: 'City Park',
      city: 'Denver',
      region: 'CO',
      artists: [],
    });

    const result = await getPublicDiscoverData({
      catalogRepo,
      limit: 10,
    });

    expect(result.isEmptyCatalog).toBe(false);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe('event-public-1');
    expect(result.events[0].title).toBe('Denver Jazz Festival');
  });
});
