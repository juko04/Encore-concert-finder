import React from 'react';
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
import type { UserArtistPreference } from '@/lib/domain/user-preference';
import { SparklesIcon, AlertCircleIcon } from '@/components/index/icons';

export const dynamic = 'force-dynamic';

interface PreferencesPageProps {
  searchParams?: Promise<{
    spotify_connected?: string;
    spotify_error?: string;
  }>;
}

export default async function PreferencesPage({
  searchParams,
}: PreferencesPageProps) {
  const user = await getAuthenticatedUser();
  const resolvedSearchParams = searchParams ? await searchParams : {};

  let preferences: UserArtistPreference[] = [];
  let loadError: string | null = null;
  const spotifyStatus: InitialSpotifyStatus = {
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
      console.error('[PreferencesPage load error]:', err);
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
        spotifyStatus.connected = conn.status === 'connected';
        spotifyStatus.spotifyAccountId = conn.spotifyAccountId;
        spotifyStatus.status = conn.status;
        spotifyStatus.lastSyncedAt = conn.lastSyncedAt;
      }
    } catch (err) {
      console.warn('[PreferencesPage spotifyStatus check failed]:', err);
    }
  }

  return (
    <div className="min-h-screen bg-[#fafaf9] text-zinc-900">
      <Header isAuthenticated={Boolean(user)} userEmail={user?.email} />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="space-y-8 pb-16">
          {/* Page Header */}
          <div className="border-b border-zinc-200/80 pb-6">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
              <SparklesIcon className="h-3.5 w-3.5" />
              <span>Taste Profile & Spotify Sync</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900">
              Music Taste Profile
            </h1>
            <p className="mt-1 max-w-2xl text-xs text-zinc-500 sm:text-sm">
              Explicit artist taste strictly overrides algorithms. Connect
              Spotify to automatically sync your listening affinity, or manually
              add your favorite and disliked artists.
            </p>
          </div>

          {/* Engineering Invariant 11 Box */}
          <div className="shadow-xs rounded-2xl border border-zinc-200 bg-white p-5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-700">
              <AlertCircleIcon className="h-4 w-4 text-indigo-600" />
              <span>
                Engineering Invariant 11: Explicit Preference Precedence
              </span>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-3 text-xs text-zinc-600 sm:grid-cols-3">
              <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-3">
                <span className="font-semibold text-zinc-900">
                  1. Disliked Headliner
                </span>
                <p className="mt-0.5 text-zinc-500">
                  Always suppresses the concert entirely from your primary
                  recommendations.
                </p>
              </div>
              <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-3">
                <span className="font-semibold text-zinc-900">
                  2. Disliked Support Act
                </span>
                <p className="mt-0.5 text-zinc-500">
                  Generally suppresses the show, unless the headliner is marked
                  as an explicit Favorite.
                </p>
              </div>
              <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-3">
                <span className="font-semibold text-zinc-900">
                  3. Favorite Headliner Override
                </span>
                <p className="mt-0.5 text-zinc-500">
                  An explicit Favorite headliner overrides disliked support
                  acts; the concert scores 100% and is never suppressed.
                </p>
              </div>
            </div>
          </div>

          {loadError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-700">
              {loadError}
            </div>
          )}

          {/* Authenticated Manager or Guest Prompt */}
          {user ? (
            <TasteProfileManager
              initialPreferences={preferences}
              userEmail={user.email}
              initialSpotifyStatus={spotifyStatus}
              spotifyBanner={spotifyBanner}
            />
          ) : (
            <GuestTastePrompt />
          )}
        </div>
      </main>
    </div>
  );
}
