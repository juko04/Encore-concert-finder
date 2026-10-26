import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { UserProfile } from '@/lib/domain/profile';
import { rankEvents } from '@/lib/recommendation/engine';
import {
  DEFAULT_PRESET,
  getPresetWeights,
  isValidScoringPreset,
  normalizeScoringPreset,
} from '@/lib/recommendation/presets';
import type {
  RecommendationResult,
  ScoredEvent,
  ScoringContext,
  ScoringPreset,
  ScoringWeights,
} from '@/lib/recommendation/types';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import type {
  ICatalogRepository,
  IProfileRepository,
  IUserPreferenceRepository,
} from '@/lib/repositories/interfaces';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';

export interface PersonalizedDiscoverOptions {
  userId: string;
  client?: SupabaseClient;
  profileRepo?: IProfileRepository;
  prefRepo?: IUserPreferenceRepository;
  catalogRepo?: ICatalogRepository;
  presetOverride?: unknown;
  referenceDate?: string;
  referenceInstant?: string;
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
  hasPreferences: boolean;
  isLocationConfigured: boolean;
  isEmptyCatalog: boolean;
}

export interface PublicDiscoverOptions {
  client?: SupabaseClient;
  catalogRepo?: ICatalogRepository;
  city?: string;
  region?: string;
  searchQuery?: string;
  limit?: number;
}

export interface PublicDiscoverResult {
  events: CanonicalEventSummary[];
  isEmptyCatalog: boolean;
  totalCount: number;
}

/**
 * Bounds for production candidate event retrieval:
 * Tier 1: Up to 100 upcoming events specifically featuring user-preferred artists (Favorite, Like, Interested).
 * Tier 2: Up to 150 general upcoming events in the catalog.
 * This guarantees favorite-artist events are not systematically truncated by an arbitrary first-page limit,
 * while preventing unbounded full-database reads and avoiding N+1 queries.
 */
export const PREFERRED_ARTIST_CANDIDATE_LIMIT = 100;
export const GENERAL_CATALOG_CANDIDATE_LIMIT = 150;

/**
 * Retrieves personalized Discover recommendations for an authenticated user.
 * Invariants:
 * 1. Scoped strictly to the verified authenticated user ID (never trusts unverified client input).
 * 2. Fetches user profile, explicit artist preferences, and two-tier candidate events via batch queries.
 * 3. Uses PR #11 pure deterministic scoring engine (rankEvents) — zero client formula duplication.
 * 4. Never falls back to synthetic fixtures on error or empty results.
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
    presetOverride,
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

  // 1. Fetch user profile and explicit artist preferences in parallel
  const [userProfile, userPreferences] = await Promise.all([
    profileRepo.getProfile(userId),
    prefRepo.getPreferences(userId),
  ]);

  // 2. Resolve active scoring preset
  let activePreset: ScoringPreset = DEFAULT_PRESET;
  if (presetOverride !== undefined && presetOverride !== null) {
    if (isValidScoringPreset(presetOverride)) {
      activePreset = normalizeScoringPreset(presetOverride);
    }
  } else if (userProfile?.recommendationPreset) {
    activePreset = userProfile.recommendationPreset;
  }

  const activeWeights = getPresetWeights(activePreset);
  const hasPreferences = userPreferences.length > 0;
  const isLocationConfigured = Boolean(
    userProfile?.homeLatApprox !== null &&
    userProfile?.homeLatApprox !== undefined &&
    userProfile?.homeLngApprox !== null &&
    userProfile?.homeLngApprox !== undefined,
  );

  // 3. Two-Tier Candidate Retrieval Strategy
  // Determine preferred artist IDs (Favorite, Like, Interested) to ensure favorite shows are never missed
  const preferredArtistIds = userPreferences
    .filter(
      (p) =>
        p.preferenceLevel === 'favorite' ||
        p.preferenceLevel === 'like' ||
        p.preferenceLevel === 'interested',
    )
    .map((p) => p.artistId)
    .filter((id): id is string => Boolean(id));

  const todayIso = referenceDate || new Date().toISOString().split('T')[0];

  const candidateQueries: Promise<CanonicalEventSummary[]>[] = [];

  // Tier 1: Targeted candidate query for user's preferred artists
  if (preferredArtistIds.length > 0) {
    candidateQueries.push(
      catalogRepo.listEvents({
        artistIds: preferredArtistIds,
        fromDate: todayIso,
        limit: PREFERRED_ARTIST_CANDIDATE_LIMIT,
        city: city || undefined,
        region: region || undefined,
      }),
    );
  }

  // Tier 2: General upcoming catalog candidates (discovery pool)
  candidateQueries.push(
    catalogRepo.listEvents({
      fromDate: todayIso,
      limit: GENERAL_CATALOG_CANDIDATE_LIMIT,
      city: city || undefined,
      region: region || undefined,
    }),
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

  let candidates = Array.from(candidateMap.values());

  // Optional text search filter (artist name or event title)
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
      totalCandidateCount: 0,
      userProfile,
      activePreset,
      activeWeights,
      hasPreferences,
      isLocationConfigured,
      isEmptyCatalog: true,
    };
  }

  // 4. Score and rank candidates using pure deterministic PR #11 engine
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
    referenceDate,
    referenceInstant,
    presetOverride: activePreset,
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
    totalCandidateCount: candidates.length,
    userProfile,
    activePreset,
    activeWeights,
    hasPreferences,
    isLocationConfigured,
    isEmptyCatalog: false,
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
    limit = 50,
  } = options;

  const catalogRepo =
    injectedCatalogRepo ?? new SupabaseCatalogRepository(client);
  const todayIso = new Date().toISOString().split('T')[0];

  let events = await catalogRepo.listEvents({
    fromDate: todayIso,
    limit,
    city: city || undefined,
    region: region || undefined,
  });

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

  return {
    events,
    isEmptyCatalog: events.length === 0,
    totalCount: events.length,
  };
}
