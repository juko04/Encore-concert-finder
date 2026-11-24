'use server';

/**
 * Server action for the Preferences page.
 * Invariants: the user always comes from the verified session (never from client input), every
 * field is validated server-side, and only the profile owner's row is written (RLS also enforces it).
 */

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import {
  parsePreferencesInput,
  type PreferencesInput,
} from '@/lib/preferences/validate';

export type SavePreferencesResult =
  { ok: true; saved: PreferencesInput } | { ok: false; error: string };

export async function savePreferencesAction(
  input: unknown,
): Promise<SavePreferencesResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: 'You must be signed in to save preferences.' };
  }

  const parsed = parsePreferencesInput(input);
  if (!parsed.ok) return parsed;

  try {
    await new SupabaseProfileRepository().upsertProfile(user.id, {
      defaultRadiusMiles: parsed.value.defaultRadiusMiles,
      maxNormalTicketPrice: parsed.value.maxNormalTicketPrice,
      maxFavoriteArtistPrice: parsed.value.maxFavoriteArtistPrice,
      maxSpontaneousPrice: parsed.value.maxSpontaneousPrice,
      recommendationPreset: parsed.value.recommendationPreset,
      artistWeight: parsed.value.artistWeight,
    });
  } catch (err) {
    console.error('[savePreferencesAction] profile save failed:', err);
    return {
      ok: false,
      error: 'Unable to save your preferences right now. Please try again.',
    };
  }

  // Preferences feed home rows, Search, and Discover.
  revalidatePath('/', 'layout');
  return { ok: true, saved: parsed.value };
}
