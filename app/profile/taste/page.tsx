import React from 'react';
import Link from 'next/link';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getServerEnv } from '@/lib/env/server';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { GuestTastePrompt } from '@/components/taste/GuestTastePrompt';
import {
  TasteProfileManager,
  type InitialSpotifyStatus,
} from '@/components/taste/TasteProfileManager';
import { Header } from '@/components/index/Header';
import { signOutAction } from '@/app/login/actions';
import type { UserArtistPreference } from '@/lib/domain/user-preference';

export const revalidate = 0; // Dynamic server rendering for user-scoped data

interface TasteProfilePageProps {
  searchParams?: Promise<{
    spotify_connected?: string;
    spotify_error?: string;
  }>;
}

export default async function TasteProfilePage({
  searchParams,
}: TasteProfilePageProps) {
  const user = await getAuthenticatedUser();
  const resolvedSearchParams = searchParams ? await searchParams : {};

  let preferences: UserArtistPreference[] = [];
  let loadError: string | null = null;
  let spotifyStatus: InitialSpotifyStatus = {
    connected: false,
    isConfigured: false,
  };

  let spotifyBanner: { type: 'success' | 'error'; message: string } | null =
    null;

  if (resolvedSearchParams.spotify_connected === 'true') {
    spotifyBanner = {
      type: 'success',
      message:
        'Spotify account successfully connected! Inspect your top artists below to add them to your live concert profile.',
    };
  } else if (resolvedSearchParams.spotify_error) {
    const err = resolvedSearchParams.spotify_error;
    let message = `Spotify connection failed (${err}).`;
    if (err === 'account_conflict') {
      message =
        'This Spotify account is already linked to another Encore account. Please disconnect it first or connect a different Spotify account.';
    } else if (err === 'developer_mode_restricted') {
      message =
        'Access to the Spotify application is restricted to allowlisted beta users in Development Mode. You can test using the Interactive Preview.';
    } else if (err === 'invalid_state') {
      message =
        'Spotify connection failed: invalid state parameter. Please try connecting again.';
    } else if (err === 'not_configured') {
      message =
        'Spotify integration is not configured or disabled in this environment. Use the Interactive Preview below.';
    } else if (err === 'access_denied') {
      message = 'Spotify connection cancelled or permissions denied.';
    } else if (err === 'session_mismatch') {
      message =
        'Spotify connection failed: the logged-in user changed during authorization. Please restart the connection flow.';
    }

    spotifyBanner = { type: 'error', message };
  }

  if (user) {
    try {
      const supabase = await createClient();
      const repo = new SupabaseUserPreferenceRepository(supabase);
      preferences = await repo.getPreferences(user.id);
    } catch (err) {
      console.error('[TasteProfilePage load error]:', err);
      loadError =
        'Unable to load your music preferences right now. Please try refreshing the page.';
    }

    try {
      const serverEnv = getServerEnv();
      spotifyStatus.isConfigured = Boolean(
        serverEnv.ENABLE_SPOTIFY_INTEGRATION &&
        serverEnv.SPOTIFY_CLIENT_ID &&
        serverEnv.SPOTIFY_CLIENT_SECRET &&
        serverEnv.SPOTIFY_REDIRECT_URI &&
        serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY,
      );

      const adminSupabase = createAdminClient();
      const spotifyRepo = new SupabaseSpotifyConnectionRepository(
        adminSupabase,
        serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY,
      );
      const conn = await spotifyRepo.getConnection(user.id);
      if (conn) {
        spotifyStatus = {
          connected: conn.status === 'connected',
          spotifyAccountId: conn.spotifyAccountId,
          status: conn.status,
          lastSyncedAt: conn.lastSyncedAt,
          isConfigured: spotifyStatus.isConfigured,
        };
      }
    } catch (err) {
      console.warn('[TasteProfilePage spotify status warning]:', err);
    }
  }

  return (
    <div className="min-h-screen bg-[#fafaf9] text-zinc-900">
      <Header isAuthenticated={Boolean(user)} userEmail={user?.email} />
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
              Music Taste Profile
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Your live music preferences teach Encore how to rank and score
              upcoming concerts.{' '}
              <Link
                href="/preferences"
                data-testid="taste-preferences-link"
                className="font-semibold text-indigo-600 hover:text-indigo-500"
              >
                Set your radius, budget and ranking style →
              </Link>
            </p>
          </div>

          {user ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-zinc-500">{user.email}</span>
              <Link
                href="/login/reset-password"
                data-testid="change-password-link"
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-300 hover:text-zinc-900"
              >
                Change Password
              </Link>
              <form action={signOutAction}>
                <button
                  type="submit"
                  data-testid="sign-out-btn"
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-300 hover:text-zinc-900"
                >
                  Sign Out
                </button>
              </form>
            </div>
          ) : (
            <Link
              href="/login?redirectTo=/profile/taste"
              data-testid="header-signin-link"
              className="rounded-lg bg-zinc-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-zinc-800"
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
              className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center sm:p-12"
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 text-xl font-bold text-red-700 ring-1 ring-red-200">
                ⚠
              </div>
              <h2 className="mt-4 text-lg font-bold text-zinc-900">
                Unable to Load Music Preferences
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-zinc-600">
                {loadError}
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <Link
                  href="/profile/taste"
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-zinc-800"
                >
                  Reload Page
                </Link>
                <Link
                  href="/"
                  className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-600 hover:text-zinc-900"
                >
                  Go to Discover
                </Link>
              </div>
            </div>
          ) : (
            <TasteProfileManager
              initialPreferences={preferences}
              userEmail={user.email}
              initialSpotifyStatus={spotifyStatus}
              spotifyBanner={spotifyBanner}
            />
          )
        ) : (
          <GuestTastePrompt />
        )}
      </main>
    </div>
  );
}
