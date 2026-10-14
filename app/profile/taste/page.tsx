import React from 'react';
import Link from 'next/link';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';
import { GuestTastePrompt } from '@/components/taste/GuestTastePrompt';
import { TasteProfileManager } from '@/components/taste/TasteProfileManager';
import { signOutAction } from '@/app/login/actions';
import type { UserArtistPreference } from '@/lib/domain/user-preference';

export const revalidate = 0; // Dynamic server rendering for user-scoped data

export default async function TasteProfilePage() {
  const user = await getAuthenticatedUser();

  let preferences: UserArtistPreference[] = [];
  let loadError: string | null = null;

  if (user) {
    try {
      const supabase = await createClient();
      const repo = new SupabaseUserPreferenceRepository(supabase);
      preferences = await repo.getPreferences(user.id);
    } catch (err) {
      loadError =
        err instanceof Error
          ? err.message
          : 'Unable to load your music preferences right now.';
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Link
                href="/discover"
                className="text-xs font-medium text-zinc-400 hover:text-zinc-200"
              >
                ← Back to Discover
              </Link>
              <span className="text-zinc-600">·</span>
              <Link
                href="/"
                className="text-xs font-medium text-zinc-400 hover:text-zinc-200"
              >
                Home
              </Link>
            </div>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Music Taste Profile
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Your live music preferences teach Encore how to rank and score
              upcoming concerts.
            </p>
          </div>

          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-400">{user.email}</span>
              <form action={signOutAction}>
                <button
                  type="submit"
                  data-testid="sign-out-btn"
                  className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:text-white"
                >
                  Sign Out
                </button>
              </form>
            </div>
          ) : (
            <Link
              href="/login?redirectTo=/profile/taste"
              data-testid="header-signin-link"
              className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow hover:bg-indigo-500"
            >
              Sign In
            </Link>
          )}
        </header>

        {user ? (
          loadError ? (
            <div
              data-testid="profile-load-error"
              role="alert"
              className="rounded-2xl border border-red-800/80 bg-red-950/40 p-8 text-center backdrop-blur sm:p-12"
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-red-900/50 text-xl font-bold text-red-200 ring-1 ring-red-700/50">
                ⚠
              </div>
              <h2 className="mt-4 text-lg font-bold text-white">
                Unable to Load Music Preferences
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
                We encountered an error loading your taste profile from the
                database: {loadError}. Please try refreshing the page.
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <Link
                  href="/profile/taste"
                  className="rounded-lg bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-700 hover:text-white"
                >
                  Reload Page
                </Link>
                <Link
                  href="/discover"
                  className="rounded-lg border border-zinc-700 bg-transparent px-4 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200"
                >
                  Go to Discover
                </Link>
              </div>
            </div>
          ) : (
            <TasteProfileManager
              initialPreferences={preferences}
              userEmail={user.email}
            />
          )
        ) : (
          <GuestTastePrompt />
        )}
      </div>
    </main>
  );
}
