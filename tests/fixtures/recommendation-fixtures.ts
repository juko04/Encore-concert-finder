/**
 * Representative Deterministic Fixtures for Recommendation Scoring
 * Covers:
 * 1. Favorite artist close by vs Favorite artist farther away
 * 2. Liked artist cheap vs Liked artist expensive
 * 3. Unmarked artist cheap & nearby (exploratory candidate)
 * 4. Multi-artist lineups (headliner + support)
 * 5. Not-interested artist event (suppressed)
 * 6. Missing price event (neutral price 50)
 * 7. Missing coordinates event (neutral distance 50)
 * 8. Same artist name, distinct canonical IDs (disambiguation)
 * 9. Duplicate event IDs (deduplication testing)
 * 10. Past event (ineligible)
 */

import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { UserArtistPreference } from '@/lib/domain/user-preference';
import type { UserProfile } from '@/lib/domain/profile';

// Fixed user location: e.g. Central Denver area (approximate)
// Coordinates: 39.7392, -104.9903
export const FIXTURE_USER_PROFILE: UserProfile = {
  id: 'user-preview-123',
  homeLatApprox: 39.7392,
  homeLngApprox: -104.9903,
  defaultRadiusMiles: 25,
  maxSpontaneousPrice: 30,
  maxNormalTicketPrice: 60,
  maxFavoriteArtistPrice: 150,
  travelWillingness: 'moderate',
  recommendationPreset: 'balanced',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

// Canonical Artist IDs
export const ARTIST_ID_THE_CURE = 'artist-the-cure-001';
export const ARTIST_ID_AURORA = 'artist-aurora-002';
export const ARTIST_ID_CHAPPELL = 'artist-chappell-003';
export const ARTIST_ID_DISLIKED = 'artist-disliked-004';
export const ARTIST_ID_SAMENAME_A = 'artist-john-smith-rock-005';
export const ARTIST_ID_SAMENAME_B = 'artist-john-smith-jazz-006';
export const ARTIST_ID_UNMARKED = 'artist-local-indie-007';

export const FIXTURE_ARTIST_PREFERENCES: UserArtistPreference[] = [
  {
    id: 'pref-cure',
    userId: 'user-preview-123',
    artistId: ARTIST_ID_THE_CURE,
    artistName: 'The Cure',
    normalizedArtistName: 'the cure',
    preferenceLevel: 'favorite',
    createdAt: '2026-10-02T10:00:00Z',
    updatedAt: '2026-10-02T10:00:00Z',
  },
  {
    id: 'pref-aurora',
    userId: 'user-preview-123',
    artistId: ARTIST_ID_AURORA,
    artistName: 'Aurora',
    normalizedArtistName: 'aurora',
    preferenceLevel: 'like',
    createdAt: '2026-10-02T11:00:00Z',
    updatedAt: '2026-10-02T11:00:00Z',
  },
  {
    id: 'pref-chappell',
    userId: 'user-preview-123',
    artistId: ARTIST_ID_CHAPPELL,
    artistName: 'Chappell Roan',
    normalizedArtistName: 'chappell roan',
    preferenceLevel: 'interested',
    createdAt: '2026-10-02T12:00:00Z',
    updatedAt: '2026-10-02T12:00:00Z',
  },
  {
    id: 'pref-disliked',
    userId: 'user-preview-123',
    artistId: ARTIST_ID_DISLIKED,
    artistName: 'Overhyped DJ',
    normalizedArtistName: 'overhyped dj',
    preferenceLevel: 'dislike',
    createdAt: '2026-10-02T13:00:00Z',
    updatedAt: '2026-10-02T13:00:00Z',
  },
  {
    id: 'pref-samename-a',
    userId: 'user-preview-123',
    artistId: ARTIST_ID_SAMENAME_A,
    artistName: 'John Smith (Rock)',
    normalizedArtistName: 'john smith',
    preferenceLevel: 'favorite',
    createdAt: '2026-10-02T14:00:00Z',
    updatedAt: '2026-10-02T14:00:00Z',
  },
];

export const FIXTURE_REFERENCE_DATE = '2026-11-01';

export const FIXTURE_EVENTS: CanonicalEventSummary[] = [
  // 1. Favorite artist, close by (12 miles: Red Rocks), moderate price ($85)
  // Venue coords: 39.6654, -105.2057 (approx 12.5 mi from user)
  {
    id: 'ev-cure-red-rocks',
    title: 'The Cure — Live at Red Rocks',
    venueName: 'Red Rocks Amphitheatre',
    venueId: 'venue-red-rocks',
    city: 'Morrison',
    region: 'CO',
    lat: 39.6654,
    lng: -105.2057,
    localStartDate: '2026-11-15',
    startsAt: '2026-11-16T02:00:00Z',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    artists: [
      {
        id: ARTIST_ID_THE_CURE,
        name: 'The Cure',
        billingPosition: 'headliner',
      },
    ],
    minPrice: 85,
    maxPrice: 140,
    currency: 'USD',
  },

  // 2. Favorite artist, FAR away (65 miles: Colorado Springs / Ford Amphitheater)
  // Tests favorite artist distance elasticity!
  // Venue coords: 38.9950, -104.8100 (approx 52 mi from user)
  {
    id: 'ev-cure-far-away',
    title: 'The Cure — Southern Springs Arena',
    venueName: 'Ford Amphitheater',
    venueId: 'venue-ford-amphitheater',
    city: 'Colorado Springs',
    region: 'CO',
    lat: 38.995,
    lng: -104.81,
    localStartDate: '2026-11-20',
    startsAt: '2026-11-21T02:00:00Z',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    artists: [
      {
        id: ARTIST_ID_THE_CURE,
        name: 'The Cure',
        billingPosition: 'headliner',
      },
    ],
    minPrice: 75,
    maxPrice: 120,
    currency: 'USD',
  },

  // 3. Liked artist (Aurora), very close (4 miles: Bluebird Theater), cheap ($35)
  // Venue coords: 39.7402, -104.9450 (approx 2.5 mi from user)
  {
    id: 'ev-aurora-bluebird',
    title: 'Aurora — What Happened to the Heart Tour',
    venueName: 'Bluebird Theater',
    venueId: 'venue-bluebird',
    city: 'Denver',
    region: 'CO',
    lat: 39.7402,
    lng: -104.945,
    localStartDate: '2026-11-12',
    startsAt: '2026-11-13T03:00:00Z',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    artists: [
      { id: ARTIST_ID_AURORA, name: 'Aurora', billingPosition: 'headliner' },
    ],
    minPrice: 35,
    maxPrice: 45,
    currency: 'USD',
  },

  // 4. Interested artist (Chappell Roan), very close (3 miles: Mission Ballroom), expensive ($140 > normal budget $60)
  // Venue coords: 39.7745, -104.9785 (approx 2.6 mi from user)
  {
    id: 'ev-chappell-expensive',
    title: 'Chappell Roan — Midwest Princess Night',
    venueName: 'Mission Ballroom',
    venueId: 'venue-mission-ballroom',
    city: 'Denver',
    region: 'CO',
    lat: 39.7745,
    lng: -104.9785,
    localStartDate: '2026-11-14',
    startsAt: '2026-11-15T02:00:00Z',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    artists: [
      {
        id: ARTIST_ID_CHAPPELL,
        name: 'Chappell Roan',
        billingPosition: 'headliner',
      },
    ],
    minPrice: 140,
    maxPrice: 220,
    currency: 'USD',
  },

  // 5. Unmarked artist (Local Indie), ultra close (1.5 miles: Larimer Lounge), very cheap ($15), free entry demo
  // Venue coords: 39.7595, -104.9835 (approx 1.5 mi from user)
  // Exploratory candidate!
  {
    id: 'ev-local-indie-cheap',
    title: 'Local Indie Showcase — Neon Velvet',
    venueName: 'Larimer Lounge',
    venueId: 'venue-larimer-lounge',
    city: 'Denver',
    region: 'CO',
    lat: 39.7595,
    lng: -104.9835,
    localStartDate: '2026-11-08',
    startsAt: '2026-11-09T03:00:00Z',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    artists: [
      {
        id: ARTIST_ID_UNMARKED,
        name: 'Neon Velvet',
        billingPosition: 'headliner',
      },
    ],
    minPrice: 15,
    maxPrice: 20,
    currency: 'USD',
  },

  // 6. Multi-artist event: Headliner is Like (Aurora), support is Favorite (The Cure)
  // Should score as Favorite (100) without double-counting!
  {
    id: 'ev-multi-artist-show',
    title: 'Aurora with special guest The Cure',
    venueName: 'Fiddler Green Amphitheatre',
    venueId: 'venue-fiddlers-green',
    city: 'Greenwood Village',
    region: 'CO',
    lat: 39.6001,
    lng: -104.8912,
    localStartDate: '2026-11-22',
    startsAt: '2026-11-23T01:00:00Z',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    artists: [
      { id: ARTIST_ID_AURORA, name: 'Aurora', billingPosition: 'headliner' },
      { id: ARTIST_ID_THE_CURE, name: 'The Cure', billingPosition: 'support' },
    ],
    minPrice: 65,
    maxPrice: 120,
    currency: 'USD',
  },

  // 7. Suppressed event: Disliked artist is on the bill
  {
    id: 'ev-disliked-artist-suppressed',
    title: 'Electronic Night feat. Overhyped DJ',
    venueName: 'Cervantes Masterpiece Ballroom',
    venueId: 'venue-cervantes',
    city: 'Denver',
    region: 'CO',
    lat: 39.7545,
    lng: -104.978,
    localStartDate: '2026-11-18',
    startsAt: '2026-11-19T03:00:00Z',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    artists: [
      {
        id: ARTIST_ID_DISLIKED,
        name: 'Overhyped DJ',
        billingPosition: 'headliner',
      },
    ],
    minPrice: 25,
    maxPrice: 35,
    currency: 'USD',
  },

  // 8. Missing Price event: Price TBA (neutral price score 50)
  {
    id: 'ev-missing-price',
    title: 'The Cure — Secret Club Performance',
    venueName: 'Gothic Theatre',
    venueId: 'venue-gothic',
    city: 'Englewood',
    region: 'CO',
    lat: 39.6582,
    lng: -104.9877,
    localStartDate: '2026-11-25',
    startsAt: '2026-11-26T03:00:00Z',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    artists: [
      {
        id: ARTIST_ID_THE_CURE,
        name: 'The Cure',
        billingPosition: 'headliner',
      },
    ],
    minPrice: null,
    maxPrice: null,
    currency: null,
  },

  // 9. Missing Coordinates event: Location neutral (50)
  {
    id: 'ev-missing-coords',
    title: 'The Cure — Warehouse Pop-up Show',
    venueName: 'Secret Warehouse Venue',
    venueId: 'venue-secret-warehouse',
    city: 'Denver',
    region: 'CO',
    lat: null,
    lng: null,
    localStartDate: '2026-11-27',
    startsAt: '2026-11-28T03:00:00Z',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    artists: [
      {
        id: ARTIST_ID_THE_CURE,
        name: 'The Cure',
        billingPosition: 'headliner',
      },
    ],
    minPrice: 50,
    maxPrice: 50,
    currency: 'USD',
  },

  // 10. Same name disambiguation: 'John Smith'
  // Event A has ARTIST_ID_SAMENAME_A (Rock, marked Favorite)
  // Event B has ARTIST_ID_SAMENAME_B (Jazz, Unmarked)
  {
    id: 'ev-samename-rock-fav',
    title: 'John Smith Band — Rock Tour',
    venueName: 'Marquis Theater',
    venueId: 'venue-marquis',
    city: 'Denver',
    region: 'CO',
    lat: 39.7533,
    lng: -104.9922,
    localStartDate: '2026-11-10',
    startsAt: '2026-11-11T02:00:00Z',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    artists: [
      {
        id: ARTIST_ID_SAMENAME_A,
        name: 'John Smith',
        billingPosition: 'headliner',
      },
    ],
    minPrice: 25,
    maxPrice: 30,
    currency: 'USD',
  },
  {
    id: 'ev-samename-jazz-unmarked',
    title: 'John Smith Trio — Smooth Jazz Sessions',
    venueName: 'Dazzle Jazz',
    venueId: 'venue-dazzle',
    city: 'Denver',
    region: 'CO',
    lat: 39.7425,
    lng: -104.995,
    localStartDate: '2026-11-10',
    startsAt: '2026-11-11T02:00:00Z',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    artists: [
      {
        id: ARTIST_ID_SAMENAME_B,
        name: 'John Smith',
        billingPosition: 'headliner',
      },
    ],
    minPrice: 25,
    maxPrice: 30,
    currency: 'USD',
  },

  // 11. Past event (ineligible: localStartDate < FIXTURE_REFERENCE_DATE 2026-11-01)
  {
    id: 'ev-past-show',
    title: 'The Cure — Past October Festival',
    venueName: 'Fiddler Green Amphitheatre',
    venueId: 'venue-fiddlers-green',
    city: 'Greenwood Village',
    region: 'CO',
    lat: 39.6001,
    lng: -104.8912,
    localStartDate: '2026-10-15',
    startsAt: '2026-10-16T01:00:00Z',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    artists: [
      {
        id: ARTIST_ID_THE_CURE,
        name: 'The Cure',
        billingPosition: 'headliner',
      },
    ],
    minPrice: 65,
    maxPrice: 120,
    currency: 'USD',
  },
];
