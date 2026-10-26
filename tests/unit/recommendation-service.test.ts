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

  it('retrieves preferred-artist events even when outside the general first-page limit (>150 earlier events)', async () => {
    const userA = 'user-a-uuid';

    // Seed 160 earlier general events for neutral artists (dates Nov 01 to Nov 16)
    for (let i = 0; i < 160; i++) {
      const day = String(Math.floor(i / 10) + 1).padStart(2, '0');
      const padIndex = String(i).padStart(3, '0');
      seedEvent(catalogRepo, {
        id: `event-general-${padIndex}`,
        title: `Indie Night ${padIndex}`,
        localStartDate: `2026-11-${day}`,
        startsAt: `2026-11-${day}T20:00:00Z`,
        venueName: 'General Club',
        city: 'Denver',
        minPrice: 25,
        artists: [
          {
            id: `artist-neutral-${padIndex}`,
            name: `Neutral Artist ${padIndex}`,
            billingPosition: 'headliner',
          },
        ],
      });
    }

    // Seed favored Chappell Roan event occurring later (Dec 30), well beyond the 150 general page limit
    seedEvent(catalogRepo, {
      id: 'event-chappell-fav-beyond-150',
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

    // Verify Chappell Roan was retrieved via Tier 1 preferred-artist candidate retrieval
    // and ranked at the top of recommendations despite being beyond event #150
    expect(result.recommendations.length).toBeGreaterThan(0);
    const topRec = result.recommendations.find(
      (r) => r.eventId === 'event-chappell-fav-beyond-150',
    );
    expect(topRec).toBeDefined();
    expect(topRec?.event.title).toBe('Chappell Roan Live at Ball Arena');
    expect(topRec?.score).toBeGreaterThan(80);
    expect(topRec?.explanation).toContain('Favorite artist (Chappell Roan)');

    // Verify that for a user with NO preferences, this event is NOT retrieved because it exceeds the 150-event general limit
    const unprefResult = await getPersonalizedDiscoverData({
      userId: 'user-no-pref',
      profileRepo,
      prefRepo,
      catalogRepo,
      referenceDate,
      referenceInstant,
    });
    const foundInUnpref = [
      ...unprefResult.recommendations,
      ...unprefResult.exploratory,
    ].find((r) => r.eventId === 'event-chappell-fav-beyond-150');
    expect(foundInUnpref).toBeUndefined();
  });

  it('bounds preferred-artist candidate pool overflow to PREFERRED_ARTIST_CANDIDATE_LIMIT (100 events)', async () => {
    const userA = 'user-overflow';

    await profileRepo.upsertProfile(userA, {
      recommendationPreset: 'artist_first',
    });

    catalogRepo.artists.set('artist-fav-overflow', {
      id: 'artist-fav-overflow',
      name: 'Prolific Favorite Artist',
      normalizedName: 'prolific favorite artist',
      imageUrl: null,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    });

    await prefRepo.savePreference({
      userId: userA,
      artistId: 'artist-fav-overflow',
      artistName: 'Prolific Favorite Artist',
      preferenceLevel: 'favorite',
    });

    // Seed 150 earlier neutral events to exhaust the Tier 2 general catalog pool
    for (let i = 0; i < 150; i++) {
      const padIndex = String(i).padStart(3, '0');
      seedEvent(catalogRepo, {
        id: `event-earlier-neutral-${padIndex}`,
        title: `Earlier Event ${padIndex}`,
        localStartDate: '2026-10-28',
        startsAt: '2026-10-28T20:00:00Z',
        venueName: 'General Club',
        city: 'Denver',
        minPrice: 20,
        artists: [
          {
            id: `artist-neutral-${padIndex}`,
            name: `Neutral Artist ${padIndex}`,
            billingPosition: 'headliner',
          },
        ],
      });
    }

    // Seed 110 events for this single favorite artist occurring after the neutral events
    for (let i = 0; i < 110; i++) {
      const month = i < 60 ? '11' : '12';
      const day = String((i % 28) + 1).padStart(2, '0');
      const padIndex = String(i).padStart(3, '0');
      seedEvent(catalogRepo, {
        id: `event-overflow-${padIndex}`,
        title: `Tour Stop ${padIndex}`,
        localStartDate: `2026-${month}-${day}`,
        startsAt: `2026-${month}-${day}T20:00:00Z`,
        venueName: 'The Fillmore',
        city: 'Denver',
        minPrice: 40,
        artists: [
          {
            id: 'artist-fav-overflow',
            name: 'Prolific Favorite Artist',
            billingPosition: 'headliner',
          },
        ],
      });
    }

    const result = await getPersonalizedDiscoverData({
      userId: userA,
      profileRepo,
      prefRepo,
      catalogRepo,
      referenceDate,
      referenceInstant,
    });

    // Tier 1 preferred-artist candidate query bounds retrieval to exactly 100 events
    expect(result.recommendations.length).toBe(100);

    // Event #109 (the 110th favorite event) was beyond both Tier 1 (100 cap) and Tier 2 (filled by 150 earlier events)
    const overflowEvent = [
      ...result.recommendations,
      ...result.exploratory,
    ].find((r) => r.eventId === 'event-overflow-109');
    expect(overflowEvent).toBeUndefined();
  });

  it('resolves unlinked Spotify preferences via artist_external_ids mapping', async () => {
    const userA = 'user-spotify-resolution';

    await profileRepo.upsertProfile(userA, {
      recommendationPreset: 'balanced',
    });

    // Save preference with ONLY spotifyArtistId, no canonical artistId
    const unlinkedPrefRepo = new MemoryUserPreferenceRepository();
    await unlinkedPrefRepo.savePreference({
      userId: userA,
      artistName: 'Phoebe Bridgers',
      preferenceLevel: 'favorite',
      spotifyArtistId: 'spotify-phoebe-123',
    });

    // External ID mapping in catalog maps 'spotify-phoebe-123' -> 'artist-phoebe-canonical'
    catalogRepo.artistExternalIds.set('ext-phoebe', {
      id: 'ext-phoebe',
      artistId: 'artist-phoebe-canonical',
      provider: 'spotify',
      externalId: 'spotify-phoebe-123',
      createdAt: '2026-10-01T00:00:00Z',
    });

    // Seed canonical event for Phoebe Bridgers
    seedEvent(catalogRepo, {
      id: 'event-phoebe-denver',
      title: 'Phoebe Bridgers Live',
      localStartDate: '2026-11-12',
      startsAt: '2026-11-12T20:00:00Z',
      venueName: 'Red Rocks',
      city: 'Morrison',
      minPrice: 70,
      artists: [
        {
          id: 'artist-phoebe-canonical',
          name: 'Phoebe Bridgers',
          billingPosition: 'headliner',
        },
      ],
    });

    const result = await getPersonalizedDiscoverData({
      userId: userA,
      profileRepo,
      prefRepo: unlinkedPrefRepo,
      catalogRepo,
      referenceDate,
      referenceInstant,
    });

    expect(result.recommendations.length).toBeGreaterThan(0);
    const rec = result.recommendations.find(
      (r) => r.eventId === 'event-phoebe-denver',
    );
    expect(rec).toBeDefined();
    expect(rec?.factors.artist.score).toBe(100);
    expect(rec?.explanation).toContain('Favorite artist (Phoebe Bridgers)');
  });

  it('rejects invalid recommendation preset override with explicit Error', async () => {
    const userA = 'user-invalid-preset';
    await profileRepo.upsertProfile(userA, {
      recommendationPreset: 'balanced',
    });

    await expect(
      getPersonalizedDiscoverData({
        userId: userA,
        profileRepo,
        prefRepo,
        catalogRepo,
        presetOverride: 'nonexistent_preset' as any,
        referenceDate,
        referenceInstant,
      }),
    ).rejects.toThrow(/Invalid recommendation preset/);
  });

  it('correctly handles event-local timezone boundary without dropping same-evening events', async () => {
    const userA = 'user-tz-test';
    await profileRepo.upsertProfile(userA, {
      recommendationPreset: 'balanced',
    });

    // Scenario: local time in Denver is 2026-10-25 19:30:00 MDT (-06:00).
    // In UTC, this instant is 2026-10-26 01:30:00Z (the next UTC calendar day!).
    const instantUtc = '2026-10-26T01:30:00Z';
    const naiveUtcDate = '2026-10-26';

    // Event tonight at 20:00 MDT (startsAt: 2026-10-26T02:00:00Z)
    seedEvent(catalogRepo, {
      id: 'event-tonight-denver',
      title: 'Tonight in Denver',
      localStartDate: '2026-10-25',
      startsAt: '2026-10-26T02:00:00Z',
      timezone: 'America/Denver',
      city: 'Denver',
      venueName: 'Bluebird Theater',
      minPrice: 30,
    });

    // Event yesterday at 20:00 MDT (startsAt: 2026-10-25T02:00:00Z) - genuinely past
    seedEvent(catalogRepo, {
      id: 'event-yesterday-denver',
      title: 'Yesterday in Denver',
      localStartDate: '2026-10-24',
      startsAt: '2026-10-25T02:00:00Z',
      timezone: 'America/Denver',
      city: 'Denver',
      venueName: 'Bluebird Theater',
      minPrice: 30,
    });

    const result = await getPersonalizedDiscoverData({
      userId: userA,
      profileRepo,
      prefRepo,
      catalogRepo,
      referenceDate: naiveUtcDate,
      referenceInstant: instantUtc,
    });

    // Event tonight must be retained
    const tonightRec = result.exploratory.find(
      (r) => r.eventId === 'event-tonight-denver',
    );
    expect(tonightRec).toBeDefined();

    // Event yesterday must be filtered out as past
    const yesterdayRec = [
      ...result.recommendations,
      ...result.exploratory,
    ].find((r) => r.eventId === 'event-yesterday-denver');
    expect(yesterdayRec).toBeUndefined();

    // Verify public discover data also filters out the genuinely past event
    const publicResult = await getPublicDiscoverData({
      catalogRepo,
      referenceDate: naiveUtcDate,
      referenceInstant: instantUtc,
    });
    expect(
      publicResult.events.find((e) => e.id === 'event-tonight-denver'),
    ).toBeDefined();
    expect(
      publicResult.events.find((e) => e.id === 'event-yesterday-denver'),
    ).toBeUndefined();
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
