import React from 'react';
import Link from 'next/link';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { getHomeLocation } from '@/lib/location/server';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import { DEFAULT_PRESET } from '@/lib/recommendation/presets';
import { Header } from '@/components/index/Header';
import {
  PreferencesForm,
  type InitialPreferences,
} from '@/components/preferences/PreferencesForm';
import { SlidersIcon } from '@/components/index/icons';

export const dynamic = 'force-dynamic';

const DEFAULTS: InitialPreferences = {
  defaultRadiusMiles: 25,
  maxNormalTicketPrice: null,
  maxFavoriteArtistPrice: null,
  maxSpontaneousPrice: null,
  recommendationPreset: DEFAULT_PRESET,
  artistWeight: null,
};

/**
 * Preferences: how Encore ranks and filters shows for you (location, radius, ticket budget,
 * ranking emphasis). Your artists and Spotify listening live on the separate Taste Profile page.
 */
export default async function PreferencesPage() {
  const user = await getAuthenticatedUser();

  let initial = DEFAULTS;
  let homeLabel: string | null = null;
  let loadError: string | null = null;

  if (user) {
    try {
      const profile = await new SupabaseProfileRepository().getProfile(user.id);
      if (profile) {
        initial = {
          defaultRadiusMiles: profile.defaultRadiusMiles,
          maxNormalTicketPrice: profile.maxNormalTicketPrice,
          maxFavoriteArtistPrice: profile.maxFavoriteArtistPrice,
          maxSpontaneousPrice: profile.maxSpontaneousPrice,
          recommendationPreset: profile.recommendationPreset,
          artistWeight: profile.artistWeight ?? null,
        };
      }
    } catch (err) {
      console.error('[PreferencesPage] profile load failed:', err);
      loadError =
        'Unable to load your saved preferences right now. Showing defaults; saving will still work.';
    }
    homeLabel = (await getHomeLocation(user.id))?.label ?? null;
  }

  return (
    <div className="min-h-screen bg-[#fafaf9] text-zinc-900">
      <Header isAuthenticated={Boolean(user)} userEmail={user?.email} />
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="space-y-6 pb-16">
          <div className="border-b border-zinc-200/80 pb-6">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-700">
              <SlidersIcon className="h-3.5 w-3.5" />
              <span>Preferences</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900">
              Preferences
            </h1>
            <p className="mt-1 max-w-2xl text-xs text-zinc-500 sm:text-sm">
              Set where you are, how far you will travel, what you will pay, and
              what matters most when Encore ranks shows for you.
            </p>
            <Link
              href="/profile/taste"
              data-testid="preferences-taste-link"
              className="mt-3 inline-block text-xs font-semibold text-indigo-600 hover:text-indigo-500"
            >
              Looking for your artists and Spotify? Open your Taste Profile →
            </Link>
          </div>

          {loadError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-700">
              {loadError}
            </div>
          )}

          {user ? (
            <>
              <div className="shadow-xs flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-5 py-3 text-xs text-zinc-600">
                <span>
                  Signed in as{' '}
                  <strong className="text-zinc-900">{user.email}</strong>
                </span>
                <Link
                  href="/login/reset-password"
                  data-testid="preferences-change-password-link"
                  className="font-medium text-indigo-600 hover:text-indigo-500"
                >
                  Change Password →
                </Link>
              </div>
              <PreferencesForm initial={initial} homeLabel={homeLabel} />
            </>
          ) : (
            <div
              data-testid="preferences-guest-prompt"
              className="shadow-xs rounded-2xl border border-zinc-200 bg-white p-8 text-center"
            >
              <h2 className="text-lg font-bold text-zinc-900">
                Sign in to set your preferences
              </h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
                Your radius, budget and ranking style are saved to your account
                so every page ranks shows the way you like.
              </p>
              <Link
                href="/login"
                className="mt-4 inline-flex rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                Sign in
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
