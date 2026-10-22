import {
  type SpotifyTimeRange,
  type SpotifyTopArtist,
  type SpotifyUserProfile,
} from '@/lib/domain/spotify';

/**
 * Phase 2, PR #10 Synthetic Spotify Preview Data
 *
 * Provides realistic, curated Spotify listening data across short-term, medium-term,
 * and long-term windows when live credentials are not configured or in development mode.
 *
 * Illustrates the 60% short-term / 30% medium-term / 10% long-term recency hypothesis
 * by demonstrating rising, consistent (staple), and fading listening trends across windows.
 */

export const SYNTHETIC_USER_PROFILE: SpotifyUserProfile = {
  accountId: 'synthetic_demo_account',
  displayName: 'Encore Preview Listener',
  email: 'preview@encore.live',
  product: 'premium',
};

/**
 * Options for evaluating synthetic preview availability.
 */
export interface SyntheticPreviewGuardOptions {
  nodeEnv?: string;
  devPreviewFlag?: string;
  isCi?: string | boolean;
  isTest?: string | boolean;
}

/**
 * Checks whether synthetic preview data generation is permitted in the current environment.
 *
 * Security Invariant:
 * - Development and in-memory test environments allow synthetic preview by default.
 * - Ordinary production deployments STRICTLY FORBID synthetic preview.
 *   An accidental feature flag in a normal production deployment will NEVER expose synthetic data.
 * - In production mode, preview is only permitted in isolated automated test execution (CI or Playwright test server)
 *   when explicitly opted into via ENABLE_SPOTIFY_DEV_PREVIEW=true.
 */
export function isSyntheticPreviewAllowed(
  optionsOrNodeEnv?: string | SyntheticPreviewGuardOptions,
  devPreviewFlagParam?: string,
): boolean {
  let nodeEnv: string | undefined = process.env.NODE_ENV;
  let devPreviewFlag = process.env.ENABLE_SPOTIFY_DEV_PREVIEW;
  let isCi: string | boolean | undefined = process.env.CI;
  let isTest: string | boolean | undefined = process.env.PLAYWRIGHT_TEST;

  if (typeof optionsOrNodeEnv === 'object' && optionsOrNodeEnv !== null) {
    if (optionsOrNodeEnv.nodeEnv !== undefined)
      nodeEnv = optionsOrNodeEnv.nodeEnv;
    if (optionsOrNodeEnv.devPreviewFlag !== undefined)
      devPreviewFlag = optionsOrNodeEnv.devPreviewFlag;
    if (optionsOrNodeEnv.isCi !== undefined) isCi = optionsOrNodeEnv.isCi;
    if (optionsOrNodeEnv.isTest !== undefined) isTest = optionsOrNodeEnv.isTest;
  } else if (typeof optionsOrNodeEnv === 'string') {
    nodeEnv = optionsOrNodeEnv;
    if (devPreviewFlagParam !== undefined) {
      devPreviewFlag = devPreviewFlagParam;
    }
  }

  // 1. Local development and standard test runners permit preview
  if (nodeEnv === 'development' || nodeEnv === 'test') {
    return devPreviewFlag !== 'false';
  }

  // 2. Production: strictly disabled in normal production deployments.
  // Permitted ONLY if both:
  //   a) Running in an automated test environment (CI or Playwright runner)
  //   b) Explicitly enabled via ENABLE_SPOTIFY_DEV_PREVIEW=true
  const isAutomatedTest =
    isCi === true ||
    isCi === 'true' ||
    isCi === '1' ||
    isTest === true ||
    isTest === 'true' ||
    isTest === '1';

  if (isAutomatedTest && devPreviewFlag === 'true') {
    return true;
  }

  return false;
}

interface BaseArtistCatalogEntry {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  imageUrl: string;
  spotifyUrl: string;
  ranks: {
    short_term: number | null;
    medium_term: number | null;
    long_term: number | null;
  };
  trend: 'rising' | 'consistent' | 'fading';
  trendRationale: string;
}

const SYNTHETIC_CATALOG: BaseArtistCatalogEntry[] = [
  {
    id: 'synth-chappell-roan',
    name: 'Chappell Roan',
    genres: ['pop', 'indie pop', 'synthpop'],
    popularity: 92,
    imageUrl:
      'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80',
    spotifyUrl: 'https://open.spotify.com/artist/7GlBOeep6PqTfFi59PTJ60',
    ranks: { short_term: 1, medium_term: 4, long_term: null },
    trend: 'rising',
    trendRationale:
      'Surging in past 4 weeks (Rank #1 short-term, #4 medium-term; unranked all-time). High recent momentum.',
  },
  {
    id: 'synth-khruangbin',
    name: 'Khruangbin',
    genres: ['psychedelic rock', 'funk', 'instrumental'],
    popularity: 79,
    imageUrl:
      'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=600&auto=format&fit=crop&q=80',
    spotifyUrl: 'https://open.spotify.com/artist/2mVuvv0vv0vv0vv0vv0vv0',
    ranks: { short_term: 2, medium_term: 2, long_term: 2 },
    trend: 'consistent',
    trendRationale:
      'Consistent top staple across all listening horizons (Rank #2 in short, medium, and long-term).',
  },
  {
    id: 'synth-charli-xcx',
    name: 'Charli xcx',
    genres: ['hyperpop', 'electropop', 'dance pop'],
    popularity: 88,
    imageUrl:
      'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80',
    spotifyUrl: 'https://open.spotify.com/artist/25uiPmTg16RbhZWAqwLBy5',
    ranks: { short_term: 3, medium_term: 3, long_term: 9 },
    trend: 'rising',
    trendRationale:
      'Heavy summer rotation; sustained high short/medium rank (#3) elevated from all-time baseline (#9).',
  },
  {
    id: 'synth-lcd-soundsystem',
    name: 'LCD Soundsystem',
    genres: ['dance punk', 'indie rock', 'electronic'],
    popularity: 71,
    imageUrl:
      'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=600&auto=format&fit=crop&q=80',
    spotifyUrl: 'https://open.spotify.com/artist/066X20Nz7iquqkk9J6dJnv',
    ranks: { short_term: 4, medium_term: 5, long_term: 3 },
    trend: 'consistent',
    trendRationale:
      'Enduring live favorite; steady top-5 placement across all time windows.',
  },
  {
    id: 'synth-bon-iver',
    name: 'Bon Iver',
    genres: ['indie folk', 'art pop', 'chamber pop'],
    popularity: 80,
    imageUrl:
      'https://images.unsplash.com/photo-1483412033650-1015ddeb83d1?w=600&auto=format&fit=crop&q=80',
    spotifyUrl: 'https://open.spotify.com/artist/4LEiUm1SRbFMgfqnQTwUbQ',
    ranks: { short_term: 5, medium_term: 6, long_term: 4 },
    trend: 'consistent',
    trendRationale:
      'Multi-year rotation staple, prominent across all horizons.',
  },
  {
    id: 'synth-tame-impala',
    name: 'Tame Impala',
    genres: ['psychedelic rock', 'neo-psychedelia', 'indie rock'],
    popularity: 86,
    imageUrl:
      'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    spotifyUrl: 'https://open.spotify.com/artist/5INjqkS1o8h1imAzPqGZBb',
    ranks: { short_term: 8, medium_term: 1, long_term: 1 },
    trend: 'fading',
    trendRationale:
      'All-time #1 anchor, but cooling slightly in the most recent 4 weeks (#8 short-term).',
  },
  {
    id: 'synth-fleet-foxes',
    name: 'Fleet Foxes',
    genres: ['indie folk', 'folk rock', 'chamber folk'],
    popularity: 69,
    imageUrl:
      'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&auto=format&fit=crop&q=80',
    spotifyUrl: 'https://open.spotify.com/artist/4EVpmkEwrTrEg6eaBmPLbt',
    ranks: { short_term: null, medium_term: 8, long_term: 5 },
    trend: 'fading',
    trendRationale:
      'Strong historical affinity (#5 all-time), but absent from top 10 recent 4-week listening.',
  },
  {
    id: 'synth-the-national',
    name: 'The National',
    genres: ['indie rock', 'post-punk revival', 'chamber pop'],
    popularity: 74,
    imageUrl:
      'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=600&auto=format&fit=crop&q=80',
    spotifyUrl: 'https://open.spotify.com/artist/2cP4WL3S7Ms750014841m',
    ranks: { short_term: 6, medium_term: 7, long_term: 6 },
    trend: 'consistent',
    trendRationale:
      'Reliable indie benchmark; uniform mid-range ranks across all horizons.',
  },
  {
    id: 'synth-alvvays',
    name: 'Alvvays',
    genres: ['indie pop', 'dream pop', 'jangle pop'],
    popularity: 68,
    imageUrl:
      'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=600&auto=format&fit=crop&q=80',
    spotifyUrl: 'https://open.spotify.com/artist/3kzwYV3OCB010GmDdmuO57',
    ranks: { short_term: 7, medium_term: null, long_term: null },
    trend: 'rising',
    trendRationale:
      'Recent rediscovery; placed #7 short-term without previous long-term ranking.',
  },
  {
    id: 'synth-vampire-weekend',
    name: 'Vampire Weekend',
    genres: ['indie rock', 'baroque pop', 'art pop'],
    popularity: 76,
    imageUrl:
      'https://images.unsplash.com/photo-1520523839898-507127027581?w=600&auto=format&fit=crop&q=80',
    spotifyUrl: 'https://open.spotify.com/artist/5BvJzeQpmsdsFp4HGUYUEx',
    ranks: { short_term: null, medium_term: 9, long_term: 7 },
    trend: 'fading',
    trendRationale:
      'Historical staple (#7 long-term) not currently in active 4-week heavy rotation.',
  },
];

/**
 * Returns synthetic top artists for the specified time range.
 */
export function getSyntheticTopArtists(
  timeRange: SpotifyTimeRange,
): SpotifyTopArtist[] {
  const eligible = SYNTHETIC_CATALOG.filter(
    (item) => item.ranks[timeRange] !== null,
  ).sort((a, b) => (a.ranks[timeRange] ?? 999) - (b.ranks[timeRange] ?? 999));

  return eligible.map((entry, index) => ({
    id: entry.id,
    name: entry.name,
    rank: entry.ranks[timeRange] ?? index + 1,
    imageUrl: entry.imageUrl,
    spotifyUrl: entry.spotifyUrl,
    genres: [...entry.genres],
    popularity: entry.popularity,
    trend: entry.trend,
    timeRange,
  }));
}

export interface SyntheticRecencyExplanation {
  artistName: string;
  shortTermRank: number | null;
  mediumTermRank: number | null;
  longTermRank: number | null;
  trend: 'rising' | 'consistent' | 'fading';
  rationale: string;
}

/**
 * Returns detailed recency comparisons across all 3 windows for demo illustration.
 */
export function getSyntheticRecencyComparisons(): SyntheticRecencyExplanation[] {
  return SYNTHETIC_CATALOG.map((entry) => ({
    artistName: entry.name,
    shortTermRank: entry.ranks.short_term,
    mediumTermRank: entry.ranks.medium_term,
    longTermRank: entry.ranks.long_term,
    trend: entry.trend,
    rationale: entry.trendRationale,
  }));
}
