'use server';

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';
import {
  InvalidCatalogArtistError,
  type PreferenceLevel,
  type UserArtistPreference,
  VALID_PREFERENCE_LEVELS,
} from '@/lib/domain/user-preference';
import { createAdminClient } from '@/lib/supabase/admin';
import { getServerEnv } from '@/lib/env/server';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { SpotifyApiClient } from '@/lib/sources/spotify/client';
import {
  type SpotifyConnectionStatus,
  type SpotifyTimeRange,
  type SpotifyTopArtist,
  VALID_SPOTIFY_TIME_RANGES,
} from '@/lib/domain/spotify';
import { getSyntheticTopArtists } from '@/lib/sources/spotify/synthetic-preview';

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
    console.error('[savePreferenceAction error]:', err);
    if (err instanceof InvalidCatalogArtistError) {
      return { error: err.message };
    }
    return {
      error: 'Unable to save artist preference. Please try again.',
    };
  }
}

export async function updatePreferenceLevelAction(input: {
  preferenceId: string;
  preferenceLevel: PreferenceLevel;
}): Promise<PreferenceActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { error: 'You must be signed in to manage preferences.' };
  }

  if (!input.preferenceId || typeof input.preferenceId !== 'string') {
    return { error: 'Invalid preference ID.' };
  }

  if (!VALID_PREFERENCE_LEVELS.includes(input.preferenceLevel)) {
    return { error: `Invalid preference level: ${input.preferenceLevel}` };
  }

  try {
    const supabase = await createClient();
    const repo = new SupabaseUserPreferenceRepository(supabase);

    const preference = await repo.updatePreferenceLevel(
      user.id,
      input.preferenceId,
      input.preferenceLevel,
    );

    revalidatePath('/profile/taste');
    return { success: true, preference };
  } catch (err) {
    console.error('[updatePreferenceLevelAction error]:', err);
    return {
      error: 'Unable to update preference level. Please try again.',
    };
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
    console.error('[deletePreferenceAction error]:', err);
    return { error: 'Unable to delete preference. Please try again.' };
  }
}

export interface SpotifyStatusResult {
  connected: boolean;
  spotifyAccountId?: string;
  status?: SpotifyConnectionStatus;
  lastSyncedAt?: string | null;
  isConfigured: boolean;
}

export async function getSpotifyStatusAction(): Promise<SpotifyStatusResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { connected: false, isConfigured: false };
  }

  try {
    const serverEnv = getServerEnv();
    const isConfigured = Boolean(
      serverEnv.ENABLE_SPOTIFY_INTEGRATION &&
      serverEnv.SPOTIFY_CLIENT_ID &&
      serverEnv.SPOTIFY_CLIENT_SECRET &&
      serverEnv.SPOTIFY_REDIRECT_URI &&
      serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY,
    );

    if (!serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY) {
      return { connected: false, isConfigured };
    }

    const adminClient = createAdminClient();
    const repo = new SupabaseSpotifyConnectionRepository(
      adminClient,
      serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY,
    );

    const connection = await repo.getConnection(user.id);
    if (!connection) {
      return { connected: false, isConfigured };
    }

    return {
      connected: connection.status === 'connected',
      spotifyAccountId: connection.spotifyAccountId,
      status: connection.status,
      lastSyncedAt: connection.lastSyncedAt,
      isConfigured,
    };
  } catch (err) {
    console.warn('[getSpotifyStatusAction error]:', err);
    return { connected: false, isConfigured: false };
  }
}

export async function disconnectSpotifyAction(): Promise<{
  success: boolean;
  error?: string;
}> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    const serverEnv = getServerEnv();
    if (serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY) {
      const adminClient = createAdminClient();
      const repo = new SupabaseSpotifyConnectionRepository(
        adminClient,
        serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY,
      );
      await repo.deleteConnection(user.id);
    }

    revalidatePath('/profile/taste');
    return { success: true };
  } catch (err) {
    console.error('[disconnectSpotifyAction error]:', err);
    return { success: false, error: 'Failed to disconnect Spotify account.' };
  }
}

export interface SpotifyTopArtistsActionResult {
  artists: SpotifyTopArtist[];
  isSyntheticPreview: boolean;
  error?: string;
}

export async function getSpotifyTopArtistsAction(
  timeRange: SpotifyTimeRange = 'short_term',
  preview = false,
): Promise<SpotifyTopArtistsActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      artists: [],
      isSyntheticPreview: false,
      error: 'You must be signed in to view music taste.',
    };
  }

  if (!VALID_SPOTIFY_TIME_RANGES.includes(timeRange)) {
    return {
      artists: [],
      isSyntheticPreview: false,
      error: 'Invalid time range specified.',
    };
  }

  if (preview) {
    return {
      artists: getSyntheticTopArtists(timeRange),
      isSyntheticPreview: true,
    };
  }

  try {
    let serverEnv;
    try {
      serverEnv = getServerEnv();
    } catch {
      serverEnv = null;
    }

    if (
      !serverEnv ||
      !serverEnv.ENABLE_SPOTIFY_INTEGRATION ||
      !serverEnv.SPOTIFY_CLIENT_ID ||
      !serverEnv.SPOTIFY_CLIENT_SECRET ||
      !serverEnv.SPOTIFY_REDIRECT_URI ||
      !serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY
    ) {
      return {
        artists: getSyntheticTopArtists(timeRange),
        isSyntheticPreview: true,
      };
    }

    const adminClient = createAdminClient();
    const repo = new SupabaseSpotifyConnectionRepository(
      adminClient,
      serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY,
    );

    const tokens = await repo.getConnectionTokens(user.id);
    if (!tokens) {
      return {
        artists: getSyntheticTopArtists(timeRange),
        isSyntheticPreview: true,
      };
    }

    const spotifyClient = new SpotifyApiClient({
      clientId: serverEnv.SPOTIFY_CLIENT_ID,
      clientSecret: serverEnv.SPOTIFY_CLIENT_SECRET,
      redirectUri: serverEnv.SPOTIFY_REDIRECT_URI,
    });

    let currentAccessToken = tokens.accessToken;
    if (tokens.tokenExpiresAt.getTime() <= Date.now() + 60 * 1000) {
      try {
        const refreshed = await spotifyClient.refreshAccessToken(
          tokens.refreshToken,
        );
        currentAccessToken = refreshed.accessToken;
        await repo.updateTokens(user.id, {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          tokenExpiresAt: refreshed.tokenExpiresAt,
        });
      } catch {
        await repo.updateStatus(user.id, 'expired');
        return {
          artists: [],
          isSyntheticPreview: false,
          error: 'Spotify authorization expired. Please reconnect.',
        };
      }
    }

    const artists = await spotifyClient.getTopArtists(
      currentAccessToken,
      timeRange,
    );
    await repo.recordSync(user.id);

    return {
      artists,
      isSyntheticPreview: false,
    };
  } catch (err) {
    console.error('[getSpotifyTopArtistsAction error]:', err);
    return {
      artists: getSyntheticTopArtists(timeRange),
      isSyntheticPreview: true,
      error: 'Unable to fetch live Spotify taste. Showing preview mode.',
    };
  }
}
