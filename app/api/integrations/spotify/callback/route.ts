import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { getServerEnv } from '@/lib/env/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { SpotifyApiClient } from '@/lib/sources/spotify/client';
import {
  SpotifyAccountConflictError,
  SpotifyForbiddenError,
} from '@/lib/domain/spotify';
import {
  SPOTIFY_OAUTH_STATE_COOKIE,
  SPOTIFY_OAUTH_VERIFIER_COOKIE,
} from '@/lib/sources/spotify/oauth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const spotifyError = url.searchParams.get('error');

  const user = await getAuthenticatedUser();
  if (!user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirectTo', '/profile/taste');
    return NextResponse.redirect(loginUrl);
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get(SPOTIFY_OAUTH_STATE_COOKIE)?.value;
  const codeVerifier = cookieStore.get(SPOTIFY_OAUTH_VERIFIER_COOKIE)?.value;

  // Clear OAuth handshake cookies regardless of outcome
  cookieStore.delete(SPOTIFY_OAUTH_STATE_COOKIE);
  cookieStore.delete(SPOTIFY_OAUTH_VERIFIER_COOKIE);

  if (spotifyError) {
    console.warn(
      '[Spotify Callback] User or Spotify returned error:',
      spotifyError,
    );
    return NextResponse.redirect(
      new URL(
        `/profile/taste?spotify_error=${encodeURIComponent(spotifyError)}`,
        request.url,
      ),
    );
  }

  if (!state || !savedState || state !== savedState) {
    console.warn('[Spotify Callback] State mismatch or missing state');
    return NextResponse.redirect(
      new URL('/profile/taste?spotify_error=invalid_state', request.url),
    );
  }

  if (!code || !codeVerifier) {
    console.warn('[Spotify Callback] Missing authorization code or verifier');
    return NextResponse.redirect(
      new URL('/profile/taste?spotify_error=missing_code', request.url),
    );
  }

  try {
    const serverEnv = getServerEnv();
    if (
      !serverEnv.SPOTIFY_CLIENT_ID ||
      !serverEnv.SPOTIFY_CLIENT_SECRET ||
      !serverEnv.SPOTIFY_REDIRECT_URI ||
      !serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY
    ) {
      throw new Error('Spotify server environment is not configured.');
    }

    const spotifyClient = new SpotifyApiClient({
      clientId: serverEnv.SPOTIFY_CLIENT_ID,
      clientSecret: serverEnv.SPOTIFY_CLIENT_SECRET,
      redirectUri: serverEnv.SPOTIFY_REDIRECT_URI,
    });

    const tokenResult = await spotifyClient.exchangeAuthorizationCode(
      code,
      codeVerifier,
    );

    const userProfile = await spotifyClient.getCurrentUser(
      tokenResult.accessToken,
    );

    // Save with admin client (service_role) to satisfy zero-client RLS policy
    const adminClient = createAdminClient();
    const repo = new SupabaseSpotifyConnectionRepository(
      adminClient,
      serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY,
    );

    await repo.saveConnection({
      userId: user.id,
      spotifyAccountId: userProfile.accountId,
      accessToken: tokenResult.accessToken,
      refreshToken: tokenResult.refreshToken,
      tokenExpiresAt: tokenResult.tokenExpiresAt,
      reauthorizationDeadline: tokenResult.reauthorizationDeadline,
      scopes: tokenResult.scopes,
    });

    return NextResponse.redirect(
      new URL('/profile/taste?spotify_connected=true', request.url),
    );
  } catch (err) {
    console.error('[Spotify Callback Error]:', err);

    if (err instanceof SpotifyAccountConflictError) {
      return NextResponse.redirect(
        new URL('/profile/taste?spotify_error=account_conflict', request.url),
      );
    }

    if (err instanceof SpotifyForbiddenError) {
      return NextResponse.redirect(
        new URL(
          '/profile/taste?spotify_error=developer_mode_restricted',
          request.url,
        ),
      );
    }

    return NextResponse.redirect(
      new URL('/profile/taste?spotify_error=exchange_failed', request.url),
    );
  }
}
