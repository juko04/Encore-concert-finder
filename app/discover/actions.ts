'use server';

/**
 * Server Actions for Production Discover Experience
 * Provides authenticated mutations for user scoring presets, travel radius,
 * and ticket budget thresholds, along with server-side candidate retrieval.
 *
 * Invariants:
 * 1. Cryptographically verifies authenticated user via JWT (getAuthenticatedUser).
 * 2. Never accepts client-supplied user IDs.
 * 3. Never falls back to synthetic fixtures on error.
 * 4. Preserves maxFavoriteArtistPrice and maxSpontaneousPrice unchanged when updating maxNormalTicketPrice.
 * 5. Uses strictly validated preset identifiers ('artist_first', not 'artist').
 */

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUser } from '@/lib/auth/session';
import {
  isValidScoringPreset,
  normalizeScoringPreset,
} from '@/lib/recommendation/presets';
import {
  getPersonalizedDiscoverData,
  getPublicDiscoverData,
  type PersonalizedDiscoverResult,
  type PublicDiscoverResult,
} from '@/lib/recommendation/service';
import type { ScoringPreset } from '@/lib/recommendation/types';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';

export interface ActionResponse<T = unknown> {
  success?: boolean;
  error?: string;
  data?: T;
}

/**
 * Updates the user's persisted recommendation scoring preset.
 * Supported presets: 'balanced', 'artist_first', 'nearby', 'value'.
 */
export async function updateRecommendationPresetAction(
  preset: unknown,
): Promise<ActionResponse<{ preset: ScoringPreset }>> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      error: 'You must be signed in to change recommendation settings.',
    };
  }

  if (!isValidScoringPreset(preset)) {
    return {
      error: `Invalid recommendation preset: '${String(preset)}'. Valid options are: balanced, artist_first, nearby, value.`,
    };
  }

  const normalizedPreset = normalizeScoringPreset(preset);

  try {
    const profileRepo = new SupabaseProfileRepository();
    await profileRepo.upsertProfile(user.id, {
      recommendationPreset: normalizedPreset,
    });

    revalidatePath('/discover');
    return { success: true, data: { preset: normalizedPreset } };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown database error';
    return {
      error: `Failed to update recommendation preset: ${message}`,
    };
  }
}

/**
 * Updates the user's persisted default travel radius in miles.
 * Must be an integer between 5 and 500 miles.
 */
export async function updateTravelRadiusAction(
  radiusMiles: unknown,
): Promise<ActionResponse<{ radiusMiles: number }>> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      error: 'You must be signed in to change recommendation settings.',
    };
  }

  const num =
    typeof radiusMiles === 'string' ? Number(radiusMiles) : radiusMiles;

  if (
    typeof num !== 'number' ||
    isNaN(num) ||
    !Number.isInteger(num) ||
    num < 5 ||
    num > 500
  ) {
    return {
      error: 'Travel radius must be an integer between 5 and 500 miles.',
    };
  }

  try {
    const profileRepo = new SupabaseProfileRepository();
    await profileRepo.upsertProfile(user.id, {
      defaultRadiusMiles: num,
    });

    revalidatePath('/discover');
    return { success: true, data: { radiusMiles: num } };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown database error';
    return {
      error: `Failed to update travel radius: ${message}`,
    };
  }
}

/**
 * Updates the user's persisted typical ticket budget (maxNormalTicketPrice).
 * Accepts null to clear the budget filter, or a positive number up to $1,000.
 * Invariant: Preserves maxFavoriteArtistPrice and maxSpontaneousPrice untouched.
 */
export async function updateTypicalBudgetAction(
  budget: unknown,
): Promise<ActionResponse<{ maxNormalTicketPrice: number | null }>> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      error: 'You must be signed in to change recommendation settings.',
    };
  }

  let sanitizedBudget: number | null = null;

  if (budget !== null && budget !== undefined && budget !== '') {
    const num = typeof budget === 'string' ? Number(budget) : budget;
    if (typeof num !== 'number' || isNaN(num) || num <= 0 || num > 1000) {
      return {
        error:
          'Typical budget must be a positive number up to $1,000, or null to clear.',
      };
    }
    sanitizedBudget = Math.round(num * 100) / 100;
  }

  try {
    const profileRepo = new SupabaseProfileRepository();
    await profileRepo.upsertProfile(user.id, {
      maxNormalTicketPrice: sanitizedBudget,
    });

    revalidatePath('/discover');
    return { success: true, data: { maxNormalTicketPrice: sanitizedBudget } };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown database error';
    return {
      error: `Failed to update typical budget: ${message}`,
    };
  }
}

/**
 * Retrieves personalized recommendations for the authenticated user,
 * with optional transient filter overrides (preset, city, search).
 */
export async function getPersonalizedRecommendationsAction(filters?: {
  preset?: unknown;
  city?: string;
  region?: string;
  search?: string;
}): Promise<ActionResponse<PersonalizedDiscoverResult>> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      error: 'You must be signed in to view personalized recommendations.',
    };
  }

  try {
    const data = await getPersonalizedDiscoverData({
      userId: user.id,
      presetOverride: filters?.preset,
      city: filters?.city,
      region: filters?.region,
      searchQuery: filters?.search,
    });

    return { success: true, data };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown recommendation error';
    return {
      error: `Failed to load recommendations: ${message}`,
    };
  }
}

/**
 * Retrieves public event listings for unauthenticated visitors.
 */
export async function getPublicDiscoverAction(filters?: {
  city?: string;
  region?: string;
  search?: string;
}): Promise<ActionResponse<PublicDiscoverResult>> {
  try {
    const data = await getPublicDiscoverData({
      city: filters?.city,
      region: filters?.region,
      searchQuery: filters?.search,
    });

    return { success: true, data };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown catalog error';
    return {
      error: `Failed to load public events: ${message}`,
    };
  }
}
