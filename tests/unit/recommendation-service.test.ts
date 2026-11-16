import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPersonalizedDiscoverData,
  getPublicDiscoverData,
  retrieveCandidatesWithLookback,
} from '@/lib/recommendation/service';
import {
  MemoryCatalogRepository,
  MemoryProfileRepository,
  MemorySpotifyConnectionRepository,
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
      referenceDate,
      referenceInstant,
    });

    expect(result.isEmptyCatalog).toBe(false);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe('event-public-1');
    expect(result.events[0].title).toBe('Denver Jazz Festival');
  });

  describe('Candidate Lookback & Timezone Boundary Regressions', () => {
    it('Regression A: considers eligible future concert when preceded by >150 recently past general events', async () => {
      const user = 'user-regression-a';
      await profileRepo.upsertProfile(user, {
        recommendationPreset: 'balanced',
      });

      const testRefDate = '2026-10-26';
      const testRefInstant = '2026-10-26T12:00:00Z';

      // Seed 160 recently past events in the lookback window (2026-10-25)
      for (let i = 0; i < 160; i++) {
        seedEvent(catalogRepo, {
          id: `past-general-${i}`,
          title: `Past General Show ${i}`,
          localStartDate: '2026-10-25',
          startsAt: '2026-10-25T14:00:00Z',
          venueName: 'Past Club',
        });
      }

      // Seed 1 future general event at index 161 (2026-10-27)
      seedEvent(catalogRepo, {
        id: 'event-future-general-survivor',
        title: 'Khruangbin at Red Rocks',
        localStartDate: '2026-10-27',
        startsAt: '2026-10-27T20:00:00Z',
        venueName: 'Red Rocks Amphitheatre',
      });

      const result = await getPersonalizedDiscoverData({
        userId: user,
        profileRepo,
        prefRepo,
        catalogRepo,
        referenceDate: testRefDate,
        referenceInstant: testRefInstant,
      });

      // Bounded paging gathered past events in lookback window without squeezing out the future show
      expect(result.isEmptyCatalog).toBe(false);
      expect(result.totalCandidateCount).toBe(161);
      expect(result.ineligibleCount).toBe(160);
      expect(result.exploratory).toHaveLength(1);
      expect(result.exploratory[0].eventId).toBe(
        'event-future-general-survivor',
      );
      expect(result.exploratory[0].event.title).toBe('Khruangbin at Red Rocks');

      // Also verify getPublicDiscoverData pages past the 160 events to find the future show
      const publicResult = await getPublicDiscoverData({
        catalogRepo,
        limit: 10,
        referenceDate: testRefDate,
        referenceInstant: testRefInstant,
      });
      expect(publicResult.isEmptyCatalog).toBe(false);
      expect(publicResult.events).toHaveLength(1);
      expect(publicResult.events[0].id).toBe('event-future-general-survivor');
    });

    it('Regression B: considers future favorite-artist concert when preceded by >100 past preferred-artist events', async () => {
      const user = 'user-regression-b';
      const favArtistId = 'artist-phoebe-regr-b';

      catalogRepo.artists.set(favArtistId, {
        id: favArtistId,
        name: 'Phoebe Bridgers',
        normalizedName: 'phoebe bridgers',
        imageUrl: null,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      });

      await profileRepo.upsertProfile(user, {
        recommendationPreset: 'artist_first',
      });
      await prefRepo.savePreference({
        userId: user,
        artistId: favArtistId,
        artistName: 'Phoebe Bridgers',
        preferenceLevel: 'favorite',
      });

      const testRefDate = '2026-10-26';
      const testRefInstant = '2026-10-26T12:00:00Z';

      // Seed 110 past shows for Phoebe Bridgers in the lookback window (2026-10-25)
      for (let i = 0; i < 110; i++) {
        seedEvent(catalogRepo, {
          id: `past-phoebe-${i}`,
          title: `Phoebe Bridgers Past Show ${i}`,
          localStartDate: '2026-10-25',
          startsAt: '2026-10-25T14:00:00Z',
          artists: [
            {
              id: favArtistId,
              name: 'Phoebe Bridgers',
              billingPosition: 'headliner',
            },
          ],
        });
      }

      // Seed 1 upcoming future concert for Phoebe Bridgers
      seedEvent(catalogRepo, {
        id: 'event-phoebe-future-survivor',
        title: 'Phoebe Bridgers at Red Rocks',
        localStartDate: '2026-11-05',
        startsAt: '2026-11-05T20:00:00Z',
        artists: [
          {
            id: favArtistId,
            name: 'Phoebe Bridgers',
            billingPosition: 'headliner',
          },
        ],
      });

      const result = await getPersonalizedDiscoverData({
        userId: user,
        profileRepo,
        prefRepo,
        catalogRepo,
        referenceDate: testRefDate,
        referenceInstant: testRefInstant,
      });

      // Paged past 110 preferred past events; future favorite show is ranked #1
      // Score in artist_first preset (65% artist + 15% distance*0.5 + 10% price*0.5 + 10% timing*0.5) is 82.5
      expect(result.isEmptyCatalog).toBe(false);
      expect(result.totalCandidateCount).toBe(111);
      expect(result.ineligibleCount).toBe(110);
      expect(result.recommendations).toHaveLength(1);
      expect(result.recommendations[0].eventId).toBe(
        'event-phoebe-future-survivor',
      );
      expect(result.recommendations[0].score).toBe(82.5);
      expect(result.recommendations[0].factors.artist.score).toBe(100);
      expect(result.recommendations[0].explanation).toContain(
        'Favorite artist',
      );
    });

    it('Regression C: preserves eligibility for Denver concert occurring tonight while UTC has advanced to tomorrow', async () => {
      const user = 'user-regression-c';
      await profileRepo.upsertProfile(user, {
        recommendationPreset: 'balanced',
      });

      // 8:00 PM MDT on 2026-10-25 = 2026-10-26T02:00:00Z (UTC has advanced to tomorrow)
      const refInstant = '2026-10-26T02:00:00Z';

      // Tonight's Denver instant-precision show at 9:00 PM MDT (2026-10-26T03:00:00Z)
      seedEvent(catalogRepo, {
        id: 'event-tonight-denver-instant',
        title: 'Denver Tonight Instant Show',
        localStartDate: '2026-10-25',
        timezone: 'America/Denver',
        startsAt: '2026-10-26T03:00:00Z',
        startTimePrecision: 'instant',
      });

      // Tonight's Denver date-only show on 2026-10-25
      seedEvent(catalogRepo, {
        id: 'event-tonight-denver-dateonly',
        title: 'Denver Tonight Date Only Show',
        localStartDate: '2026-10-25',
        timezone: 'America/Denver',
        startsAt: null,
        startTimePrecision: 'date_only',
      });

      // Yesterday's Denver show on 2026-10-24 (genuinely past)
      seedEvent(catalogRepo, {
        id: 'event-yesterday-denver-past',
        title: 'Denver Yesterday Past Show',
        localStartDate: '2026-10-24',
        timezone: 'America/Denver',
        startsAt: '2026-10-25T02:00:00Z',
        startTimePrecision: 'instant',
      });

      const result = await getPersonalizedDiscoverData({
        userId: user,
        profileRepo,
        prefRepo,
        catalogRepo,
        referenceInstant: refInstant,
      });

      const returnedEventIds = [
        ...result.recommendations,
        ...result.exploratory,
      ].map((r) => r.eventId);
      expect(returnedEventIds).toContain('event-tonight-denver-instant');
      expect(returnedEventIds).toContain('event-tonight-denver-dateonly');
      expect(returnedEventIds).not.toContain('event-yesterday-denver-past');

      // Public discover also preserves same-evening western show
      const publicResult = await getPublicDiscoverData({
        catalogRepo,
        referenceInstant: refInstant,
      });
      const publicIds = publicResult.events.map((e) => e.id);
      expect(publicIds).toContain('event-tonight-denver-instant');
      expect(publicIds).toContain('event-tonight-denver-dateonly');
      expect(publicIds).not.toContain('event-yesterday-denver-past');
    });

    it('Regression D: distinguishes genuine empty catalog vs candidates existing but all ineligible', async () => {
      const user = 'user-regression-d';
      await profileRepo.upsertProfile(user, {
        recommendationPreset: 'balanced',
      });

      // Scenario D1: Truly empty catalog (0 events)
      const emptyResult = await getPersonalizedDiscoverData({
        userId: user,
        profileRepo,
        prefRepo,
        catalogRepo,
        referenceDate: '2026-10-26',
        referenceInstant: '2026-10-26T12:00:00Z',
      });

      expect(emptyResult.isEmptyCatalog).toBe(true);
      expect(emptyResult.totalCandidateCount).toBe(0);
      expect(emptyResult.ineligibleCount).toBe(0);
      expect(emptyResult.recommendations).toHaveLength(0);
      expect(emptyResult.exploratory).toHaveLength(0);

      // Scenario D2: Candidates exist in catalog lookback window, but all are ineligible/past
      seedEvent(catalogRepo, {
        id: 'event-past-only-1',
        title: 'Past Only Show 1',
        localStartDate: '2026-10-25',
        startsAt: '2026-10-25T14:00:00Z',
      });
      seedEvent(catalogRepo, {
        id: 'event-past-only-2',
        title: 'Past Only Show 2',
        localStartDate: '2026-10-25',
        startsAt: '2026-10-25T16:00:00Z',
      });

      const ineligibleResult = await getPersonalizedDiscoverData({
        userId: user,
        profileRepo,
        prefRepo,
        catalogRepo,
        referenceDate: '2026-10-26',
        referenceInstant: '2026-10-26T12:00:00Z',
      });

      // Truthful: catalog is NOT empty (2 candidates existed in lookback), but 0 displayable shows
      expect(ineligibleResult.isEmptyCatalog).toBe(false);
      expect(ineligibleResult.totalCandidateCount).toBe(2);
      expect(ineligibleResult.ineligibleCount).toBe(2);
      expect(ineligibleResult.recommendations).toHaveLength(0);
      expect(ineligibleResult.exploratory).toHaveLength(0);
    });

    it('Regression 1A: considers eligible future concert when preceded by >150 future-dated cancelled general events', async () => {
      const user = 'user-regression-1a';
      await profileRepo.upsertProfile(user, {
        recommendationPreset: 'balanced',
      });

      const testRefDate = '2026-10-26';
      const testRefInstant = '2026-10-26T12:00:00Z';

      // Seed 160 future-dated cancelled events (2026-11-10)
      for (let i = 0; i < 160; i++) {
        seedEvent(catalogRepo, {
          id: `cancelled-general-${i}`,
          title: `Cancelled Tour Stop ${i}`,
          localStartDate: '2026-11-10',
          startsAt: '2026-11-10T20:00:00Z',
          status: 'cancelled',
          venueName: 'Cancelled Hall',
        });
      }

      // Seed 1 valid future scheduled event at index 161 (2026-11-20)
      seedEvent(catalogRepo, {
        id: 'event-future-scheduled-survivor',
        title: 'Khruangbin at Red Rocks',
        localStartDate: '2026-11-20',
        startsAt: '2026-11-20T20:00:00Z',
        status: 'scheduled',
        venueName: 'Red Rocks Amphitheatre',
      });

      const result = await getPersonalizedDiscoverData({
        userId: user,
        profileRepo,
        prefRepo,
        catalogRepo,
        referenceDate: testRefDate,
        referenceInstant: testRefInstant,
      });

      // Cancelled events did NOT consume eligible candidate capacity; valid show was retrieved
      expect(result.isEmptyCatalog).toBe(false);
      expect(result.totalCandidateCount).toBe(1);
      expect(result.suppressed).toHaveLength(0);
      expect(result.ineligibleCount).toBe(0);
      expect(result.exploratory).toHaveLength(1);
      expect(result.exploratory[0].eventId).toBe(
        'event-future-scheduled-survivor',
      );
      expect(result.exploratory[0].event.title).toBe('Khruangbin at Red Rocks');

      // Public discover also retrieves the valid event without cancelled event flooding
      const publicResult = await getPublicDiscoverData({
        catalogRepo,
        limit: 10,
        referenceDate: testRefDate,
        referenceInstant: testRefInstant,
      });
      expect(publicResult.isEmptyCatalog).toBe(false);
      expect(publicResult.events).toHaveLength(1);
      expect(publicResult.events[0].id).toBe('event-future-scheduled-survivor');
      expect(publicResult.events.some((e) => e.status === 'cancelled')).toBe(
        false,
      );
    });

    it('Regression 1B: considers future favorite-artist concert when preceded by >100 future-dated postponed preferred-artist events', async () => {
      const user = 'user-regression-1b';
      const favArtistId = 'artist-phoebe-regr-1b';

      catalogRepo.artists.set(favArtistId, {
        id: favArtistId,
        name: 'Phoebe Bridgers',
        normalizedName: 'phoebe bridgers',
        imageUrl: null,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      });

      await profileRepo.upsertProfile(user, {
        recommendationPreset: 'artist_first',
      });
      await prefRepo.savePreference({
        userId: user,
        artistId: favArtistId,
        artistName: 'Phoebe Bridgers',
        preferenceLevel: 'favorite',
      });

      const testRefDate = '2026-10-26';
      const testRefInstant = '2026-10-26T12:00:00Z';

      // Seed 110 future postponed shows for Phoebe Bridgers
      for (let i = 0; i < 110; i++) {
        seedEvent(catalogRepo, {
          id: `postponed-phoebe-${i}`,
          title: `Phoebe Bridgers Postponed Show ${i}`,
          localStartDate: '2026-11-05',
          startsAt: '2026-11-05T20:00:00Z',
          status: 'postponed',
          artists: [
            {
              id: favArtistId,
              name: 'Phoebe Bridgers',
              billingPosition: 'headliner',
            },
          ],
        });
      }

      // Seed 1 valid future scheduled concert for Phoebe Bridgers
      seedEvent(catalogRepo, {
        id: 'event-phoebe-scheduled-survivor',
        title: 'Phoebe Bridgers at Red Rocks',
        localStartDate: '2026-11-20',
        startsAt: '2026-11-20T20:00:00Z',
        status: 'scheduled',
        artists: [
          {
            id: favArtistId,
            name: 'Phoebe Bridgers',
            billingPosition: 'headliner',
          },
        ],
      });

      const result = await getPersonalizedDiscoverData({
        userId: user,
        profileRepo,
        prefRepo,
        catalogRepo,
        referenceDate: testRefDate,
        referenceInstant: testRefInstant,
      });

      // Postponed events did not consume eligible capacity; valid scheduled show is ranked #1
      expect(result.isEmptyCatalog).toBe(false);
      expect(result.totalCandidateCount).toBe(1);
      expect(result.suppressed).toHaveLength(0);
      expect(result.recommendations).toHaveLength(1);
      expect(result.recommendations[0].eventId).toBe(
        'event-phoebe-scheduled-survivor',
      );
      expect(result.recommendations[0].score).toBe(82.5);
      expect(result.recommendations[0].factors.artist.score).toBe(100);
      expect(result.recommendations[0].explanation).toContain(
        'Favorite artist',
      );
    });

    it('Regression 1C: mixed past, cancelled, postponed, and scheduled events only consume eligible capacity for valid scheduled shows', async () => {
      const user = 'user-regression-1c';
      await profileRepo.upsertProfile(user, {
        recommendationPreset: 'balanced',
      });

      const testRefDate = '2026-10-26';
      const testRefInstant = '2026-10-26T12:00:00Z';

      // 50 past events
      for (let i = 0; i < 50; i++) {
        seedEvent(catalogRepo, {
          id: `past-mix-${i}`,
          title: `Past Show ${i}`,
          localStartDate: '2026-10-25',
          startsAt: '2026-10-25T14:00:00Z',
          status: 'scheduled',
        });
      }

      // 60 future cancelled events
      for (let i = 0; i < 60; i++) {
        seedEvent(catalogRepo, {
          id: `cancelled-mix-${i}`,
          title: `Cancelled Show ${i}`,
          localStartDate: '2026-11-10',
          startsAt: '2026-11-10T20:00:00Z',
          status: 'cancelled',
        });
      }

      // 60 future postponed events
      for (let i = 0; i < 60; i++) {
        seedEvent(catalogRepo, {
          id: `postponed-mix-${i}`,
          title: `Postponed Show ${i}`,
          localStartDate: '2026-11-12',
          startsAt: '2026-11-12T20:00:00Z',
          status: 'postponed',
        });
      }

      // 5 valid scheduled upcoming events
      for (let i = 0; i < 5; i++) {
        seedEvent(catalogRepo, {
          id: `scheduled-mix-${i}`,
          title: `Scheduled Show ${i}`,
          localStartDate: '2026-11-20',
          startsAt: '2026-11-20T20:00:00Z',
          status: 'scheduled',
        });
      }

      const result = await getPersonalizedDiscoverData({
        userId: user,
        profileRepo,
        prefRepo,
        catalogRepo,
        referenceDate: testRefDate,
        referenceInstant: testRefInstant,
      });

      // Total candidates = 50 past + 5 scheduled = 55 (cancelled/postponed filtered at DB level)
      expect(result.isEmptyCatalog).toBe(false);
      expect(result.totalCandidateCount).toBe(55);
      expect(result.ineligibleCount).toBe(50);
      expect(result.suppressed).toHaveLength(0); // 60 cancelled + 60 postponed excluded at database level
      const totalDisplayable =
        result.recommendations.length + result.exploratory.length;
      expect(totalDisplayable).toBe(5);
    });

    it('Regression 1D: suppressed and ineligible event counts remain truthful when all retrieved events are cancelled or postponed', async () => {
      const user = 'user-regression-1d';
      await profileRepo.upsertProfile(user, {
        recommendationPreset: 'balanced',
      });

      const testRefDate = '2026-10-26';
      const testRefInstant = '2026-10-26T12:00:00Z';

      // 10 future cancelled events
      for (let i = 0; i < 10; i++) {
        seedEvent(catalogRepo, {
          id: `cancelled-only-${i}`,
          title: `Cancelled Only ${i}`,
          localStartDate: '2026-11-10',
          startsAt: '2026-11-10T20:00:00Z',
          status: 'cancelled',
        });
      }

      // 5 future postponed events
      for (let i = 0; i < 5; i++) {
        seedEvent(catalogRepo, {
          id: `postponed-only-${i}`,
          title: `Postponed Only ${i}`,
          localStartDate: '2026-11-12',
          startsAt: '2026-11-12T20:00:00Z',
          status: 'postponed',
        });
      }

      const result = await getPersonalizedDiscoverData({
        userId: user,
        profileRepo,
        prefRepo,
        catalogRepo,
        referenceDate: testRefDate,
        referenceInstant: testRefInstant,
      });

      // Truthful diagnostics: Catalog contains 0 scheduled candidates, so isEmptyCatalog is true
      expect(result.isEmptyCatalog).toBe(true);
      expect(result.totalCandidateCount).toBe(0);
      expect(result.suppressed).toHaveLength(0);
      expect(result.ineligibleCount).toBe(0);
      expect(result.recommendations).toHaveLength(0);
      expect(result.exploratory).toHaveLength(0);

      // Public discover also truthfully reports no upcoming scheduled events
      const publicResult = await getPublicDiscoverData({
        catalogRepo,
        referenceDate: testRefDate,
        referenceInstant: testRefInstant,
      });
      expect(publicResult.isEmptyCatalog).toBe(true);
      expect(publicResult.events).toHaveLength(0);
      expect(publicResult.totalCount).toBe(0);
    });
  });

  describe('Public Discover Event Filtering and Result Limits', () => {
    let catalogRepo: MemoryCatalogRepository;

    beforeEach(() => {
      catalogRepo = new MemoryCatalogRepository();
    });

    it('returns no upcoming scheduled concerts when catalog contains only cancelled or postponed events', async () => {
      const refDate = '2026-10-26';
      const refInstant = '2026-10-26T12:00:00Z';

      for (let i = 0; i < 5; i++) {
        seedEvent(catalogRepo, {
          id: `only-canc-${i}`,
          title: `Cancelled Show ${i}`,
          localStartDate: '2026-11-05',
          startsAt: '2026-11-05T20:00:00Z',
          timezone: 'America/Denver',
          status: 'cancelled',
        });
      }

      for (let i = 0; i < 5; i++) {
        seedEvent(catalogRepo, {
          id: `only-post-${i}`,
          title: `Postponed Show ${i}`,
          localStartDate: '2026-11-06',
          startsAt: '2026-11-06T20:00:00Z',
          timezone: 'America/Denver',
          status: 'postponed',
        });
      }

      const result = await getPublicDiscoverData({
        catalogRepo,
        referenceDate: refDate,
        referenceInstant: refInstant,
      });

      // Truthful: catalog contains 0 scheduled events, so isEmptyCatalog is true
      expect(result.isEmptyCatalog).toBe(true);
      expect(result.events).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it('returns at most 50 events when more than 50 valid scheduled events exist', async () => {
      const refDate = '2026-10-26';
      const refInstant = '2026-10-26T12:00:00Z';

      // Seed 60 valid scheduled events
      for (let i = 0; i < 60; i++) {
        seedEvent(catalogRepo, {
          id: `scheduled-bulk-${i}`,
          title: `Scheduled Concert ${i}`,
          localStartDate: '2026-11-20',
          startsAt: '2026-11-20T20:00:00Z',
          timezone: 'America/Denver',
          status: 'scheduled',
        });
      }

      // Default call without explicit limit should cap at default limit (50)
      const result = await getPublicDiscoverData({
        catalogRepo,
        referenceDate: refDate,
        referenceInstant: refInstant,
      });

      expect(result.isEmptyCatalog).toBe(false);
      expect(result.events).toHaveLength(50);
      expect(result.totalCount).toBe(50);
      expect(result.events.every((e) => e.status === 'scheduled')).toBe(true);
    });

    it('returns only eligible scheduled events when catalog has mixed past, cancelled, postponed, and scheduled events', async () => {
      const refDate = '2026-10-26';
      const refInstant = '2026-10-26T12:00:00Z';

      // 10 past events
      for (let i = 0; i < 10; i++) {
        seedEvent(catalogRepo, {
          id: `past-mix-${i}`,
          title: `Past Show ${i}`,
          localStartDate: '2026-10-15',
          startsAt: '2026-10-15T20:00:00Z',
          timezone: 'America/Denver',
          status: 'scheduled',
        });
      }

      // 160 cancelled future events (flooding retrieval budget)
      for (let i = 0; i < 160; i++) {
        seedEvent(catalogRepo, {
          id: `canc-mix-${i}`,
          title: `Cancelled Show ${i}`,
          localStartDate: '2026-11-10',
          startsAt: '2026-11-10T20:00:00Z',
          timezone: 'America/Denver',
          status: 'cancelled',
        });
      }

      // 10 postponed future events
      for (let i = 0; i < 10; i++) {
        seedEvent(catalogRepo, {
          id: `post-mix-${i}`,
          title: `Postponed Show ${i}`,
          localStartDate: '2026-11-12',
          startsAt: '2026-11-12T20:00:00Z',
          timezone: 'America/Denver',
          status: 'postponed',
        });
      }

      // 5 valid scheduled future events
      for (let i = 0; i < 5; i++) {
        seedEvent(catalogRepo, {
          id: `sched-mix-${i}`,
          title: `Valid Show ${i}`,
          localStartDate: '2026-11-15',
          startsAt: '2026-11-15T20:00:00Z',
          timezone: 'America/Denver',
          status: 'scheduled',
        });
      }

      const result = await getPublicDiscoverData({
        catalogRepo,
        referenceDate: refDate,
        referenceInstant: refInstant,
      });

      expect(result.isEmptyCatalog).toBe(false);
      expect(result.events).toHaveLength(5);
      expect(result.totalCount).toBe(5);
      expect(result.events.every((e) => e.status === 'scheduled')).toBe(true);
      expect(result.events.some((e) => e.status === 'cancelled')).toBe(false);
      expect(result.events.some((e) => e.status === 'postponed')).toBe(false);
      expect(result.events.map((e) => e.id)).toEqual([
        'sched-mix-0',
        'sched-mix-1',
        'sched-mix-2',
        'sched-mix-3',
        'sched-mix-4',
      ]);
    });

    it('applies search filtering and preserves accurate metadata when search finds no matches', async () => {
      const refDate = '2026-10-26';
      const refInstant = '2026-10-26T12:00:00Z';

      seedEvent(catalogRepo, {
        id: 'show-khruangbin',
        title: 'Khruangbin Live',
        venueName: 'Red Rocks Amphitheatre',
        localStartDate: '2026-11-10',
        startsAt: '2026-11-10T20:00:00Z',
        timezone: 'America/Denver',
        status: 'scheduled',
        artists: [
          {
            id: 'art-khruangbin',
            name: 'Khruangbin',
            billingPosition: 'headliner',
          },
        ],
      });

      seedEvent(catalogRepo, {
        id: 'show-phoebe',
        title: 'Phoebe Bridgers Solo',
        venueName: 'Mission Ballroom',
        localStartDate: '2026-11-12',
        startsAt: '2026-11-12T20:00:00Z',
        timezone: 'America/Denver',
        status: 'scheduled',
        artists: [
          {
            id: 'art-phoebe',
            name: 'Phoebe Bridgers',
            billingPosition: 'headliner',
          },
        ],
      });

      // Search matching title
      const searchTitleResult = await getPublicDiscoverData({
        catalogRepo,
        searchQuery: 'khruangbin',
        referenceDate: refDate,
        referenceInstant: refInstant,
      });
      expect(searchTitleResult.events).toHaveLength(1);
      expect(searchTitleResult.events[0].id).toBe('show-khruangbin');

      // Search matching venue
      const searchVenueResult = await getPublicDiscoverData({
        catalogRepo,
        searchQuery: 'Mission Ballroom',
        referenceDate: refDate,
        referenceInstant: refInstant,
      });
      expect(searchVenueResult.events).toHaveLength(1);
      expect(searchVenueResult.events[0].id).toBe('show-phoebe');

      // Search matching nothing
      const noMatchResult = await getPublicDiscoverData({
        catalogRepo,
        searchQuery: 'Nonexistent Band XYZ',
        referenceDate: refDate,
        referenceInstant: refInstant,
      });
      // Catalog itself is NOT empty (2 events exist)
      expect(noMatchResult.isEmptyCatalog).toBe(false);
      expect(noMatchResult.events).toHaveLength(0);
      expect(noMatchResult.totalCount).toBe(0);
    });
  });

  describe('PR #12 Architectural Remediation Requirements', () => {
    let catalogRepo: MemoryCatalogRepository;
    let profileRepo: MemoryProfileRepository;
    let prefRepo: MemoryUserPreferenceRepository;
    let spotifyRepo: MemorySpotifyConnectionRepository;

    beforeEach(() => {
      catalogRepo = new MemoryCatalogRepository();
      profileRepo = new MemoryProfileRepository();
      prefRepo = new MemoryUserPreferenceRepository();
      spotifyRepo = new MemorySpotifyConnectionRepository();
    });

    it('guarantees favorite artist shows are not starved by 100 earlier interested artist shows (Issue 3)', async () => {
      const userId = 'user-starvation-test';
      await profileRepo.upsertProfile(userId, {
        recommendationPreset: 'artist_first',
        defaultRadiusMiles: 100,
      });

      // User has 1 Favorite artist and 1 Interested artist
      await prefRepo.savePreference({
        userId,
        artistId: 'artist-fav',
        artistName: 'Favorite Star',
        preferenceLevel: 'favorite',
      });
      await prefRepo.savePreference({
        userId,
        artistId: 'artist-interested',
        artistName: 'Interested Opener',
        preferenceLevel: 'interested',
      });

      // Seed 105 shows for the Interested artist occurring sooner (2026-11-01)
      for (let i = 0; i < 105; i++) {
        seedEvent(catalogRepo, {
          id: `show-interested-${i}`,
          title: `Interested Opener Show ${i}`,
          localStartDate: '2026-11-01',
          startsAt: '2026-11-01T20:00:00Z',
          timezone: 'America/Denver',
          status: 'scheduled',
          artists: [
            {
              id: 'artist-interested',
              name: 'Interested Opener',
              billingPosition: 'headliner',
            },
          ],
        });
      }

      // Seed 1 show for the Favorite artist occurring later (2026-12-01)
      seedEvent(catalogRepo, {
        id: 'show-favorite-star',
        title: 'Favorite Star Arena Show',
        localStartDate: '2026-12-01',
        startsAt: '2026-12-01T20:00:00Z',
        timezone: 'America/Denver',
        status: 'scheduled',
        artists: [
          {
            id: 'artist-fav',
            name: 'Favorite Star',
            billingPosition: 'headliner',
          },
        ],
      });

      const res = await getPersonalizedDiscoverData({
        userId,
        catalogRepo,
        profileRepo,
        prefRepo,
        spotifyRepo,
        referenceDate: '2026-10-25',
      });

      // The Favorite artist show MUST be retrieved and scored as the #1 recommendation
      const favRec = res.recommendations.find(
        (r) => r.eventId === 'show-favorite-star',
      );
      expect(favRec).toBeDefined();
      expect(favRec?.matchedArtist?.isFavorite).toBe(true);
      expect(res.recommendations[0].eventId).toBe('show-favorite-star');
    });

    it('supports discovery modes: this_weekend, cheap_and_nearby, worth_planning_for (Issue 1)', async () => {
      const userId = 'user-modes-test';
      await profileRepo.upsertProfile(userId, {
        homeLatApprox: 39.7392,
        homeLngApprox: -104.9903,
        defaultRadiusMiles: 25,
        maxNormalTicketPrice: 50,
      });

      await prefRepo.savePreference({
        userId,
        artistId: 'artist-fav',
        artistName: 'Favorite Band',
        preferenceLevel: 'favorite',
      });

      // Event 1: Friday night show (this weekend, cheap & nearby)
      // Reference instant is Friday 2026-11-06T12:00:00Z
      // In America/Denver (MST UTC-7), 8 PM Friday local is 2026-11-07T03:00:00Z (after 17:00 Friday cutoff)
      seedEvent(catalogRepo, {
        id: 'show-weekend-cheap',
        title: 'Local Indie Night',
        localStartDate: '2026-11-06',
        startsAt: '2026-11-07T03:00:00Z',
        timezone: 'America/Denver',
        status: 'scheduled',
        lat: 39.74,
        lng: -104.99,
        minPrice: 20,
      });

      // Event 2: Expensive show far away next month (worth planning for favorite artist)
      seedEvent(catalogRepo, {
        id: 'show-future-expensive',
        title: 'Favorite Band Festival',
        localStartDate: '2026-12-15',
        startsAt: '2026-12-15T20:00:00Z',
        timezone: 'America/Denver',
        status: 'scheduled',
        lat: 40.5,
        lng: -105.0,
        minPrice: 150,
        artists: [
          {
            id: 'artist-fav',
            name: 'Favorite Band',
            billingPosition: 'headliner',
          },
        ],
      });

      // Test "this_weekend" mode
      const weekendRes = await getPersonalizedDiscoverData({
        userId,
        catalogRepo,
        profileRepo,
        prefRepo,
        spotifyRepo,
        mode: 'this_weekend',
        referenceDate: '2026-11-06',
        referenceInstant: '2026-11-06T12:00:00Z',
      });
      expect(weekendRes.activeMode).toBe('this_weekend');
      const weekendIds = [
        ...weekendRes.recommendations.map((r) => r.eventId),
        ...weekendRes.exploratory.map((r) => r.eventId),
      ];
      expect(weekendIds).toContain('show-weekend-cheap');
      expect(weekendIds).not.toContain('show-future-expensive');

      // Test "cheap_and_nearby" mode
      const cheapRes = await getPersonalizedDiscoverData({
        userId,
        catalogRepo,
        profileRepo,
        prefRepo,
        spotifyRepo,
        mode: 'cheap_and_nearby',
        referenceDate: '2026-11-01',
      });
      expect(cheapRes.activeMode).toBe('cheap_and_nearby');
      const cheapIds = [
        ...cheapRes.recommendations.map((r) => r.eventId),
        ...cheapRes.exploratory.map((r) => r.eventId),
      ];
      expect(cheapIds).toContain('show-weekend-cheap');
      expect(cheapIds).not.toContain('show-future-expensive');

      // Test "worth_planning_for" mode
      const planningRes = await getPersonalizedDiscoverData({
        userId,
        catalogRepo,
        profileRepo,
        prefRepo,
        spotifyRepo,
        mode: 'worth_planning_for',
        referenceDate: '2026-11-01',
      });
      expect(planningRes.activeMode).toBe('worth_planning_for');
      const planningIds = [
        ...planningRes.recommendations.map((r) => r.eventId),
        ...planningRes.exploratory.map((r) => r.eventId),
      ];
      expect(planningIds).toContain('show-future-expensive');
      expect(planningIds).not.toContain('show-weekend-cheap');
    });

    it('separates Spotify connection status from manual taste preferences (Issue 7)', async () => {
      const userId = 'user-spotify-sep-test';
      await profileRepo.upsertProfile(userId, {});

      // Case A: User has active Spotify connection, but 0 manual preferences
      await spotifyRepo.saveConnection({
        userId,
        spotifyAccountId: 'spot-123',
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenExpiresAt: new Date('2026-12-01T00:00:00Z'),
        reauthorizationDeadline: new Date('2027-01-01T00:00:00Z'),
        scopes: ['user-top-read'],
      });

      const resA = await getPersonalizedDiscoverData({
        userId,
        catalogRepo,
        profileRepo,
        prefRepo,
        spotifyRepo,
      });
      expect(resA.hasPreferences).toBe(false);
      expect(resA.isSpotifyConnected).toBe(true);

      // Case B: User has manual preferences, but no Spotify connection
      const userIdB = 'user-spotify-sep-test-b';
      await profileRepo.upsertProfile(userIdB, {});
      await prefRepo.savePreference({
        userId: userIdB,
        artistId: 'artist-1',
        artistName: 'Artist One',
        preferenceLevel: 'like',
      });

      const resB = await getPersonalizedDiscoverData({
        userId: userIdB,
        catalogRepo,
        profileRepo,
        prefRepo,
        spotifyRepo,
      });
      expect(resB.hasPreferences).toBe(true);
      expect(resB.isSpotifyConnected).toBe(false);
    });

    it('incorporates Spotify top artists into recommendation scoring when connected without requiring manual preferences', async () => {
      const userId = 'user-spotify-affinity-test';
      await profileRepo.upsertProfile(userId, {});

      seedEvent(catalogRepo, {
        id: 'show-spotify-affinity-1',
        title: 'Electric Rotation Band Live',
        localStartDate: '2026-11-20',
        startsAt: '2026-11-21T02:00:00Z',
        timezone: 'America/Denver',
        venueName: 'Cervantes Masterpiece Ballroom',
        city: 'Denver',
        region: 'CO',
        minPrice: 30,
        currency: 'USD',
        artists: [
          {
            id: 'artist-spot-test',
            name: 'Electric Rotation Band',
            billingPosition: 'headliner',
          },
        ],
      });

      catalogRepo.artistExternalIds.set('ext-spot-test', {
        id: 'ext-spot-test',
        artistId: 'artist-spot-test',
        provider: 'spotify',
        externalId: 'spot-band-id-999',
        createdAt: '2026-10-01T00:00:00Z',
      });

      // User has 0 manual preferences, but Spotify provides top artist
      const res = await getPersonalizedDiscoverData({
        userId,
        catalogRepo,
        profileRepo,
        prefRepo,
        spotifyRepo,
        spotifyTopArtists: [
          {
            id: 'spot-band-id-999',
            name: 'Electric Rotation Band',
            rank: 1,
            genres: ['electronic'],
            imageUrl: null,
            spotifyUrl: 'https://open.spotify.com/artist/spot-band-id-999',
            popularity: 80,
            trend: 'rising',
            timeRange: 'medium_term',
          },
        ],
        referenceDate: '2026-11-10',
      });

      expect(res.hasSpotifyAffinities).toBe(true);
      expect(res.recommendations.length).toBeGreaterThanOrEqual(1);

      const matchedRec = res.recommendations.find(
        (r) => r.eventId === 'show-spotify-affinity-1',
      );
      expect(matchedRec).toBeDefined();
      expect(matchedRec!.factors.artist.score).toBe(70); // Top 5 Spotify affinity
      expect(matchedRec!.explanation).toContain('Spotify top artist (#1');
    });

    it('pushes status scheduled down into database queries eliminating scan limit false negatives in production entry points (FIX 2)', async () => {
      const userId = 'user-scheduled-scan-test';
      await profileRepo.upsertProfile(userId, {});

      // Seed 600 cancelled events followed by 5 scheduled events
      for (let i = 0; i < 600; i++) {
        seedEvent(catalogRepo, {
          id: `cancelled-evt-${i}`,
          title: `Cancelled Event ${i}`,
          localStartDate: '2026-11-01',
          startsAt: '2026-11-01T20:00:00Z',
          timezone: 'America/Denver',
          status: 'cancelled',
        });
      }

      for (let i = 0; i < 5; i++) {
        seedEvent(catalogRepo, {
          id: `valid-scheduled-show-${i}`,
          title: `Valid Scheduled Show ${i}`,
          localStartDate: '2026-11-15',
          startsAt: '2026-11-15T20:00:00Z',
          timezone: 'America/Denver',
          status: 'scheduled',
        });
      }

      // Test A: Public discovery production entry point
      const publicRes = await getPublicDiscoverData({
        catalogRepo,
        limit: 10,
        referenceDate: '2026-10-25',
      });
      expect(publicRes.events.length).toBeGreaterThanOrEqual(1);
      expect(
        publicRes.events.some((e) => e.id === 'valid-scheduled-show-0'),
      ).toBe(true);

      // Test B: Authenticated discovery production entry point
      const personalizedRes = await getPersonalizedDiscoverData({
        userId,
        catalogRepo,
        profileRepo,
        prefRepo,
        spotifyRepo,
        referenceDate: '2026-10-25',
      });
      const allPersonalizedIds = [
        ...personalizedRes.recommendations.map((r) => r.eventId),
        ...personalizedRes.exploratory.map((r) => r.eventId),
      ];
      expect(allPersonalizedIds).toContain('valid-scheduled-show-0');
    });

    it('queries full eligible catalog for search and city filters without scan limit false negatives (FIX 1)', async () => {
      const userId = 'user-full-catalog-search-test';
      await profileRepo.upsertProfile(userId, {});

      // Seed 250 eligible scheduled concerts
      for (let i = 0; i < 220; i++) {
        seedEvent(catalogRepo, {
          id: `general-show-${i}`,
          title: `General Show ${i}`,
          city: i % 2 === 0 ? 'Denver' : 'Boulder',
          localStartDate: '2026-11-01',
          startsAt: '2026-11-01T20:00:00Z',
          timezone: 'America/Denver',
          status: 'scheduled',
          artists: [
            {
              id: `art-${i}`,
              name: `Artist ${i}`,
              billingPosition: 'headliner',
            },
          ],
        });
      }

      // Event at position 225: Target artist in Fort Collins beyond the initial candidate retrieval limit
      seedEvent(catalogRepo, {
        id: 'special-target-event',
        title: 'Midnight Echoes Special Tour',
        city: 'Fort Collins',
        localStartDate: '2026-12-05',
        startsAt: '2026-12-05T20:00:00Z',
        timezone: 'America/Denver',
        status: 'scheduled',
        artists: [
          {
            id: 'artist-target',
            name: 'Target Band',
            billingPosition: 'headliner',
          },
        ],
      });

      // 1. Guest search by artist
      const guestArtistSearch = await getPublicDiscoverData({
        catalogRepo,
        searchQuery: 'Target Band',
        referenceDate: '2026-10-25',
      });
      expect(
        guestArtistSearch.events.some((e) => e.id === 'special-target-event'),
      ).toBe(true);

      // 2. Guest search by event title
      const guestTitleSearch = await getPublicDiscoverData({
        catalogRepo,
        searchQuery: 'Midnight Echoes',
        referenceDate: '2026-10-25',
      });
      expect(
        guestTitleSearch.events.some((e) => e.id === 'special-target-event'),
      ).toBe(true);

      // 3. Guest filter by city
      const guestCityFilter = await getPublicDiscoverData({
        catalogRepo,
        city: 'Fort Collins',
        referenceDate: '2026-10-25',
      });
      expect(
        guestCityFilter.events.some((e) => e.id === 'special-target-event'),
      ).toBe(true);

      // 4. Guest combined search and city filter
      const guestCombined = await getPublicDiscoverData({
        catalogRepo,
        searchQuery: 'Target Band',
        city: 'Fort Collins',
        referenceDate: '2026-10-25',
      });
      expect(
        guestCombined.events.some((e) => e.id === 'special-target-event'),
      ).toBe(true);

      // 5. Authenticated personalized discovery with search beyond initial window
      const authSearch = await getPersonalizedDiscoverData({
        userId,
        catalogRepo,
        profileRepo,
        prefRepo,
        spotifyRepo,
        searchQuery: 'Target Band',
        referenceDate: '2026-10-25',
      });
      const authIds = [
        ...authSearch.recommendations.map((r) => r.eventId),
        ...authSearch.exploratory.map((r) => r.eventId),
      ];
      expect(authIds).toContain('special-target-event');

      // 6. Authenticated personalized discovery with combined search & city
      const authCombined = await getPersonalizedDiscoverData({
        userId,
        catalogRepo,
        profileRepo,
        prefRepo,
        spotifyRepo,
        searchQuery: 'Target Band',
        city: 'Fort Collins',
        referenceDate: '2026-10-25',
      });
      const authCombinedIds = [
        ...authCombined.recommendations.map((r) => r.eventId),
        ...authCombined.exploratory.map((r) => r.eventId),
      ];
      expect(authCombinedIds).toContain('special-target-event');
    });

    it('enforces fair candidate quota allocation among multiple favorite artists (Issue 9)', async () => {
      const userId = 'user-multi-favorites-test';
      await profileRepo.upsertProfile(userId, {
        recommendationPreset: 'artist_first',
      });

      // User has 3 Favorite artists: A, B, and C
      await prefRepo.savePreference({
        userId,
        artistId: 'fav-artist-a',
        artistName: 'Favorite A',
        preferenceLevel: 'favorite',
      });
      await prefRepo.savePreference({
        userId,
        artistId: 'fav-artist-b',
        artistName: 'Favorite B',
        preferenceLevel: 'favorite',
      });
      await prefRepo.savePreference({
        userId,
        artistId: 'fav-artist-c',
        artistName: 'Favorite C',
        preferenceLevel: 'favorite',
      });

      // Favorite A has 100 shows early in November
      for (let i = 0; i < 100; i++) {
        seedEvent(catalogRepo, {
          id: `fav-a-show-${i}`,
          title: `Favorite A Tour Date ${i}`,
          localStartDate: '2026-11-01',
          startsAt: '2026-11-01T20:00:00Z',
          timezone: 'America/Denver',
          status: 'scheduled',
          artists: [
            {
              id: 'fav-artist-a',
              name: 'Favorite A',
              billingPosition: 'headliner',
            },
          ],
        });
      }

      // Favorite B has 2 shows scheduled later in December
      seedEvent(catalogRepo, {
        id: 'fav-b-show-dec',
        title: 'Favorite B Winter Show',
        localStartDate: '2026-12-15',
        startsAt: '2026-12-15T20:00:00Z',
        timezone: 'America/Denver',
        status: 'scheduled',
        artists: [
          {
            id: 'fav-artist-b',
            name: 'Favorite B',
            billingPosition: 'headliner',
          },
        ],
      });

      // Favorite C has 1 show scheduled in January
      seedEvent(catalogRepo, {
        id: 'fav-c-show-jan',
        title: 'Favorite C New Year Show',
        localStartDate: '2027-01-10',
        startsAt: '2027-01-10T20:00:00Z',
        timezone: 'America/Denver',
        status: 'scheduled',
        artists: [
          {
            id: 'fav-artist-c',
            name: 'Favorite C',
            billingPosition: 'headliner',
          },
        ],
      });

      const res = await getPersonalizedDiscoverData({
        userId,
        catalogRepo,
        profileRepo,
        prefRepo,
        spotifyRepo,
        referenceDate: '2026-10-25',
      });

      const allRecIds = [
        ...res.recommendations.map((r) => r.eventId),
        ...res.exploratory.map((r) => r.eventId),
      ];

      // With fair allocation, Favorite B and Favorite C's later shows MUST NOT be starved by Favorite A's 100 earlier shows
      expect(allRecIds).toContain('fav-b-show-dec');
      expect(allRecIds).toContain('fav-c-show-jan');
    });

    it('accurately distinguishes empty catalog from filter-empty results (Issue 10)', async () => {
      const userId = 'user-empty-accuracy-test';
      await profileRepo.upsertProfile(userId, {});

      // 1. Empty catalog: 0 events in repository
      const emptyRes = await getPublicDiscoverData({
        catalogRepo,
        referenceDate: '2026-10-25',
      });
      expect(emptyRes.isEmptyCatalog).toBe(true);
      expect(emptyRes.events).toHaveLength(0);

      // Seed 5 events
      for (let i = 0; i < 5; i++) {
        seedEvent(catalogRepo, {
          id: `evt-${i}`,
          title: `Concert ${i}`,
          city: 'Denver',
          localStartDate: '2026-11-01',
          startsAt: '2026-11-01T20:00:00Z',
          timezone: 'America/Denver',
          status: 'scheduled',
        });
      }

      // 2. Nonempty catalog with no-match search query: isEmptyCatalog MUST be false
      const filterEmptyRes = await getPublicDiscoverData({
        catalogRepo,
        searchQuery: 'NonExistentBand12345',
        referenceDate: '2026-10-25',
      });
      expect(filterEmptyRes.isEmptyCatalog).toBe(false);
      expect(filterEmptyRes.events).toHaveLength(0);

      // 3. Personalized discovery with no-match search query: isEmptyCatalog MUST be false
      const authFilterEmptyRes = await getPersonalizedDiscoverData({
        userId,
        catalogRepo,
        profileRepo,
        prefRepo,
        spotifyRepo,
        searchQuery: 'NonExistentBand12345',
        referenceDate: '2026-10-25',
      });
      expect(authFilterEmptyRes.isEmptyCatalog).toBe(false);
      expect(authFilterEmptyRes.recommendations).toHaveLength(0);
    });

    it('MUST FIX 1: retrieves qualifying $20 Cheap & Nearby concert placed after 100 expensive concerts', async () => {
      const user = 'user-cheap-nearby-lookback';
      await profileRepo.upsertProfile(user, {
        homeLatApprox: 39.7392,
        homeLngApprox: -104.9903,
        defaultRadiusMiles: 35,
        maxNormalTicketPrice: 35,
      });

      const refDate = '2026-10-25';
      const refInstant = '2026-10-25T12:00:00Z';

      // Seed 100 expensive concerts ($150 each) on 2026-11-01
      for (let i = 0; i < 100; i++) {
        seedEvent(catalogRepo, {
          id: `expensive-show-${i}`,
          title: `Expensive Opera Gala ${i}`,
          localStartDate: '2026-11-01',
          startsAt: '2026-11-01T20:00:00Z',
          timezone: 'America/Denver',
          status: 'scheduled',
          lat: 39.74,
          lng: -104.99,
          city: 'Denver',
          minPrice: 150,
        });
      }

      // Seed 1 qualifying $20 concert on 2026-11-02
      seedEvent(catalogRepo, {
        id: 'qualifying-cheap-concert',
        title: 'Local Indie Showcase ($20)',
        localStartDate: '2026-11-02',
        startsAt: '2026-11-02T20:00:00Z',
        timezone: 'America/Denver',
        status: 'scheduled',
        lat: 39.74,
        lng: -104.99,
        city: 'Denver',
        minPrice: 20,
      });

      // Authenticated production service
      const authRes = await getPersonalizedDiscoverData({
        userId: user,
        catalogRepo,
        profileRepo,
        prefRepo,
        spotifyRepo,
        mode: 'cheap_and_nearby',
        referenceDate: refDate,
        referenceInstant: refInstant,
      });

      const authIds = [
        ...authRes.recommendations.map((r) => r.eventId),
        ...authRes.exploratory.map((r) => r.eventId),
      ];
      expect(authIds).toContain('qualifying-cheap-concert');

      // Public discover service
      const publicRes = await getPublicDiscoverData({
        catalogRepo,
        mode: 'cheap_and_nearby',
        city: 'Denver',
        referenceDate: refDate,
        referenceInstant: refInstant,
      });
      expect(publicRes.events.map((e) => e.id)).toContain(
        'qualifying-cheap-concert',
      );
    });

    it('MUST FIX 2: enforces aggregate bounds, correct coverage, and query counts for 3, 20, and 100 favorite artists', async () => {
      // Test for 3, 20, and 100 favorite artists
      for (const count of [3, 20, 100]) {
        const testUser = `user-fav-bounds-${count}`;
        await profileRepo.upsertProfile(testUser, {
          recommendationPreset: 'artist_first',
        });

        const testCatalog = new MemoryCatalogRepository();
        const testPrefRepo = new MemoryUserPreferenceRepository();

        // 1. Seed 150 earlier neutral events to exhaust Tier 2 general catalog pool
        for (let i = 0; i < 150; i++) {
          const pad = String(i).padStart(3, '0');
          seedEvent(testCatalog, {
            id: `neutral-${count}-${pad}`,
            title: `Neutral Show ${pad}`,
            localStartDate: '2026-10-28',
            startsAt: '2026-10-28T20:00:00Z',
            timezone: 'America/Denver',
            status: 'scheduled',
            artists: [
              {
                id: `neutral-art-${count}-${pad}`,
                name: `Neutral Artist ${pad}`,
                billingPosition: 'headliner',
              },
            ],
          });
        }

        // 2. Seed favorite artists and shows occurring after the neutral shows
        const favArtistIds: string[] = [];
        for (let i = 0; i < count; i++) {
          const artistId = `fav-art-${count}-${i}`;
          favArtistIds.push(artistId);
          await testPrefRepo.savePreference({
            userId: testUser,
            artistId,
            artistName: `Favorite Artist ${i}`,
            preferenceLevel: 'favorite',
          });

          // Each artist has 2 upcoming shows scheduled in November
          seedEvent(testCatalog, {
            id: `show-${count}-${i}-a`,
            title: `Artist ${i} Show A`,
            localStartDate: '2026-11-05',
            startsAt: '2026-11-05T20:00:00Z',
            timezone: 'America/Denver',
            status: 'scheduled',
            artists: [
              {
                id: artistId,
                name: `Artist ${i}`,
                billingPosition: 'headliner',
              },
            ],
          });
          seedEvent(testCatalog, {
            id: `show-${count}-${i}-b`,
            title: `Artist ${i} Show B`,
            localStartDate: '2026-11-12',
            startsAt: '2026-11-12T20:00:00Z',
            timezone: 'America/Denver',
            status: 'scheduled',
            artists: [
              {
                id: artistId,
                name: `Artist ${i}`,
                billingPosition: 'headliner',
              },
            ],
          });
        }

        // Spy on catalog listEvents to measure query counts
        let listEventsCallCount = 0;
        const origListEvents = testCatalog.listEvents.bind(testCatalog);
        testCatalog.listEvents = async (filters) => {
          if (filters?.artistIds && filters.artistIds.length > 0) {
            listEventsCallCount++;
          }
          return origListEvents(filters);
        };

        const res = await getPersonalizedDiscoverData({
          userId: testUser,
          catalogRepo: testCatalog,
          profileRepo,
          prefRepo: testPrefRepo,
          spotifyRepo,
          referenceDate: '2026-10-25',
        });

        // 1. Query counts: Exactly 1 retrieval query for all favorite artists (bounded, NOT N separate queries)
        expect(listEventsCallCount).toBe(1);

        // 2. Aggregate bounds: Total favorite recommendations strictly bounded <= 100
        const totalRecs = res.recommendations.length;
        expect(totalRecs).toBeLessThanOrEqual(100);

        // 3. Correct coverage: Every favorite artist has candidate representation
        if (count <= 50) {
          // With 3 or 20 artists, every artist gets shows
          const representedArtists = new Set(
            res.recommendations.flatMap((r) =>
              r.event.artists.map((a) => a.id),
            ),
          );
          for (const artistId of favArtistIds) {
            expect(representedArtists.has(artistId)).toBe(true);
          }
        }
      }
    });

    it('SHOULD FIX 6: does not present an empty weekend as an entirely empty catalog', async () => {
      const user = 'user-weekend-empty-test';
      await profileRepo.upsertProfile(user, {});

      // Seed 10 scheduled events next month (none this weekend 2026-10-30 to 2026-11-01)
      for (let i = 0; i < 10; i++) {
        seedEvent(catalogRepo, {
          id: `next-month-show-${i}`,
          title: `December Concert ${i}`,
          localStartDate: '2026-12-05',
          startsAt: '2026-12-05T20:00:00Z',
          timezone: 'America/Denver',
          status: 'scheduled',
        });
      }

      // Personalized discover with mode: this_weekend
      const authWeekendRes = await getPersonalizedDiscoverData({
        userId: user,
        catalogRepo,
        profileRepo,
        prefRepo,
        spotifyRepo,
        mode: 'this_weekend',
        referenceDate: '2026-10-30',
        referenceInstant: '2026-10-30T12:00:00Z',
      });

      // isEmptyCatalog MUST be false because the catalog has 10 upcoming events
      expect(authWeekendRes.isEmptyCatalog).toBe(false);
      expect(authWeekendRes.recommendations).toHaveLength(0);
      expect(authWeekendRes.activeMode).toBe('this_weekend');

      // Public discover with mode: this_weekend
      const publicWeekendRes = await getPublicDiscoverData({
        catalogRepo,
        mode: 'this_weekend',
        referenceDate: '2026-10-30',
        referenceInstant: '2026-10-30T12:00:00Z',
      });

      // isEmptyCatalog MUST be false because the catalog has 10 upcoming events
      expect(publicWeekendRes.isEmptyCatalog).toBe(false);
      expect(publicWeekendRes.events).toHaveLength(0);
      expect(publicWeekendRes.activeMode).toBe('this_weekend');
    });

    it('accurately bounds Cheap & Nearby 14-day lookahead for Denver evening (Nov 7, 2026 7:30 PM), excluding Day 15 concerts', async () => {
      const user = 'user-denver-evening-lookahead';
      await profileRepo.upsertProfile(user, {
        homeLatApprox: 39.7392,
        homeLngApprox: -104.9903,
        defaultRadiusMiles: 35,
        maxNormalTicketPrice: 35,
      });

      // Denver local time: Saturday Nov 7, 2026 at 7:30 PM MST (UTC: 2026-11-08T02:30:00Z)
      // Day 14 date in Denver is Nov 21, 2026 (2026-11-21)
      // Day 15 date in Denver is Nov 22, 2026 (2026-11-22)
      const denverEveningInstant = '2026-11-08T02:30:00Z';

      // 1. Qualifying Day 14 concert (2026-11-21, $20, Denver)
      seedEvent(catalogRepo, {
        id: 'concert-day-14',
        title: 'Day 14 Concert ($20)',
        localStartDate: '2026-11-21',
        startsAt: '2026-11-22T03:00:00Z',
        timezone: 'America/Denver',
        status: 'scheduled',
        city: 'Denver',
        lat: 39.74,
        lng: -104.99,
        minPrice: 20,
      });

      // 2. Day 15 concert (2026-11-22, $20, Denver) -> MUST be excluded
      seedEvent(catalogRepo, {
        id: 'concert-day-15',
        title: 'Day 15 Concert ($20)',
        localStartDate: '2026-11-22',
        startsAt: '2026-11-23T03:00:00Z',
        timezone: 'America/Denver',
        status: 'scheduled',
        city: 'Denver',
        lat: 39.74,
        lng: -104.99,
        minPrice: 20,
      });

      // Test personalized discover production path
      const authRes = await getPersonalizedDiscoverData({
        userId: user,
        catalogRepo,
        profileRepo,
        prefRepo,
        spotifyRepo,
        mode: 'cheap_and_nearby',
        referenceInstant: denverEveningInstant,
      });

      const authIds = [
        ...authRes.recommendations.map((r) => r.eventId),
        ...authRes.exploratory.map((r) => r.eventId),
      ];
      expect(authIds).toContain('concert-day-14');
      expect(authIds).not.toContain('concert-day-15');

      // Test public discover production path
      const publicRes = await getPublicDiscoverData({
        catalogRepo,
        mode: 'cheap_and_nearby',
        city: 'Denver',
        referenceInstant: denverEveningInstant,
      });

      const publicIds = publicRes.events.map((e) => e.id);
      expect(publicIds).toContain('concert-day-14');
      expect(publicIds).not.toContain('concert-day-15');
    });
  });
});
