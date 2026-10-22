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
import { DEFAULT_PRESET } from '@/lib/recommendation/presets';
import type {
  RecommendationResult,
  ScoringContext,
  ScoringPreset,
} from '@/lib/recommendation/types';
import type { UserProfile } from '@/lib/domain/profile';

export interface ScoringPreviewResponse {
  result: RecommendationResult;
  isGuest: boolean;
  userProfile: UserProfile | null;
  activePreset: ScoringPreset;
  usingFixtures: boolean;
  error?: string;
}

export async function getScoringPreviewAction(options?: {
  preset?: ScoringPreset;
  useFixtures?: boolean;
}): Promise<ScoringPreviewResponse> {
  const useFixtures = options?.useFixtures ?? false;
  const requestedPreset = options?.preset;

  let supabase;
  let user = null;
  try {
    supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    user = authUser;
  } catch {
    // Database or auth client unavailable (e.g. offline build)
    user = null;
  }

  // 1. If using fixtures or if guest without real data, provide seeded inspection state
  if (useFixtures || !user || !supabase) {
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
      isGuest: !user,
      userProfile: context.userProfile ?? null,
      activePreset,
      usingFixtures: true,
    };
  }

  // 2. Authenticated user with live database
  try {
    const activeClient = supabase;
    const profileRepo = new SupabaseProfileRepository(activeClient);
    const prefRepo = new SupabaseUserPreferenceRepository(activeClient);
    const catalogRepo = new SupabaseCatalogRepository(activeClient);

    const [userProfile, artistPreferences, events] = await Promise.all([
      profileRepo.getProfile(user.id),
      prefRepo.getPreferences(user.id),
      catalogRepo.listEvents({ limit: 50 }),
    ]);

    const activePreset =
      requestedPreset || userProfile?.recommendationPreset || DEFAULT_PRESET;

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

    // If catalog has no events yet, fallback gracefully to fixtures for inspection
    const eventPool = events.length > 0 ? events : FIXTURE_EVENTS;
    const isUsingFixtures = events.length === 0;

    const result = rankEvents(eventPool, context);

    return {
      result,
      isGuest: false,
      userProfile: context.userProfile ?? null,
      activePreset,
      usingFixtures: isUsingFixtures,
    };
  } catch (err) {
    // On unexpected error, return fallback fixtures with error indication
    const activePreset = requestedPreset || DEFAULT_PRESET;
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
      error: err instanceof Error ? err.message : 'Failed to score live events',
    };
  }
}

export async function updateRecommendationPresetAction(
  preset: ScoringPreset,
): Promise<{ success: boolean; preset: ScoringPreset; error?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, preset, error: 'Authentication required' };
    }

    const profileRepo = new SupabaseProfileRepository(supabase);
    await profileRepo.updatePreset(user.id, preset);

    return { success: true, preset };
  } catch (err) {
    return {
      success: false,
      preset,
      error: err instanceof Error ? err.message : 'Failed to save preset',
    };
  }
}
