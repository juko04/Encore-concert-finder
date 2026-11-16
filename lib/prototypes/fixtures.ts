/**
 * Encore Multi-Agent Design Exploration — Shared Prototype Fixtures
 *
 * Invariants & Guarantees:
 * 1. Strictly isolated for prototype demonstrations; zero leakage into production tables.
 * 2. Shared identically between Encore Index (Agent 1) and Encore Signal (Agent 2)
 *    so both prototypes can be compared objectively under identical test scenarios.
 * 3. Encompasses:
 *    - Scenario 1 (Practical discovery: inexpensive show this weekend, unfamiliar artist)
 *    - Scenario 2 (Personalized discovery: unfamiliar artist with strong personalized score & clear pros/cons)
 *    - Scenario 3 (Planning ahead: favorite artist upcoming tour / presale with alert triggers)
 *    - Edge cases: $0/free event, missing price, missing coordinates, sold out, cancelled, 21+ restriction, multi-artist lineup.
 */

import type { CanonicalEventSummary } from '@/lib/domain/catalog';

export interface PrototypeEvent extends CanonicalEventSummary {
  // Enhanced metadata for rich prototype evaluation
  genre: string;
  subgenres?: string[];
  vibeTags: string[];
  ageRestriction: 'all_ages' | '18+' | '21+';
  doorTime?: string;
  presaleDate?: string;
  generalOnsaleDate?: string;
  ticketStatus:
    'available' | 'presale' | 'low_inventory' | 'sold_out' | 'cancelled';
  posterColor: string; // Hex color extracted from artwork for artist-derived accents
  posterSecondaryColor: string;
  heroImageUrl?: string;
  // Editorial evaluation for detail pages
  whyItSuitsYou: string[];
  considerations: string[]; // Honest practical drawbacks
  spotifyPreviewTrack?: {
    title: string;
    duration: string;
    previewUrl?: string;
  };
  samplePersonalScore: {
    authenticatedScore: number; // 0 - 100
    guestScore: number; // Balanced non-personalized rank
    matchReason: string;
    affinityType:
      'favorite' | 'like' | 'interested' | 'exploratory' | 'disliked';
  };
}

export interface PrototypeUserPreference {
  artistId: string;
  artistName: string;
  level: 'favorite' | 'like' | 'interested' | 'ignore';
  source: 'explicit' | 'spotify_import' | 'browsing_signal';
  addedAt: string;
}

export const PROTOTYPE_INITIAL_PREFERENCES: PrototypeUserPreference[] = [
  {
    artistId: 'art-cure',
    artistName: 'The Cure',
    level: 'favorite',
    source: 'explicit',
    addedAt: '2026-08-15T12:00:00Z',
  },
  {
    artistId: 'art-japanese-breakfast',
    artistName: 'Japanese Breakfast',
    level: 'favorite',
    source: 'explicit',
    addedAt: '2026-09-01T10:00:00Z',
  },
  {
    artistId: 'art-aurora',
    artistName: 'AURORA',
    level: 'like',
    source: 'spotify_import',
    addedAt: '2026-09-14T15:30:00Z',
  },
  {
    artistId: 'art-khruangbin',
    artistName: 'Khruangbin',
    level: 'like',
    source: 'explicit',
    addedAt: '2026-10-05T09:15:00Z',
  },
  {
    artistId: 'art-overhyped-dj',
    artistName: 'Neon Hype Machine',
    level: 'ignore',
    source: 'explicit',
    addedAt: '2026-10-10T18:00:00Z',
  },
];

export const PROTOTYPE_EVENTS: PrototypeEvent[] = [
  // 1. Scenario 1: Practical discovery — This Weekend, Cheap ($18), Local Bar/Club, Unfamiliar Artist
  {
    id: 'proto-ev-101',
    title: 'Silver Lake Dreamers with Pale Honey',
    venueName: 'Larimer Lounge',
    venueId: 'proto-venue-larimer',
    city: 'Denver',
    region: 'CO',
    lat: 39.7595,
    lng: -104.9835,
    localStartDate: '2026-11-14', // Saturday this weekend
    startsAt: '2026-11-15T03:00:00Z',
    doorTime: '7:30 PM',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    eventKind: 'club_show',
    artists: [
      {
        id: 'art-silver-lake',
        name: 'Silver Lake Dreamers',
        billingPosition: 'headliner',
      },
      { id: 'art-pale-honey', name: 'Pale Honey', billingPosition: 'support' },
    ],
    genre: 'Indie Rock / Shoegaze',
    subgenres: ['Dream Pop', 'Jangle Rock', 'Lo-Fi'],
    vibeTags: ['Intimate Room', 'High Energy', 'Under $20', 'Draft Beers'],
    ageRestriction: '21+',
    ticketStatus: 'available',
    minPrice: 18,
    maxPrice: 22,
    currency: 'USD',
    ticketUrl: 'https://example.com/tickets/larimer/silver-lake-dreamers',
    posterColor: '#3B82F6', // Vibrant Blue
    posterSecondaryColor: '#1E3A8A',
    whyItSuitsYou: [
      'Tickets are only $18 — well below your spontaneous show threshold ($30)',
      'Venue is under 2 miles from central Denver with fast entry',
      'Pairs fuzz-drenched guitars with melodic hooks similar to Alvvays and Beach Fossils',
      'Weekend timing with comfortable 8:00 PM start',
    ],
    considerations: [
      'Strict 21+ ID check at the door (no minors permitted)',
      'Standing-room only room with limited bench seating along the back wall',
      'Street parking on Larimer St fills up fast on Saturday evenings',
    ],
    spotifyPreviewTrack: {
      title: 'Midnight Reverie',
      duration: '3:42',
    },
    samplePersonalScore: {
      authenticatedScore: 84,
      guestScore: 78,
      matchReason: 'Affordable weekend indie showcase with high venue affinity',
      affinityType: 'exploratory',
    },
  },

  // 2. Scenario 2: Personalized discovery — Unfamiliar Artist, high match, intelligent justification
  {
    id: 'proto-ev-102',
    title: 'Hania Rani & Dobrawa Czocher — Ghosts Tour',
    venueName: 'Bluebird Theater',
    venueId: 'proto-venue-bluebird',
    city: 'Denver',
    region: 'CO',
    lat: 39.7402,
    lng: -104.945,
    localStartDate: '2026-11-19', // Next Thursday
    startsAt: '2026-11-20T02:30:00Z',
    doorTime: '7:00 PM',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    eventKind: 'concert',
    artists: [
      {
        id: 'art-hania-rani',
        name: 'Hania Rani',
        billingPosition: 'headliner',
      },
      {
        id: 'art-dobrawa',
        name: 'Dobrawa Czocher',
        billingPosition: 'support',
      },
    ],
    genre: 'Neo-Classical / Ambient Electronic',
    subgenres: ['Modern Classical', 'Minimalist Piano', 'Analog Synth'],
    vibeTags: [
      'Hypnotic',
      'Seated & Standing',
      'Superb Acoustics',
      'Listening Room Vibe',
    ],
    ageRestriction: '18+',
    ticketStatus: 'low_inventory',
    minPrice: 32,
    maxPrice: 42,
    currency: 'USD',
    ticketUrl: 'https://example.com/tickets/bluebird/hania-rani',
    posterColor: '#0D9488', // Deep Teal
    posterSecondaryColor: '#134E4A',
    whyItSuitsYou: [
      'High overlap with your instrumental and ambient listening habits',
      'The historic Bluebird Theater acoustics bring out subtle piano and cello textures',
      'Rare North American stop on a critically acclaimed European tour',
      'Ticket price of $32 is very fair for a premier touring ensemble',
    ],
    considerations: [
      'Low inventory remaining — less than 35 tickets before complete sellout',
      'Mid-week show ending around 10:45 PM on a Thursday night',
      'Colfax bus transit is convenient, but East Colfax street parking is metered until 10 PM',
    ],
    spotifyPreviewTrack: {
      title: 'Leaving',
      duration: '5:18',
    },
    samplePersonalScore: {
      authenticatedScore: 92,
      guestScore: 81,
      matchReason:
        'Unfamiliar artist with 94% aesthetic compatibility with your ambient & indie taste',
      affinityType: 'exploratory',
    },
  },

  // 3. Scenario 3: Planning ahead — Favorite Artist, Major Concert, Active Presale & Onsale Alerts
  {
    id: 'proto-ev-103',
    title: 'The Cure — Songs of a Lost World Tour',
    venueName: 'Red Rocks Amphitheatre',
    venueId: 'proto-venue-red-rocks',
    city: 'Morrison',
    region: 'CO',
    lat: 39.6654,
    lng: -105.2057,
    localStartDate: '2026-12-05', // 3 weeks out
    startsAt: '2026-12-06T02:00:00Z',
    doorTime: '6:00 PM',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    eventKind: 'concert',
    artists: [
      { id: 'art-cure', name: 'The Cure', billingPosition: 'headliner' },
      {
        id: 'art-twilight-sad',
        name: 'The Twilight Sad',
        billingPosition: 'support',
      },
    ],
    genre: 'Post-Punk / Goth Rock',
    subgenres: ['New Wave', 'Alternative', '80s Iconic'],
    vibeTags: [
      'Bucket List',
      'Iconic Outdoor Venue',
      'Full Production',
      '3-Hour Set',
    ],
    ageRestriction: 'all_ages',
    ticketStatus: 'presale',
    presaleDate: '2026-11-12T17:00:00Z', // In 2 days
    generalOnsaleDate: '2026-11-14T17:00:00Z',
    minPrice: 85,
    maxPrice: 175,
    currency: 'USD',
    ticketUrl: 'https://example.com/tickets/redrocks/the-cure',
    posterColor: '#8B5CF6', // Moody Purple / Violet
    posterSecondaryColor: '#4C1D95',
    whyItSuitsYou: [
      'The Cure is pinned as your #1 All-Time Favorite Artist in your taste profile',
      'Extended 30+ song career-spanning set with legendary encore sequence',
      'Red Rocks natural amphitheater backdrop offers world-class sound immersion',
      'Scores 100 on your artist match factor',
    ],
    considerations: [
      'High demand: Artist Presale requires registration prior to Thursday 10:00 AM MT',
      'Morrison foothill temperatures in December require heavy winter layering',
      'Steep walk from Lower South Lot — arrive early or consider shuttle options',
    ],
    spotifyPreviewTrack: {
      title: 'Alone',
      duration: '6:48',
    },
    samplePersonalScore: {
      authenticatedScore: 98,
      guestScore: 94,
      matchReason: 'Top Favorite Artist · Presale window opens Thursday',
      affinityType: 'favorite',
    },
  },

  // 4. Weekend High Energy: Japanese Breakfast at Mission Ballroom (Favorite Artist)
  {
    id: 'proto-ev-104',
    title: 'Japanese Breakfast with Special Guest Luna Li',
    venueName: 'Mission Ballroom',
    venueId: 'proto-venue-mission',
    city: 'Denver',
    region: 'CO',
    lat: 39.7745,
    lng: -104.9785,
    localStartDate: '2026-11-15', // Sunday
    startsAt: '2026-11-16T02:00:00Z',
    doorTime: '7:00 PM',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    eventKind: 'concert',
    artists: [
      {
        id: 'art-japanese-breakfast',
        name: 'Japanese Breakfast',
        billingPosition: 'headliner',
      },
      { id: 'art-luna-li', name: 'Luna Li', billingPosition: 'support' },
    ],
    genre: 'Indie Pop / Art Rock',
    subgenres: ['Experimental Pop', 'Shoegaze Pop', 'Indie Folk'],
    vibeTags: ['Tiered Sightlines', 'State-of-the-Art Sound', 'Celebratory'],
    ageRestriction: '18+',
    ticketStatus: 'available',
    minPrice: 45,
    maxPrice: 65,
    currency: 'USD',
    ticketUrl: 'https://example.com/tickets/mission/japanese-breakfast',
    posterColor: '#F59E0B', // Warm Amber / Sunset
    posterSecondaryColor: '#78350F',
    whyItSuitsYou: [
      'Japanese Breakfast is one of your declared favorite artists',
      'Mission Ballroom movable stage offers uncompromised sound and unobstructed views anywhere in room',
      'Under your maximum normal concert budget ($60 GA)',
      'Luna Li is an exceptional opener with harp-infused indie pop',
    ],
    considerations: [
      'Ticket prices jump to $55 on day of show if tickets remain',
      'Garage parking is $20; RTD A-Line light rail to 38th & Blake is recommended',
    ],
    spotifyPreviewTrack: {
      title: 'Be Sweet',
      duration: '3:15',
    },
    samplePersonalScore: {
      authenticatedScore: 96,
      guestScore: 89,
      matchReason: 'Explicit Favorite Headliner · Tiered modern venue',
      affinityType: 'favorite',
    },
  },

  // 5. Cheap & Spontaneous: $0 Free Outdoor Community Showcase
  {
    id: 'proto-ev-105',
    title: 'Civic Center Beats: Sunset Funk & Soul Sessions',
    venueName: 'Civic Center Park Amphitheater',
    venueId: 'proto-venue-civic-center',
    city: 'Denver',
    region: 'CO',
    lat: 39.7392,
    lng: -104.988,
    localStartDate: '2026-11-14', // Saturday Afternoon
    startsAt: '2026-11-14T21:00:00Z',
    doorTime: '2:00 PM',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    eventKind: 'free_event',
    artists: [
      {
        id: 'art-colorado-soul-revue',
        name: 'Colorado Soul Revue',
        billingPosition: 'headliner',
      },
      {
        id: 'art-dj-chile',
        name: 'DJ Chile (Vinyl Set)',
        billingPosition: 'support',
      },
    ],
    genre: 'Funk & Soul / R&B',
    subgenres: ['Classic Soul', 'Afrobeat', 'Vinyl Selects'],
    vibeTags: [
      'Free Entry ($0)',
      'Outdoor Lawn',
      'Food Trucks',
      'Family Friendly',
    ],
    ageRestriction: 'all_ages',
    ticketStatus: 'available',
    minPrice: 0,
    maxPrice: 0,
    currency: 'USD',
    ticketUrl: null, // Free show, no ticket link needed
    posterColor: '#10B981', // Emerald Green
    posterSecondaryColor: '#064E3B',
    whyItSuitsYou: [
      'Completely free public community event — zero ticket cost',
      'Relaxed outdoor lawn vibe with food trucks and local craft beverage vendors',
      'Daytime timing (2:00 PM – 6:30 PM) perfect before evening plans',
      'Great chance to discover Denver local horn section and vinyl selectors',
    ],
    considerations: [
      'Lawn seating — bring your own blanket or folding chair',
      'Weather-dependent: event may move under pavilion if autumn rain occurs',
      'No ticket reservations required, first-come first-served seating',
    ],
    samplePersonalScore: {
      authenticatedScore: 75,
      guestScore: 82,
      matchReason: 'Free $0 event · Walking distance in central Denver',
      affinityType: 'exploratory',
    },
  },

  // 6. Worth Traveling For / Festival: 2-Day Boulder Mountain Sound Fest
  {
    id: 'proto-ev-106',
    title: 'Boulder Mountain Sound Festival 2026',
    venueName: 'Boulder Theater & Fox Theatre',
    venueId: 'proto-venue-boulder-dual',
    city: 'Boulder',
    region: 'CO',
    lat: 40.0176,
    lng: -105.2797,
    localStartDate: '2026-11-28', // Thanksgiving weekend
    startsAt: '2026-11-28T23:00:00Z',
    doorTime: '4:00 PM',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    eventKind: 'multi_day_festival',
    artists: [
      {
        id: 'art-khruangbin',
        name: 'Khruangbin',
        billingPosition: 'headliner',
      },
      {
        id: 'art-bonobo',
        name: 'Bonobo (Live Band)',
        billingPosition: 'subheadliner',
      },
      {
        id: 'art-yussef-dayes',
        name: 'Yussef Dayes',
        billingPosition: 'mid_card',
      },
      {
        id: 'art-roots-collective',
        name: 'Roots Mountain Collective',
        billingPosition: 'support',
      },
    ],
    genre: 'Psych Rock / Global Groove / Electronic',
    subgenres: ['Neo-Psychedelia', 'Downtempo', 'Jazz Fusion'],
    vibeTags: ['Festival Wristband', 'Multi-Venue Walkable', 'Late Night Jams'],
    ageRestriction: 'all_ages',
    ticketStatus: 'available',
    minPrice: 110,
    maxPrice: 220,
    currency: 'USD',
    ticketUrl: 'https://example.com/tickets/boulder/mountain-sound-fest',
    posterColor: '#EC4899', // Hot Pink / Neon
    posterSecondaryColor: '#831843',
    whyItSuitsYou: [
      'Khruangbin is in your Liked Artists, and Yussef Dayes aligns with your groove affinities',
      'Two historic venues connected across Pearl Street pedestrian mall',
      'Over 18 bands across 2 days with seamless venue-hopping schedule',
    ],
    considerations: [
      'Requires 30-mile travel from Denver to Boulder (US-36 Flatiron Flyer bus is direct)',
      'Multi-day passes require physical wristband pickup before 6 PM Friday',
      'Higher commitment price point ($110 early bird 2-day pass)',
    ],
    spotifyPreviewTrack: {
      title: 'Time (You and I)',
      duration: '5:42',
    },
    samplePersonalScore: {
      authenticatedScore: 89,
      guestScore: 86,
      matchReason:
        'Multi-artist lineup featuring Khruangbin & Bonobo · High trip value',
      affinityType: 'like',
    },
  },

  // 7. Missing Price / TBA edge case
  {
    id: 'proto-ev-107',
    title: 'Cervantes’ Grassroots Jam & Community Cypher',
    venueName: 'Cervantes’ Masterpiece Ballroom',
    venueId: 'proto-venue-cervantes',
    city: 'Denver',
    region: 'CO',
    lat: 39.7548,
    lng: -104.9782,
    localStartDate: '2026-11-21',
    startsAt: '2026-11-22T03:00:00Z',
    doorTime: '8:00 PM',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    eventKind: 'concert',
    artists: [
      {
        id: 'art-cervantes-cypher',
        name: 'Mile High Improvisers Guild',
        billingPosition: 'headliner',
      },
    ],
    genre: 'Hip-Hop / Live Jam / Funk',
    subgenres: ['Jazz Rap', 'Freestyle', 'Instrumental Jam'],
    vibeTags: ['Dual Stage', 'Patio Fire Pit', 'Late Night'],
    ageRestriction: '21+',
    ticketStatus: 'available',
    minPrice: null, // Missing price data -> Neutral fallback
    maxPrice: null,
    currency: null,
    ticketUrl: 'https://example.com/tickets/cervantes/mile-high-guild',
    posterColor: '#F97316', // Orange
    posterSecondaryColor: '#7C2D12',
    whyItSuitsYou: [
      'Beloved Five Points live-music hub with vibrant dual-stage layout',
      'Unscripted collaborative jam featuring top Denver session instrumentalists',
      'Spontaneous walk-up ticket policy with minimal door charge',
    ],
    considerations: [
      'Ticket price is currently TBA at the door (usually $10–$15 cash/card)',
      'Show runs until 1:30 AM with multiple guest sit-ins',
    ],
    samplePersonalScore: {
      authenticatedScore: 68,
      guestScore: 71,
      matchReason: 'Live jam collective · Price TBA at door',
      affinityType: 'exploratory',
    },
  },

  // 8. Sold Out / Active Watchlist Scenario
  {
    id: 'proto-ev-108',
    title: 'Fontaines D.C. — Romance North America Tour',
    venueName: 'Mission Ballroom',
    venueId: 'proto-venue-mission',
    city: 'Denver',
    region: 'CO',
    lat: 39.7745,
    lng: -104.9785,
    localStartDate: '2026-11-25',
    startsAt: '2026-11-26T03:00:00Z',
    doorTime: '7:00 PM',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    eventKind: 'concert',
    artists: [
      {
        id: 'art-fontaines',
        name: 'Fontaines D.C.',
        billingPosition: 'headliner',
      },
      {
        id: 'art-been-stellar',
        name: 'Been Stellar',
        billingPosition: 'support',
      },
    ],
    genre: 'Post-Punk / Alternative',
    subgenres: ['Art Punk', 'Irish Rock', 'Indie Rock'],
    vibeTags: [
      'Sold Out',
      'High Intensity',
      'Mosh Pit Affordance',
      'Tour Phenomenon',
    ],
    ageRestriction: '18+',
    ticketStatus: 'sold_out',
    minPrice: 40,
    maxPrice: 85,
    currency: 'USD',
    ticketUrl: 'https://example.com/tickets/mission/fontaines-dc',
    posterColor: '#EF4444', // Fiery Red
    posterSecondaryColor: '#7F1D1D',
    whyItSuitsYou: [
      'Critically lauded post-punk band with soaring reviews for their latest record',
      'High-velocity live reputation with massive audience engagement',
    ],
    considerations: [
      'OFFICIALLY SOLD OUT — primary tickets exhausted',
      'Watchlist & ticket-drop alerts are critical to grab face-value production re-releases',
      'Beware unauthorized third-party resale scams; wait for verified AXS transfers',
    ],
    spotifyPreviewTrack: {
      title: 'Starburster',
      duration: '3:41',
    },
    samplePersonalScore: {
      authenticatedScore: 87,
      guestScore: 84,
      matchReason: 'High taste alignment · Sold out; watch for ticket releases',
      affinityType: 'exploratory',
    },
  },

  // 9. Intimate Speakeasy / Velvet Elk Lounge in Boulder
  {
    id: 'proto-ev-109',
    title: 'The Alcapones (Ska & Balkan Brass Extravaganza)',
    venueName: 'The Velvet Elk Lounge',
    venueId: 'proto-venue-velvet-elk',
    city: 'Boulder',
    region: 'CO',
    lat: 40.017,
    lng: -105.281,
    localStartDate: '2026-11-13', // This Friday!
    startsAt: '2026-11-14T04:00:00Z',
    doorTime: '8:00 PM',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    eventKind: 'club_show',
    artists: [
      {
        id: 'art-alcapones',
        name: 'The Alcapones',
        billingPosition: 'headliner',
      },
    ],
    genre: 'Ska / Balkan Brass / Reggae',
    subgenres: ['Brass Band', 'Gypsy Jazz', 'Dance Party'],
    vibeTags: [
      'Intimate Listening Bar',
      'Cocktail Lounge',
      'Dancing',
      'Friday Night',
    ],
    ageRestriction: '21+',
    ticketStatus: 'available',
    minPrice: 15,
    maxPrice: 18,
    currency: 'USD',
    ticketUrl: 'https://example.com/tickets/velvetelk/alcapones',
    posterColor: '#D97706', // Rich Gold / Brass
    posterSecondaryColor: '#78350F',
    whyItSuitsYou: [
      'Super affordable $15 ticket for high-energy 7-piece horn outfit',
      'Happening this Friday night — perfect spontaneous start to the weekend',
      'Cozy, velvet-draped boutique room with top-tier craft cocktail menu',
    ],
    considerations: [
      'Small room capacity (~120 cap) — dance floor gets packed quickly',
      '21+ strict policy at all times',
      'Late show: music starts at 9:00 PM',
    ],
    spotifyPreviewTrack: {
      title: 'Balkan Stomp',
      duration: '4:12',
    },
    samplePersonalScore: {
      authenticatedScore: 81,
      guestScore: 76,
      matchReason: 'This Friday · High-energy brass party in intimate room',
      affinityType: 'exploratory',
    },
  },

  // 10. Ignored / Suppressed Artist Test Case (Invariant 11 demo)
  {
    id: 'proto-ev-110',
    title: 'Neon Hype Machine & Glowstick Circus',
    venueName: 'Exdo Mega Complex',
    venueId: 'proto-venue-exdo',
    city: 'Denver',
    region: 'CO',
    lat: 39.764,
    lng: -104.981,
    localStartDate: '2026-11-20',
    startsAt: '2026-11-21T04:00:00Z',
    doorTime: '9:00 PM',
    timezone: 'America/Denver',
    startTimePrecision: 'instant',
    status: 'scheduled',
    eventKind: 'concert',
    artists: [
      {
        id: 'art-overhyped-dj',
        name: 'Neon Hype Machine',
        billingPosition: 'headliner',
      },
    ],
    genre: 'Commercial EDM / Big Room',
    subgenres: ['Festival Drop', 'Mainstage'],
    vibeTags: ['Laser Heavy', 'Foam Party', 'VIP Tables'],
    ageRestriction: '18+',
    ticketStatus: 'available',
    minPrice: 65,
    maxPrice: 150,
    currency: 'USD',
    ticketUrl: 'https://example.com/tickets/exdo/neon-hype',
    posterColor: '#6366F1',
    posterSecondaryColor: '#312E81',
    whyItSuitsYou: ['Event exists nearby in central Denver'],
    considerations: [
      'You explicitly marked "Neon Hype Machine" as Ignored / Disliked in your taste profile',
      'Per Invariant 11, disliked headliners are fully suppressed from your recommendations',
    ],
    samplePersonalScore: {
      authenticatedScore: 0, // Suppressed!
      guestScore: 65,
      matchReason: 'SUPPRESSED: Headliner artist is on your Ignored list',
      affinityType: 'disliked',
    },
  },
];
