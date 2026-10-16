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
  SpotifyAuthenticationError,
  SpotifyForbiddenError,
  SpotifyRateLimitError,
  VALID_SPOTIFY_TIME_RANGES,
} from '@/lib/domain/spotify';
import {
  getSyntheticTopArtists,
  isSyntheticPreviewAllowed,
} from '@/lib/sources/spotify/synthetic-preview';

export interface PreferenceActionResult {
  success?: boolean;
  error?: string;
  preference?: UserArtistPreference;
}

export async function savePreferenceAction(input: {
  artistId?: string | null;
  artistName: string;
  preferenceLevel: PreferenceLevel;
  spotifyArtistId?: string | null;
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
      spotifyArtistId: input.spotifyArtistId?.trim() || null,
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
    const adminClient = createAdminClient();
    const repo = new SupabaseSpotifyConnectionRepository(adminClient);
    await repo.deleteConnection(user.id);

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

  // 1. Explicit synthetic preview mode
  if (preview) {
    if (!isSyntheticPreviewAllowed()) {
      return {
        artists: [],
        isSyntheticPreview: false,
        error:
          'Spotify synthetic preview mode is only available in development and testing environments.',
      };
    }

    return {
      artists: getSyntheticTopArtists(timeRange),
      isSyntheticPreview: true,
    };
  }

  // 2. Live Spotify data path
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
        artists: [],
        isSyntheticPreview: false,
        error: 'Spotify integration is not configured in this environment.',
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
        artists: [],
        isSyntheticPreview: false,
        error:
          'No active Spotify connection found. Please connect your account.',
      };
    }

    // Enforce long-term reauthorization deadline
    if (tokens.reauthorizationDeadline.getTime() <= Date.now()) {
      await repo.updateStatus(user.id, 'expired');
      return {
        artists: [],
        isSyntheticPreview: false,
        error:
          'Spotify authorization has expired. Please reconnect your account.',
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
      } catch (refreshErr) {
        if (refreshErr instanceof SpotifyAuthenticationError) {
          await repo.updateStatus(user.id, 'expired');
          return {
            artists: [],
            isSyntheticPreview: false,
            error:
              'Spotify authorization expired or revoked. Please reconnect.',
          };
        }
        if (refreshErr instanceof SpotifyRateLimitError) {
          return {
            artists: [],
            isSyntheticPreview: false,
            error: refreshErr.message,
          };
        }
        return {
          artists: [],
          isSyntheticPreview: false,
          error:
            'Spotify service temporarily unavailable. Please try again shortly.',
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

    let errorMsg = 'Failed to fetch Spotify top artists.';
    if (err instanceof SpotifyAuthenticationError) {
      errorMsg = 'Spotify session expired. Please reconnect.';
    } else if (err instanceof SpotifyForbiddenError) {
      errorMsg =
        'Spotify Developer Mode requires allowlisted beta user accounts.';
    } else if (err instanceof SpotifyRateLimitError) {
      errorMsg = err.message;
    }

    return {
      artists: [],
      isSyntheticPreview: false,
      error: errorMsg,
    };
  }
}
