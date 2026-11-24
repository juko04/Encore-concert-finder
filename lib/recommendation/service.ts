import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { UserProfile } from '@/lib/domain/profile';
import {
  compareFeedOrder,
  compareScoredEvents,
  rankEvents,
  scoreEvent,
} from '@/lib/recommendation/engine';
import { checkEventEligibility } from '@/lib/recommendation/factors/eligibility';
import {
  calculate14DayLookaheadEndDate,
  calculateWeekendWindow,
  getModeScoringWeights,
  isEventEligibleForMode,
  normalizeDiscoveryMode,
  type ModeEligibilityContext,
} from '@/lib/recommendation/modes';
import {
  DEFAULT_PRESET,
  getPresetWeights,
  applyArtistWeight,
  isValidScoringPreset,
  normalizeScoringPreset,
} from '@/lib/recommendation/presets';
import type {
  DiscoveryMode,
  RecommendationResult,
  ScoredEvent,
  ScoringContext,
  ScoringPreset,
  ScoringWeights,
} from '@/lib/recommendation/types';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import type {
  EventListFilters,
  EventSortOption,
  ICatalogRepository,
  IProfileRepository,
  ISpotifyConnectionRepository,
  IUserPreferenceRepository,
} from '@/lib/repositories/interfaces';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';
import type { SpotifyTopArtist } from '@/lib/domain/spotify';
import { getActiveSpotifyTopArtistsForUser } from '@/lib/sources/spotify/affinity-service';
import {
  buildGenreTasteProfile,
  summarizeGenreTaste,
  type GenreTasteSummaryItem,
} from '@/lib/recommendation/genre';

export interface PersonalizedDiscoverOptions {
  userId: string;
  client?: SupabaseClient;
  profileRepo?: IProfileRepository;
  prefRepo?: IUserPreferenceRepository;
  catalogRepo?: ICatalogRepository;
  spotifyRepo?: ISpotifyConnectionRepository;
  spotifyTopArtists?: SpotifyTopArtist[];
  presetOverride?: unknown;
  locationOverride?: {
    lat: number;
    lng: number;
    radiusMiles?: number | null;
  } | null;
  mode?: unknown;
  discoveryMode?: unknown;
  referenceDate?: string;
  referenceInstant?: Date | string;
  city?: string;
  region?: string;
  searchQuery?: string;
}

export interface PersonalizedDiscoverResult {
  recommendations: ScoredEvent[];
  exploratory: ScoredEvent[];
  suppressed: ScoredEvent[];
  ineligibleCount: number;
  totalCandidateCount: number;
  userProfile: UserProfile | null;
  activePreset: ScoringPreset;
  activeWeights: ScoringWeights;
  activeMode: DiscoveryMode;
  hasPreferences: boolean;
  isSpotifyConnected: boolean;
  hasSpotifyAffinities?: boolean;
  isLocationConfigured: boolean;
  isEmptyCatalog: boolean;
  /** Genres the user is assumed to like, derived from their artists/Spotify (empty when unknown). */
  genreTaste?: GenreTasteSummaryItem[];
}

export interface PublicDiscoverOptions {
  client?: SupabaseClient;
  catalogRepo?: ICatalogRepository;
  city?: string;
  region?: string;
  searchQuery?: string;
  mode?: unknown;
  discoveryMode?: unknown;
  limit?: number;
  referenceDate?: string;
  referenceInstant?: Date | string;
}

export interface PublicDiscoverResult {
  events: CanonicalEventSummary[];
  isEmptyCatalog: boolean;
  totalCount: number;
  activeMode: DiscoveryMode;
}

/**
 * Dedicated bounds for candidate event retrieval:
 *
 * Tier 1 (Anti-Starvation Multi-Tier Quotas):
 * - Tier 1A: Up to 100 upcoming events specifically featuring user's Favorite artists.
 * - Tier 1B: Up to 75 upcoming events featuring Liked artists.
 * - Tier 1C: Up to 50 upcoming events featuring Interested artists.
 * Tier 2: Up to 150 general upcoming events in the catalog.
 *
 * Coverage Guarantee:
 * - Dedicated quota partitioning guarantees that favorite artist shows are NEVER starved or
 *   crowded out by numerous lower-tier (Interested/Liked) shows.
 * - Pushes status: 'scheduled' to SQL to eliminate scan-limit false negatives caused by cancelled shows.
 * - Prevents unbounded full-database reads and eliminates N+1 queries by batch-querying canonical IDs.
 */
export const FAVORITE_ARTIST_CANDIDATE_LIMIT = 100;
export const LIKE_ARTIST_CANDIDATE_LIMIT = 75;
/** Per-genre cap for taste-driven candidate retrieval. */
export const GENRE_CANDIDATE_LIMIT = 60;
export const INTERESTED_ARTIST_CANDIDATE_LIMIT = 50;
export const GENERAL_CATALOG_CANDIDATE_LIMIT = 150;

// Backwards compatibility alias
export const PREFERRED_ARTIST_CANDIDATE_LIMIT = FAVORITE_ARTIST_CANDIDATE_LIMIT;

/**
 * Calculates a conservative candidate retrieval lower bound date string (YYYY-MM-DD).
 *
 * Invariant:
 * Local event calendar dates must not be strictly filtered using the current UTC calendar date.
 * For example, at 8:00 PM in America/Denver on 2026-10-25, UTC is already 2026-10-26 02:00:00Z.
 * A strict UTC date filter (`>= '2026-10-26'`) would drop tonight's Denver show.
 *
 * Therefore, candidate retrieval uses a conservative lower bound: 24 hours (1 calendar day)
 * prior to the reference instant. Downstream scoring strictly enforces venue-timezone-aware
 * eligibility via checkEventEligibility().
 */
export function calculateCandidateRetrievalLowerBound(
  referenceDate?: string,
  referenceInstant?: Date | string,
): string {
  let instant: Date;
  if (referenceInstant) {
    instant =
      typeof referenceInstant === 'string'
        ? new Date(referenceInstant)
        : referenceInstant;
  } else if (referenceDate && referenceDate.includes('T')) {
    instant = new Date(referenceDate);
  } else if (referenceDate) {
    const parts = referenceDate.split('-').map(Number);
    instant = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  } else {
    instant = new Date();
  }

  const conservative = new Date(instant.getTime() - 24 * 60 * 60 * 1000);
  return conservative.toISOString().split('T')[0];
}

/**
 * Bounds candidate paging to avoid unbounded table scans while ensuring
 * recently-past, cancelled, or postponed events in the catalog do not squeeze out upcoming eligible shows.
 *
 * Intentional Design Tradeoff & Coverage Limitation:
 * Bounded scanning is capped at MAX_CANDIDATE_SCAN_PAGES (5 pages).
 * With pageSize = Math.max(targetEligibleLimit, 100):
 * - For general candidates (target: 150), up to 750 events are evaluated across 5 pages.
 * - For preferred-artist candidates (target: 100), up to 500 events are evaluated across 5 pages.
 * If an active market or artist has more than 500-750 consecutive past, cancelled, or postponed events
 * before the next valid scheduled concert, candidate retrieval safely halts at the scan cap
 * to protect database performance and prevent unbounded table scans.
 */
export const MAX_CANDIDATE_SCAN_PAGES = 5;

/**
 * Retrieves candidates while paging past recently-past, cancelled, and postponed events.
 *
 * Invariants:
 * 1. Begins query from `queryFromDate` (24h lookback to protect same-day shows in western timezones).
 * 2. Pushes `status: filters.status ?? 'scheduled'` into database queries to eliminate scan-limit false negatives.
 * 3. Only genuinely eligible scheduled events (`!eligibility.isPast && ev.status === 'scheduled'`) count
 *    toward the `targetEligibleLimit`. Cancelled, postponed, and past events do not prevent subsequent valid concerts.
 * 4. Ineligible, past, cancelled, and postponed events within the scan window are preserved in the returned
 *    candidate collection so that `totalCandidateCount`, `suppressed`, and `ineligibleCount` diagnostics
 *    remain truthful and candidate-aware.
 * 5. Limits total pages scanned to MAX_CANDIDATE_SCAN_PAGES (5) to guarantee bounded retrieval
 *    and prevent unbounded table scans.
 */
export async function retrieveCandidatesWithLookback(
  catalogRepo: ICatalogRepository,
  filters: EventListFilters,
  targetEligibleLimit: number,
  referenceDate?: string,
  referenceInstant?: Date | string,
  modeOptions?: {
    mode?: DiscoveryMode;
    modeContext?: ModeEligibilityContext;
  },
): Promise<CanonicalEventSummary[]> {
  const pageSize = Math.max(targetEligibleLimit, 100);
  const collectedCandidates: CanonicalEventSummary[] = [];
  const candidateIds = new Set<string>();
  let eligibleCount = 0;

  for (let page = 0; page < MAX_CANDIDATE_SCAN_PAGES; page++) {
    const batch = await catalogRepo.listEvents({
      ...filters,
      status: filters.status ?? 'scheduled',
      offset: page * pageSize,
      limit: pageSize,
    });

    if (batch.length === 0) {
      break;
    }

    for (const ev of batch) {
      if (!candidateIds.has(ev.id)) {
        candidateIds.add(ev.id);

        const eligibility = checkEventEligibility({
          localStartDate: ev.localStartDate,
          startsAt: ev.startsAt,
          timezone: ev.timezone,
          startTimePrecision: ev.startTimePrecision,
          referenceDate,
          referenceInstant,
        });

        const isTimingAndStatusEligible =
          !eligibility.isPast && ev.status === 'scheduled';
        const isModeEligible =
          !modeOptions?.mode ||
          modeOptions.mode === 'all' ||
          isEventEligibleForMode(
            ev,
            modeOptions.mode,
            modeOptions.modeContext ?? {},
          );

        const isGenuinelyEligible = isTimingAndStatusEligible && isModeEligible;

        if (isGenuinelyEligible) {
          if (eligibleCount < targetEligibleLimit) {
            eligibleCount++;
            collectedCandidates.push(ev);
          }
        } else {
          // Preserve non-mode-eligible, past, cancelled, and postponed events within the scan window
          // so candidate diagnostics, totalCandidateCount, suppressedCount, and
          // ineligibleCount remain completely truthful and candidate-aware.
          collectedCandidates.push(ev);
        }
      }

      if (eligibleCount >= targetEligibleLimit) {
        break;
      }
    }

    if (eligibleCount >= targetEligibleLimit || batch.length < pageSize) {
      break;
    }
  }

  return collectedCandidates;
}

/**
 * Helper to resolve artist IDs from preferences, resolving unmapped Spotify external IDs authoritatively.
 */
async function resolveArtistIdsForPreferences(
  prefs: Array<{
    artistId?: string | null;
    spotifyArtistId?: string | null;
  }>,
  catalogRepo: ICatalogRepository,
): Promise<string[]> {
  const artistIdSet = new Set<string>();
  const unmappedSpotifyIds: string[] = [];

  for (const p of prefs) {
    if (p.artistId) {
      artistIdSet.add(p.artistId);
    } else if (p.spotifyArtistId) {
      unmappedSpotifyIds.push(p.spotifyArtistId);
    }
  }

  if (
    unmappedSpotifyIds.length > 0 &&
    typeof catalogRepo.findArtistIdsByExternalIds === 'function'
  ) {
    const spotifyMap = await catalogRepo.findArtistIdsByExternalIds(
      'spotify',
      unmappedSpotifyIds,
    );
    for (const canonicalId of spotifyMap.values()) {
      artistIdSet.add(canonicalId);
    }
  }

  return Array.from(artistIdSet);
}

/**
 * Distributes a total candidate budget fairly across multiple artist IDs (Issue 2).
 * Guarantees that high-volume favorite artists do not starve other favorites,
 * while strictly bounding total candidate count to totalBudget.
 */
export function applyFairArtistAllocation(
  events: CanonicalEventSummary[],
  artistIds: string[],
  totalBudget: number,
): CanonicalEventSummary[] {
  if (events.length <= totalBudget || artistIds.length <= 1) {
    return events.slice(0, totalBudget);
  }

  const quotaPerArtist = Math.max(
    1,
    Math.floor(totalBudget / artistIds.length),
  );
  const artistEvents = new Map<string, CanonicalEventSummary[]>();
  for (const id of artistIds) {
    artistEvents.set(id, []);
  }

  // Group events by matching artist ID
  for (const ev of events) {
    for (const a of ev.artists) {
      if (a.id && artistEvents.has(a.id)) {
        artistEvents.get(a.id)!.push(ev);
        break;
      }
    }
  }

  const selectedEventIds = new Set<string>();
  const selectedEvents: CanonicalEventSummary[] = [];

  // Pass 1: Fair guaranteed quota per artist
  for (const id of artistIds) {
    const list = artistEvents.get(id) ?? [];
    const take = list.slice(0, quotaPerArtist);
    for (const ev of take) {
      if (!selectedEventIds.has(ev.id)) {
        selectedEventIds.add(ev.id);
        selectedEvents.push(ev);
      }
    }
  }

  // Pass 2: Fill remaining budget chronologically from remaining shows
  if (selectedEvents.length < totalBudget) {
    for (const ev of events) {
      if (!selectedEventIds.has(ev.id)) {
        selectedEventIds.add(ev.id);
        selectedEvents.push(ev);
        if (selectedEvents.length >= totalBudget) {
          break;
        }
      }
    }
  }

  // Preserve deterministic chronological ordering
  selectedEvents.sort((a, b) => {
    const dateComp = a.localStartDate.localeCompare(b.localStartDate);
    if (dateComp !== 0) return dateComp;
    return a.id.localeCompare(b.id);
  });

  return selectedEvents;
}

/**
 * Overlays a validated home-location override (lat/lng) onto the stored profile so that every
 * distance-dependent code path (engine distance factor, nearby-mode filter, configured flag)
 * uses the same location. Invalid/non-finite overrides are ignored. When the user has no stored
 * profile row, a minimal default profile carrying only the override is returned.
 */
export function applyLocationOverride(
  profile: UserProfile | null,
  override: PersonalizedDiscoverOptions['locationOverride'],
  userId: string,
): UserProfile | null {
  if (
    !override ||
    !Number.isFinite(override.lat) ||
    !Number.isFinite(override.lng) ||
    Math.abs(override.lat) > 90 ||
    Math.abs(override.lng) > 180
  ) {
    return profile;
  }
  if (profile) {
    return {
      ...profile,
      homeLatApprox: override.lat,
      homeLngApprox: override.lng,
    };
  }
  const now = new Date().toISOString();
  return {
    id: userId,
    homeLatApprox: override.lat,
    homeLngApprox: override.lng,
    defaultRadiusMiles: 25,
    maxSpontaneousPrice: null,
    maxNormalTicketPrice: null,
    maxFavoriteArtistPrice: null,
    travelWillingness: null,
    recommendationPreset: DEFAULT_PRESET,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Scores ONE event for a signed-in user with exactly the same inputs the Discover/home ranking
 * uses: saved profile (radius, budgets, preset, artist weight), explicit artist preferences,
 * Spotify listening (including genre taste) and the chosen home location. Used by the concert
 * detail page so its "why this fits" breakdown never disagrees with the rest of the site.
 * Returns null when scoring is not possible; callers fall back to the unscored event.
 */
export async function scoreEventForUser(options: {
  userId: string;
  event: CanonicalEventSummary;
  locationOverride?: PersonalizedDiscoverOptions['locationOverride'];
  client?: SupabaseClient;
  profileRepo?: IProfileRepository;
  prefRepo?: IUserPreferenceRepository;
  catalogRepo?: ICatalogRepository;
  spotifyRepo?: ISpotifyConnectionRepository;
  spotifyTopArtists?: SpotifyTopArtist[];
}): Promise<ScoredEvent | null> {
  const { userId, event, locationOverride } = options;
  if (!userId) return null;

  const needsClient =
    !options.profileRepo || !options.prefRepo || !options.catalogRepo;
  const client =
    options.client ?? (needsClient ? await createClient() : undefined);
  const profileRepo =
    options.profileRepo ?? new SupabaseProfileRepository(client);
  const prefRepo =
    options.prefRepo ?? new SupabaseUserPreferenceRepository(client!);
  const catalogRepo =
    options.catalogRepo ?? new SupabaseCatalogRepository(client);

  let spotifyRepo = options.spotifyRepo;
  if (!spotifyRepo) {
    try {
      spotifyRepo = new SupabaseSpotifyConnectionRepository(
        createAdminClient(),
      );
    } catch {
      if (client) spotifyRepo = new SupabaseSpotifyConnectionRepository(client);
    }
  }

  const [storedProfile, preferences, connection] = await Promise.all([
    profileRepo.getProfile(userId),
    prefRepo.getPreferences(userId),
    spotifyRepo ? spotifyRepo.getConnection(userId).catch(() => null) : null,
  ]);

  const userProfile = applyLocationOverride(
    storedProfile,
    locationOverride,
    userId,
  );

  let spotifyTopArtists = options.spotifyTopArtists ?? [];
  if (spotifyTopArtists.length === 0 && connection?.status === 'connected') {
    try {
      spotifyTopArtists = await getActiveSpotifyTopArtistsForUser(
        userId,
        'short_term',
        { catalogRepo },
      );
    } catch {
      spotifyTopArtists = [];
    }
  }

  const preset: ScoringPreset =
    userProfile?.recommendationPreset ?? DEFAULT_PRESET;
  const weights = applyArtistWeight(
    getPresetWeights(preset),
    userProfile?.artistWeight,
  );

  const result = rankEvents([event], {
    userProfile,
    artistPreferences: preferences,
    spotifyTopArtists,
    presetOverride: preset,
    weightsOverride: weights,
    locationOverride: locationOverride ?? undefined,
  });
  return (
    [
      ...result.recommendations,
      ...result.exploratory,
      ...result.suppressed,
    ][0] ?? null
  );
}

/**
 * Retrieves personalized Discover recommendations for an authenticated user.
 * Invariants:
 * 1. Scoped strictly to the verified authenticated user ID (never trusts unverified client input).
 * 2. Fetches user profile, explicit artist preferences, and multi-tier candidate events via batch queries.
 * 3. Uses PR #11 pure deterministic scoring engine (rankEvents) with mode-specific weights.
 * 4. Dedicates independent candidate quotas for Favorite, Like, and Interested tiers (anti-starvation).
 * 5. Pushes search, city, and status filters down to database queries.
 * 6. Never falls back to synthetic fixtures on error or empty results.
 */
export async function getPersonalizedDiscoverData(
  options: PersonalizedDiscoverOptions,
): Promise<PersonalizedDiscoverResult> {
  const {
    userId,
    client,
    profileRepo: injectedProfileRepo,
    prefRepo: injectedPrefRepo,
    catalogRepo: injectedCatalogRepo,
    spotifyRepo: injectedSpotifyRepo,
    presetOverride,
    locationOverride,
    mode,
    discoveryMode,
    referenceDate,
    referenceInstant,
    city,
    region,
    searchQuery,
  } = options;

  if (!userId || typeof userId !== 'string') {
    throw new Error('Personalized Discover requires an authenticated user ID.');
  }

  const effectiveClient =
    client ??
    (!injectedProfileRepo || !injectedPrefRepo || !injectedCatalogRepo
      ? await createClient()
      : undefined);

  const profileRepo =
    injectedProfileRepo ?? new SupabaseProfileRepository(effectiveClient);
  const prefRepo =
    injectedPrefRepo ?? new SupabaseUserPreferenceRepository(effectiveClient!);
  const catalogRepo =
    injectedCatalogRepo ?? new SupabaseCatalogRepository(effectiveClient);
  let spotifyRepo = injectedSpotifyRepo;
  if (!spotifyRepo) {
    try {
      const adminClient = createAdminClient();
      spotifyRepo = new SupabaseSpotifyConnectionRepository(adminClient);
    } catch {
      if (effectiveClient) {
        spotifyRepo = new SupabaseSpotifyConnectionRepository(effectiveClient);
      }
    }
  }

  // 1. Fetch user profile, explicit artist preferences, and Spotify connection in parallel
  const [storedProfile, userPreferences, spotifyConnection] = await Promise.all(
    [
      profileRepo.getProfile(userId),
      prefRepo.getPreferences(userId),
      spotifyRepo
        ? spotifyRepo.getConnection(userId).catch(() => null)
        : Promise.resolve(null),
    ],
  );

  // The selected/restored home location (cookie, else saved profile) is the single source of
  // truth for distance scoring, the "nearby" mode filter, and isLocationConfigured.
  const userProfile = applyLocationOverride(
    storedProfile,
    locationOverride,
    userId,
  );

  const isSpotifyConnected = spotifyConnection?.status === 'connected';

  // 1b. Retrieve Spotify top artists if connected (in-memory cached, fail-closed)
  let spotifyTopArtists: SpotifyTopArtist[] = options.spotifyTopArtists ?? [];
  if (spotifyTopArtists.length === 0 && isSpotifyConnected) {
    try {
      spotifyTopArtists = await getActiveSpotifyTopArtistsForUser(
        userId,
        'short_term',
        { catalogRepo },
      );
    } catch {
      spotifyTopArtists = [];
    }
  }

  const hasSpotifyAffinities = spotifyTopArtists.length > 0;

  // 2. Resolve active scoring preset and discovery mode
  let activePreset: ScoringPreset = DEFAULT_PRESET;
  if (presetOverride !== undefined && presetOverride !== null) {
    if (isValidScoringPreset(presetOverride)) {
      activePreset = normalizeScoringPreset(presetOverride);
    } else {
      throw new Error(
        `Invalid recommendation preset: '${String(presetOverride)}'. Valid options are: balanced, artist_first, nearby, value.`,
      );
    }
  } else if (userProfile?.recommendationPreset) {
    activePreset = userProfile.recommendationPreset;
  }

  const activeMode: DiscoveryMode = normalizeDiscoveryMode(
    mode ?? discoveryMode,
  );
  // The user's artist-importance slider only applies when the preset comes from their profile;
  // an explicit presetOverride (previews, tests) keeps the pure preset weights.
  const activeWeights =
    presetOverride !== undefined && presetOverride !== null
      ? getPresetWeights(activePreset)
      : applyArtistWeight(
          getPresetWeights(activePreset),
          userProfile?.artistWeight,
        );
  const modeWeights = getModeScoringWeights(activeMode, activeWeights);

  const hasPreferences = userPreferences.length > 0;
  const isLocationConfigured = Boolean(
    userProfile?.homeLatApprox !== null &&
    userProfile?.homeLatApprox !== undefined &&
    userProfile?.homeLngApprox !== null &&
    userProfile?.homeLngApprox !== undefined,
  );

  // 3. Multi-Tier Anti-Starvation Retrieval Strategy
  // Partition preferences by tier so Favorite artists receive their own dedicated retrieval budget
  const favoritePrefs = userPreferences.filter(
    (p) => p.preferenceLevel === 'favorite',
  );
  const likePrefs = userPreferences.filter((p) => p.preferenceLevel === 'like');
  const interestedPrefs = userPreferences.filter(
    (p) => p.preferenceLevel === 'interested',
  );

  const [favoriteArtistIds, likeArtistIds, interestedArtistIds] =
    await Promise.all([
      resolveArtistIdsForPreferences(favoritePrefs, catalogRepo),
      resolveArtistIdsForPreferences(likePrefs, catalogRepo),
      resolveArtistIdsForPreferences(interestedPrefs, catalogRepo),
    ]);

  // Determine date bounds
  let queryFromDate = calculateCandidateRetrievalLowerBound(
    referenceDate,
    referenceInstant,
  );
  let queryToDate: string | undefined;

  if (activeMode === 'this_weekend') {
    const weekendWindow = calculateWeekendWindow({
      referenceDate,
      referenceInstant,
    });
    // Use the earlier of the conservative lower bound and weekend start date
    if (weekendWindow.startDate < queryFromDate) {
      queryFromDate = weekendWindow.startDate;
    }
    queryToDate = weekendWindow.endDate;
  } else if (activeMode === 'cheap_and_nearby') {
    queryToDate = calculate14DayLookaheadEndDate(
      referenceDate,
      referenceInstant,
      'America/Denver',
    );
  } else if (activeMode === 'worth_planning_for') {
    const refInstantDate = referenceInstant
      ? new Date(referenceInstant)
      : referenceDate
        ? new Date(`${referenceDate}T00:00:00Z`)
        : new Date();
    const advance14Date = new Date(
      refInstantDate.getTime() + 14 * 24 * 60 * 60 * 1000,
    );
    const advance14Str = advance14Date.toISOString().slice(0, 10);
    if (advance14Str > queryFromDate) {
      queryFromDate = advance14Str;
    }
  }

  const commonFilters: EventListFilters = {
    fromDate: queryFromDate,
    toDate: queryToDate,
    city: city || undefined,
    region: region || undefined,
    status: 'scheduled',
    searchQuery: searchQuery?.trim() || undefined,
  };

  const modeOptions = {
    mode: activeMode,
    modeContext: {
      userProfile,
      artistPreferences: userPreferences,
      referenceDate,
      referenceInstant,
      city: city || undefined,
    },
  };

  const candidateQueries: Promise<CanonicalEventSummary[]>[] = [];

  // Tier 1A: Favorite artists with dedicated budget & fair coverage policy (Issue 2)
  // Single bounded retrieval query regardless of whether user has 3, 20, or 100 favorite artists.
  if (favoriteArtistIds.length > 0) {
    candidateQueries.push(
      retrieveCandidatesWithLookback(
        catalogRepo,
        { ...commonFilters, artistIds: favoriteArtistIds },
        FAVORITE_ARTIST_CANDIDATE_LIMIT,
        referenceDate,
        referenceInstant,
        modeOptions,
      ).then((evts) =>
        applyFairArtistAllocation(
          evts,
          favoriteArtistIds,
          FAVORITE_ARTIST_CANDIDATE_LIMIT,
        ),
      ),
    );
  }

  // Tier 1B: Liked artists with dedicated budget
  if (likeArtistIds.length > 0) {
    candidateQueries.push(
      retrieveCandidatesWithLookback(
        catalogRepo,
        { ...commonFilters, artistIds: likeArtistIds },
        LIKE_ARTIST_CANDIDATE_LIMIT,
        referenceDate,
        referenceInstant,
        modeOptions,
      ),
    );
  }

  // Tier 1C: Interested artists with dedicated budget
  if (interestedArtistIds.length > 0) {
    candidateQueries.push(
      retrieveCandidatesWithLookback(
        catalogRepo,
        { ...commonFilters, artistIds: interestedArtistIds },
        INTERESTED_ARTIST_CANDIDATE_LIMIT,
        referenceDate,
        referenceInstant,
        modeOptions,
      ),
    );
  }

  // Tier 1D: Spotify top artists listening affinities
  if (spotifyTopArtists.length > 0) {
    const unmappedSpotifyIds: string[] = [];
    const directCanonicalIds: string[] = [];

    for (const a of spotifyTopArtists) {
      if (a.canonicalArtistId) {
        directCanonicalIds.push(a.canonicalArtistId);
      }
      if (a.id) {
        unmappedSpotifyIds.push(a.id);
      }
    }

    let resolvedFromSpotify = new Map<string, string>();
    if (
      unmappedSpotifyIds.length > 0 &&
      typeof catalogRepo.findArtistIdsByExternalIds === 'function'
    ) {
      resolvedFromSpotify = await catalogRepo.findArtistIdsByExternalIds(
        'spotify',
        unmappedSpotifyIds,
      );
      for (const a of spotifyTopArtists) {
        if (!a.canonicalArtistId && a.id && resolvedFromSpotify.has(a.id)) {
          a.canonicalArtistId = resolvedFromSpotify.get(a.id);
        }
      }
    }

    const allSpotifyCatalogIds = Array.from(
      new Set([
        ...directCanonicalIds,
        ...Array.from(resolvedFromSpotify.values()),
      ]),
    );

    if (allSpotifyCatalogIds.length > 0) {
      candidateQueries.push(
        retrieveCandidatesWithLookback(
          catalogRepo,
          { ...commonFilters, artistIds: allSpotifyCatalogIds },
          LIKE_ARTIST_CANDIDATE_LIMIT,
          referenceDate,
          referenceInstant,
          modeOptions,
        ),
      );
    }
  }

  // Tier 1E: genre-taste retrieval. The user's inferred genres (from their artists/Spotify) pull in
  // shows by artists they have never heard of, so "you like electronic" actually surfaces more
  // electronic shows instead of only the ones that happen to sit in the first general pool.
  const genreTasteProfile = buildGenreTasteProfile({
    artistPreferences: userPreferences,
    spotifyTopArtists,
  });
  const genreTaste = summarizeGenreTaste(genreTasteProfile, 3);
  const genreQueryTerms = Array.from(
    new Set(genreTaste.flatMap((g) => g.rawGenres)),
  ).slice(0, 4);
  for (const rawGenre of genreQueryTerms) {
    candidateQueries.push(
      retrieveCandidatesWithLookback(
        catalogRepo,
        { ...commonFilters, genre: rawGenre },
        GENRE_CANDIDATE_LIMIT,
        referenceDate,
        referenceInstant,
        modeOptions,
      ).catch(() => [] as CanonicalEventSummary[]),
    );
  }

  // Tier 2: General upcoming catalog candidates (discovery pool)
  candidateQueries.push(
    retrieveCandidatesWithLookback(
      catalogRepo,
      commonFilters,
      GENERAL_CATALOG_CANDIDATE_LIMIT,
      referenceDate,
      referenceInstant,
      modeOptions,
    ),
  );

  const queryResults = await Promise.all(candidateQueries);

  // Merge and deduplicate candidates by canonical event ID
  const candidateMap = new Map<string, CanonicalEventSummary>();
  for (const eventList of queryResults) {
    for (const event of eventList) {
      if (!candidateMap.has(event.id)) {
        candidateMap.set(event.id, event);
      }
    }
  }

  const candidateCountBeforeFiltering = candidateMap.size;
  let candidates = Array.from(candidateMap.values());

  // Mode eligibility filtering
  if (activeMode !== 'all') {
    candidates = candidates.filter((ev) =>
      isEventEligibleForMode(ev, activeMode, {
        userProfile,
        artistPreferences: userPreferences,
        referenceDate,
        referenceInstant,
        city: city || undefined,
      }),
    );
  }

  // Additional in-memory search safety check (in case SQL search was broad or memory repo is used)
  if (searchQuery && searchQuery.trim().length > 0) {
    const q = searchQuery.trim().toLowerCase();
    candidates = candidates.filter((event) => {
      if (event.title.toLowerCase().includes(q)) return true;
      if (event.venueName?.toLowerCase().includes(q)) return true;
      if (event.artists?.some((a) => a.name.toLowerCase().includes(q)))
        return true;
      return false;
    });
  }

  if (candidates.length === 0) {
    return {
      recommendations: [],
      exploratory: [],
      suppressed: [],
      ineligibleCount: 0,
      totalCandidateCount: candidateCountBeforeFiltering,
      userProfile,
      activePreset,
      activeWeights: modeWeights,
      activeMode,
      hasPreferences,
      isSpotifyConnected,
      hasSpotifyAffinities,
      isLocationConfigured,
      isEmptyCatalog:
        activeMode === 'all' &&
        candidateCountBeforeFiltering === 0 &&
        !searchQuery &&
        !city,
    };
  }

  // 4. Score and rank candidates using pure deterministic PR #11 engine with mode-specific weights
  const scoringContext: ScoringContext = {
    userProfile: userProfile || {
      id: userId,
      homeLatApprox: null,
      homeLngApprox: null,
      defaultRadiusMiles: 25,
      maxSpontaneousPrice: null,
      maxNormalTicketPrice: null,
      maxFavoriteArtistPrice: null,
      travelWillingness: null,
      recommendationPreset: activePreset,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    artistPreferences: userPreferences,
    spotifyTopArtists,
    genreTasteProfile,
    referenceDate,
    referenceInstant,
    presetOverride: activePreset,
    weightsOverride: modeWeights,
    locationOverride: locationOverride ?? undefined,
  };

  const rankResult: RecommendationResult = rankEvents(
    candidates,
    scoringContext,
  );

  return {
    recommendations: rankResult.recommendations,
    exploratory: rankResult.exploratory,
    suppressed: rankResult.suppressed,
    ineligibleCount: rankResult.ineligibleCount,
    totalCandidateCount: candidateCountBeforeFiltering,
    userProfile,
    activePreset,
    activeWeights: modeWeights,
    activeMode,
    hasPreferences,
    isSpotifyConnected,
    hasSpotifyAffinities,
    isLocationConfigured,
    isEmptyCatalog: false,
    genreTaste,
  };
}

/**
 * Retrieves public catalog events for unauthenticated visitors.
 * Never performs fake personal scoring or claims personal preferences.
 */
export async function getPublicDiscoverData(
  options: PublicDiscoverOptions = {},
): Promise<PublicDiscoverResult> {
  const {
    client,
    catalogRepo: injectedCatalogRepo,
    city,
    region,
    searchQuery,
    mode,
    discoveryMode,
    limit = 50,
    referenceDate,
    referenceInstant,
  } = options;

  const effectiveClient =
    client ?? (!injectedCatalogRepo ? await createClient() : undefined);
  const catalogRepo =
    injectedCatalogRepo ?? new SupabaseCatalogRepository(effectiveClient);

  const activeMode: DiscoveryMode = normalizeDiscoveryMode(
    mode ?? discoveryMode,
  );

  let queryFromDate = calculateCandidateRetrievalLowerBound(
    referenceDate,
    referenceInstant,
  );
  let queryToDate: string | undefined;

  if (activeMode === 'this_weekend') {
    const weekendWindow = calculateWeekendWindow({
      referenceDate,
      referenceInstant,
    });
    if (weekendWindow.startDate < queryFromDate) {
      queryFromDate = weekendWindow.startDate;
    }
    queryToDate = weekendWindow.endDate;
  } else if (activeMode === 'cheap_and_nearby') {
    queryToDate = calculate14DayLookaheadEndDate(
      referenceDate,
      referenceInstant,
      'America/Denver',
    );
  } else if (activeMode === 'worth_planning_for') {
    const refInstantDate = referenceInstant
      ? new Date(referenceInstant)
      : referenceDate
        ? new Date(`${referenceDate}T00:00:00Z`)
        : new Date();
    const advance14Date = new Date(
      refInstantDate.getTime() + 14 * 24 * 60 * 60 * 1000,
    );
    const advance14Str = advance14Date.toISOString().slice(0, 10);
    if (advance14Str > queryFromDate) {
      queryFromDate = advance14Str;
    }
  }

  const modeContext: ModeEligibilityContext = {
    referenceDate,
    referenceInstant,
    city: city || undefined,
  };

  const candidates = await retrieveCandidatesWithLookback(
    catalogRepo,
    {
      fromDate: queryFromDate,
      toDate: queryToDate,
      city: city || undefined,
      region: region || undefined,
      status: 'scheduled',
      searchQuery: searchQuery?.trim() || undefined,
    },
    limit * 2, // scan enough to satisfy mode eligibility filtering
    referenceDate,
    referenceInstant,
    {
      mode: activeMode,
      modeContext,
    },
  );

  // Filter displayable scheduled concerts using timezone-aware timing eligibility and mode filters
  let events = candidates.filter((ev) => {
    if (ev.status !== 'scheduled') {
      return false;
    }
    const eligibility = checkEventEligibility({
      localStartDate: ev.localStartDate,
      startsAt: ev.startsAt,
      timezone: ev.timezone,
      startTimePrecision: ev.startTimePrecision,
      referenceDate,
      referenceInstant,
    });
    return !eligibility.isPast;
  });

  if (activeMode !== 'all') {
    events = events.filter((ev) =>
      isEventEligibleForMode(ev, activeMode, {
        referenceDate,
        referenceInstant,
        city: city || undefined,
      }),
    );
  }

  if (searchQuery && searchQuery.trim().length > 0) {
    const q = searchQuery.trim().toLowerCase();
    events = events.filter((event) => {
      if (event.title.toLowerCase().includes(q)) return true;
      if (event.venueName?.toLowerCase().includes(q)) return true;
      if (event.artists?.some((a) => a.name.toLowerCase().includes(q)))
        return true;
      return false;
    });
  }

  // Return at most the requested number of displayable scheduled events
  const returnedEvents = events.slice(0, limit);
  const candidateCountBeforeSearch = candidates.length;

  return {
    events: returnedEvents,
    isEmptyCatalog:
      activeMode === 'all' &&
      candidateCountBeforeSearch === 0 &&
      !searchQuery &&
      !city,
    totalCount: returnedEvents.length,
    activeMode,
  };
}

export interface PersonalizedFeedOptions extends PersonalizedDiscoverOptions {
  minPrice?: number;
  maxPrice?: number;
  freeOnly?: boolean;
  sortBy?: EventSortOption;
  limit?: number;
  offset?: number;
  includeSuppressed?: boolean;
  includeExploratory?: boolean;
}

/**
 * Produces a personalized, ranked feed of scored events suitable for the Index UI.
 * Integrates factor breakdowns (artist, distance, price), user explanations,
 * price/free filtering, and flexible sorting.
 */
export async function getPersonalizedFeed(
  options: PersonalizedFeedOptions,
): Promise<ScoredEvent[]> {
  const result = await getPersonalizedDiscoverData(options);

  let feed: ScoredEvent[] = [...result.recommendations];
  if (options.includeExploratory !== false) {
    feed.push(...result.exploratory);
  }
  if (options.includeSuppressed) {
    feed.push(...result.suppressed);
  }

  // Price & free filtering
  if (options.freeOnly) {
    feed = feed.filter(
      (se) => se.event.eventKind === 'free_event' || se.event.minPrice === 0,
    );
  }
  if (options.minPrice !== undefined) {
    feed = feed.filter(
      (se) =>
        se.event.minPrice !== null &&
        se.event.minPrice !== undefined &&
        se.event.minPrice >= options.minPrice!,
    );
  }
  if (options.maxPrice !== undefined) {
    feed = feed.filter(
      (se) =>
        se.event.minPrice !== null &&
        se.event.minPrice !== undefined &&
        se.event.minPrice <= options.maxPrice!,
    );
  }

  // Sorting
  const sortBy = options.sortBy ?? 'score_desc';
  if (sortBy === 'price_asc') {
    feed.sort((a, b) => {
      const priceA = a.event.minPrice ?? Infinity;
      const priceB = b.event.minPrice ?? Infinity;
      if (priceA !== priceB) return priceA - priceB;
      return compareScoredEvents(a, b);
    });
  } else if (sortBy === 'date_asc') {
    feed.sort((a, b) => {
      const dateComp = a.event.localStartDate.localeCompare(
        b.event.localStartDate,
      );
      if (dateComp !== 0) return dateComp;
      return compareScoredEvents(a, b);
    });
  } else {
    // 'score_desc' (default)
    feed.sort(compareFeedOrder);
  }

  // Paging
  if (options.offset !== undefined && options.offset > 0) {
    feed = feed.slice(options.offset);
  }
  if (options.limit !== undefined && options.limit > 0) {
    feed = feed.slice(0, options.limit);
  }

  return feed;
}

/**
 * Service object encapsulating ranking, scoring, discovery, and feed generation.
 */
export const RecommendationService = {
  rankEvents,
  scoreEvent,
  getPersonalizedFeed,
  getPersonalizedDiscoverData,
  getPublicDiscoverData,
};
