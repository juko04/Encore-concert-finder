'use server';

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';
import {
  type PreferenceLevel,
  type UserArtistPreference,
  VALID_PREFERENCE_LEVELS,
} from '@/lib/domain/user-preference';

export interface PreferenceActionResult {
  success?: boolean;
  error?: string;
  preference?: UserArtistPreference;
}

export async function savePreferenceAction(input: {
  artistId?: string | null;
  artistName: string;
  preferenceLevel: PreferenceLevel;
}): Promise<PreferenceActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { error: 'You must be signed in to manage preferences.' };
  }

  const artistName = input.artistName?.trim();
  if (!artistName || artistName.length > 150) {
    return { error: 'Artist name must be between 1 and 150 characters.' };
  }

  if (!VALID_PREFERENCE_LEVELS.includes(input.preferenceLevel)) {
    return { error: `Invalid preference level: ${input.preferenceLevel}` };
  }

  try {
    const supabase = await createClient();
    const repo = new SupabaseUserPreferenceRepository(supabase);

    const preference = await repo.savePreference({
      userId: user.id,
      artistId: input.artistId || null,
      artistName,
      preferenceLevel: input.preferenceLevel,
    });

    revalidatePath('/profile/taste');
    return { success: true, preference };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to save preference.';
    return { error: message };
  }
}

export async function deletePreferenceAction(
  preferenceId: string,
): Promise<PreferenceActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { error: 'You must be signed in to manage preferences.' };
  }

  if (!preferenceId || typeof preferenceId !== 'string') {
    return { error: 'Invalid preference ID.' };
  }

  try {
    const supabase = await createClient();
    const repo = new SupabaseUserPreferenceRepository(supabase);

    const deleted = await repo.deletePreference(user.id, preferenceId);
    if (!deleted) {
      return { error: 'Preference not found or could not be removed.' };
    }

    revalidatePath('/profile/taste');
    return { success: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to delete preference.';
    return { error: message };
  }
}
