'use server';

/**
 * Server Actions for Recommendation Scoring Preview
 * Development-only inspection endpoint allowing developers and the product owner
 * to test deterministic scoring, inspect factor calculations, and toggle presets.
 */

import { createClient } from '@/lib/supabase/server';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';
import {
  FIXTURE_ARTIST_PREFERENCES,
  FIXTURE_EVENTS,
  FIXTURE_REFERENCE_DATE,
  FIXTURE_USER_PROFILE,
} from '@/tests/fixtures/recommendation-fixtures';
import { rankEvents } from '@/lib/recommendation/engine';
import {
  DEFAULT_PRESET,
  PRESET_WEIGHTS,
  isValidScoringPreset,
  normalizeScoringPreset,
} from '@/lib/recommendation/presets';
import { isScoringPreviewAllowed } from '@/lib/recommendation/preview-guard';
import type {
  RecommendationResult,
  ScoringContext,
  ScoringPreset,
} from '@/lib/recommendation/types';
import type { UserProfile } from '@/lib/domain/profile';

export type RecommendationDataSource =
  'canonical_catalog' | 'synthetic_fixtures';

export interface ScoringPreviewResponse {
  result: RecommendationResult;
  isGuest: boolean;
  userProfile: UserProfile | null;
  activePreset: ScoringPreset;
  usingFixtures: boolean;
  dataSource: RecommendationDataSource;
  isSyntheticDemo: boolean;
  isEmptyCatalog: boolean;
  error?: string;
}

const EMPTY_RESULT: RecommendationResult = {
  recommendations: [],
  exploratory: [],
  suppressed: [],
  ineligibleCount: 0,
  totalScored: 0,
  preset: DEFAULT_PRESET,
  weights: PRESET_WEIGHTS[DEFAULT_PRESET],
};

export async function getScoringPreviewAction(options?: {
  preset?: unknown;
  useFixtures?: boolean;
}): Promise<ScoringPreviewResponse> {
  // 1. Enforce strict server-side environment guard
  if (!isScoringPreviewAllowed()) {
    return {
      result: EMPTY_RESULT,
      isGuest: true,
      userProfile: null,
      activePreset: DEFAULT_PRESET,
      usingFixtures: false,
      dataSource: 'canonical_catalog',
      isSyntheticDemo: false,
      isEmptyCatalog: false,
      error:
        'Recommendation scoring inspector is disabled in this environment.',
    };
  }

  // 2. Validate requested preset if provided
  let requestedPreset: ScoringPreset | undefined;
  if (options?.preset !== undefined && options?.preset !== null) {
    if (!isValidScoringPreset(options.preset)) {
      return {
        result: EMPTY_RESULT,
        isGuest: true,
        userProfile: null,
        activePreset: DEFAULT_PRESET,
        usingFixtures: false,
        dataSource: 'canonical_catalog',
        isSyntheticDemo: false,
        isEmptyCatalog: false,
        error: `Invalid recommendation preset: '${String(options.preset)}'. Valid options are: balanced, artist_first, nearby, value.`,
      };
    }
    requestedPreset = normalizeScoringPreset(options.preset);
  }

  const useFixtures = options?.useFixtures ?? false;

  // 3. Explicit fixture preview requested
  // Returns labeled synthetic demo data for approved development/testing preview without requiring live database
  if (useFixtures) {
    let isGuest = true;
    try {
      const authClient = await createClient();
      const {
        data: { user: authUser },
      } = await authClient.auth.getUser();
      if (authUser) {
        isGuest = false;
      }
    } catch {
      // In isolated tests or environments without cookie context, default to guest
      isGuest = true;
    }

    const activePreset =
      requestedPreset || FIXTURE_USER_PROFILE.recommendationPreset;
    const context: ScoringContext = {
      userProfile: {
        ...FIXTURE_USER_PROFILE,
        recommendationPreset: activePreset,
      },
      artistPreferences: FIXTURE_ARTIST_PREFERENCES,
      referenceDate: FIXTURE_REFERENCE_DATE,
      presetOverride: activePreset,
    };

    const result = rankEvents(FIXTURE_EVENTS, context);

    return {
      result,
      isGuest,
      userProfile: context.userProfile ?? null,
      activePreset,
      usingFixtures: true,
      dataSource: 'synthetic_fixtures',
      isSyntheticDemo: true,
      isEmptyCatalog: false,
    };
  }

  // 4. Initialize Supabase client for live preview with fail-closed error handling
  // Never fallback to fixtures on infrastructure error
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    console.error('[ScoringPreviewAction Supabase Client Init Error]:', err);
    const activePreset = requestedPreset || DEFAULT_PRESET;
    return {
      result: {
        ...EMPTY_RESULT,
        preset: activePreset,
        weights: PRESET_WEIGHTS[activePreset],
      },
      isGuest: true,
      userProfile: null,
      activePreset,
      usingFixtures: false,
      dataSource: 'canonical_catalog',
      isSyntheticDemo: false,
      isEmptyCatalog: false,
      error:
        'Authentication client initialization failed. Live scoring preview is unavailable.',
    };
  }

  // 5. Verify user session with explicit discrimination between genuine guest and auth service failure
  let user = null;
  try {
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      const isNormalNoSession =
        authError.name === 'AuthSessionMissingError' ||
        authError.message?.toLowerCase().includes('auth session missing') ||
        (authError.status === 400 &&
          authError.message?.toLowerCase().includes('session'));

      if (!isNormalNoSession) {
        console.error('[ScoringPreviewAction Auth Session Error]:', authError);
        const activePreset = requestedPreset || DEFAULT_PRESET;
        return {
          result: {
            ...EMPTY_RESULT,
            preset: activePreset,
            weights: PRESET_WEIGHTS[activePreset],
          },
          isGuest: true,
          userProfile: null,
          activePreset,
          usingFixtures: false,
          dataSource: 'canonical_catalog',
          isSyntheticDemo: false,
          isEmptyCatalog: false,
          error:
            'Authentication session verification failed. Please try signing in again.',
        };
      }
      user = null;
    } else {
      user = authUser;
    }
  } catch (err) {
    console.error('[ScoringPreviewAction Thrown Auth Error]:', err);
    const activePreset = requestedPreset || DEFAULT_PRESET;
    return {
      result: {
        ...EMPTY_RESULT,
        preset: activePreset,
        weights: PRESET_WEIGHTS[activePreset],
      },
      isGuest: true,
      userProfile: null,
      activePreset,
      usingFixtures: false,
      dataSource: 'canonical_catalog',
      isSyntheticDemo: false,
      isEmptyCatalog: false,
      error: 'Authentication service request failed. Unable to verify session.',
    };
  }

  // 6. Genuine unauthenticated guest demo mode
  // Note: Guest demo mode is clearly labeled with isSyntheticDemo: true and dataSource: 'synthetic_fixtures'
  if (!user) {
    const activePreset =
      requestedPreset || FIXTURE_USER_PROFILE.recommendationPreset;
    const context: ScoringContext = {
      userProfile: {
        ...FIXTURE_USER_PROFILE,
        recommendationPreset: activePreset,
      },
      artistPreferences: FIXTURE_ARTIST_PREFERENCES,
      referenceDate: FIXTURE_REFERENCE_DATE,
      presetOverride: activePreset,
    };

    const result = rankEvents(FIXTURE_EVENTS, context);

    return {
      result,
      isGuest: true,
      userProfile: context.userProfile ?? null,
      activePreset,
      usingFixtures: true,
      dataSource: 'synthetic_fixtures',
      isSyntheticDemo: true,
      isEmptyCatalog: false,
    };
  }

  // 7. Authenticated user with live canonical database
  try {
    const activeClient = supabase;
    const profileRepo = new SupabaseProfileRepository(activeClient);
    const prefRepo = new SupabaseUserPreferenceRepository(activeClient);
    const catalogRepo = new SupabaseCatalogRepository(activeClient);

    const [userProfile, artistPreferences, events] = await Promise.all([
      profileRepo.getProfile(user.id),
      prefRepo.getPreferences(user.id),
      catalogRepo.listEvents({ limit: 100 }),
    ]);

    const activePreset =
      requestedPreset || userProfile?.recommendationPreset || DEFAULT_PRESET;

    // Distinguish genuine empty catalog result: DO NOT silently substitute fixtures!
    if (events.length === 0) {
      return {
        result: {
          ...EMPTY_RESULT,
          preset: activePreset,
          weights: PRESET_WEIGHTS[activePreset],
        },
        isGuest: false,
        userProfile: userProfile ?? null,
        activePreset,
        usingFixtures: false,
        dataSource: 'canonical_catalog',
        isSyntheticDemo: false,
        isEmptyCatalog: true,
      };
    }

    const context: ScoringContext = {
      userProfile: userProfile || {
        id: user.id,
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
      artistPreferences,
      presetOverride: activePreset,
    };

    const result = rankEvents(events, context);

    return {
      result,
      isGuest: false,
      userProfile: context.userProfile ?? null,
      activePreset,
      usingFixtures: false,
      dataSource: 'canonical_catalog',
      isSyntheticDemo: false,
      isEmptyCatalog: false,
    };
  } catch (err) {
    // On unexpected database error: Return clean failure without leaking secrets or substituting fake data
    console.error('[ScoringPreviewAction Error]:', err);
    const activePreset = requestedPreset || DEFAULT_PRESET;

    return {
      result: {
        ...EMPTY_RESULT,
        preset: activePreset,
        weights: PRESET_WEIGHTS[activePreset],
      },
      isGuest: false,
      userProfile: null,
      activePreset,
      usingFixtures: false,
      dataSource: 'canonical_catalog',
      isSyntheticDemo: false,
      isEmptyCatalog: false,
      error:
        'Unable to load live catalog events from the database. Please verify your connection or inspect representative fixtures above.',
    };
  }
}

export async function updateRecommendationPresetAction(
  preset: unknown,
): Promise<{ success: boolean; preset: ScoringPreset; error?: string }> {
  // 1. Enforce environment policy
  if (!isScoringPreviewAllowed()) {
    return {
      success: false,
      preset: DEFAULT_PRESET,
      error: 'Scoring inspector is disabled in this environment.',
    };
  }

  // 2. Strict server-side preset validation
  if (!isValidScoringPreset(preset)) {
    return {
      success: false,
      preset: DEFAULT_PRESET,
      error: `Invalid recommendation preset: '${String(preset)}'.`,
    };
  }

  const validPreset = normalizeScoringPreset(preset);

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        success: false,
        preset: validPreset,
        error: 'Authentication required',
      };
    }

    const profileRepo = new SupabaseProfileRepository(supabase);
    await profileRepo.updatePreset(user.id, validPreset);

    return { success: true, preset: validPreset };
  } catch (err) {
    console.error('[UpdatePresetAction Error]:', err);
    return {
      success: false,
      preset: validPreset,
      error: 'Failed to persist preset update to your profile.',
    };
  }
}
