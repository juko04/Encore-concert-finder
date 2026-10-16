import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { getServerEnv } from '@/lib/env/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { SpotifyApiClient } from '@/lib/sources/spotify/client';
import {
  type SpotifyTimeRange,
  SpotifyAuthenticationError,
  SpotifyForbiddenError,
  SpotifyRateLimitError,
  VALID_SPOTIFY_TIME_RANGES,
} from '@/lib/domain/spotify';
import {
  getSyntheticTopArtists,
  isSyntheticPreviewAllowed,
} from '@/lib/sources/spotify/synthetic-preview';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawRange = url.searchParams.get('time_range') || 'short_term';
  const preview = url.searchParams.get('preview') === 'true';

  if (!VALID_SPOTIFY_TIME_RANGES.includes(rawRange as SpotifyTimeRange)) {
    return NextResponse.json(
      {
        error: `Invalid time_range. Must be one of: ${VALID_SPOTIFY_TIME_RANGES.join(', ')}`,
      },
      { status: 400 },
    );
  }
  const timeRange = rawRange as SpotifyTimeRange;

  // 1. Explicit synthetic preview mode
  if (preview) {
    if (!isSyntheticPreviewAllowed()) {
      return NextResponse.json(
        {
          error: 'preview_disabled_in_production',
          message:
            'Spotify synthetic preview mode is only available in development and testing environments.',
        },
        { status: 403 },
      );
    }

    const artists = getSyntheticTopArtists(timeRange);
    return NextResponse.json({
      artists,
      isSyntheticPreview: true,
      timeRange,
    });
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
      return NextResponse.json(
        {
          error: 'spotify_not_configured',
          message: 'Spotify integration is not configured in this environment.',
        },
        { status: 503 },
      );
    }

    const adminClient = createAdminClient();
    const repo = new SupabaseSpotifyConnectionRepository(
      adminClient,
      serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY,
    );

    const tokens = await repo.getConnectionTokens(user.id);
    if (!tokens) {
      return NextResponse.json(
        {
          error: 'not_connected',
          message:
            'No active Spotify connection found. Please connect your account.',
        },
        { status: 404 },
      );
    }

    // Enforce long-term reauthorization deadline before attempting use or refresh
    if (tokens.reauthorizationDeadline.getTime() <= Date.now()) {
      await repo.updateStatus(user.id, 'expired');
      return NextResponse.json(
        {
          error: 'reauthorization_required',
          message:
            'Spotify authorization has expired. Please reconnect your account.',
        },
        { status: 401 },
      );
    }

    const spotifyClient = new SpotifyApiClient({
      clientId: serverEnv.SPOTIFY_CLIENT_ID,
      clientSecret: serverEnv.SPOTIFY_CLIENT_SECRET,
      redirectUri: serverEnv.SPOTIFY_REDIRECT_URI,
    });

    let currentAccessToken = tokens.accessToken;

    // Check if access token expired (or expiring in next 60 seconds)
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
        console.warn('[Spotify Token Refresh Error]:', refreshErr);
        await repo.updateStatus(user.id, 'expired');
        return NextResponse.json(
          {
            error: 'reauthorization_required',
            message:
              'Spotify authorization expired or revoked. Please reconnect.',
          },
          { status: 401 },
        );
      }
    }

    const artists = await spotifyClient.getTopArtists(
      currentAccessToken,
      timeRange,
    );
    await repo.recordSync(user.id);

    return NextResponse.json({
      artists,
      isSyntheticPreview: false,
      timeRange,
    });
  } catch (err) {
    console.error('[Spotify Top Artists API Error]:', err);

    if (err instanceof SpotifyAuthenticationError) {
      return NextResponse.json(
        {
          error: 'reauthorization_required',
          message: 'Spotify session expired. Please reconnect.',
        },
        { status: 401 },
      );
    }

    if (err instanceof SpotifyForbiddenError) {
      return NextResponse.json(
        {
          error: 'developer_mode_restricted',
          message:
            'Spotify Developer Mode requires allowlisted beta user accounts.',
        },
        { status: 403 },
      );
    }

    if (err instanceof SpotifyRateLimitError) {
      return NextResponse.json(
        {
          error: 'rate_limited',
          message: err.message,
          retryAfterSeconds: err.retryAfterSeconds,
        },
        { status: 429 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch Spotify top artists' },
      { status: 500 },
    );
  }
}
