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
  SPOTIFY_OAUTH_BINDING_COOKIE,
  SPOTIFY_OAUTH_STATE_COOKIE,
  SPOTIFY_OAUTH_VERIFIER_COOKIE,
  verifyOAuthHandshakeToken,
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
  const bindingCookie = cookieStore.get(SPOTIFY_OAUTH_BINDING_COOKIE)?.value;

  // Clear OAuth handshake cookies regardless of outcome to prevent replay
  cookieStore.delete(SPOTIFY_OAUTH_BINDING_COOKIE);
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

  let serverEnv;
  try {
    serverEnv = getServerEnv();
  } catch (err) {
    console.warn('[Spotify Callback] Server env configuration error:', err);
    return NextResponse.redirect(
      new URL('/profile/taste?spotify_error=not_configured', request.url),
    );
  }

  if (
    !serverEnv.SPOTIFY_CLIENT_ID ||
    !serverEnv.SPOTIFY_CLIENT_SECRET ||
    !serverEnv.SPOTIFY_REDIRECT_URI ||
    !serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY
  ) {
    return NextResponse.redirect(
      new URL('/profile/taste?spotify_error=not_configured', request.url),
    );
  }

  // 1. Verify encrypted handshake binding exists and is valid
  if (!bindingCookie) {
    console.warn('[Spotify Callback] Missing OAuth handshake binding cookie');
    return NextResponse.redirect(
      new URL('/profile/taste?spotify_error=invalid_state', request.url),
    );
  }

  const binding = verifyOAuthHandshakeToken(
    bindingCookie,
    serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY,
  );

  if (!binding) {
    console.warn(
      '[Spotify Callback] Expired, invalid, or tampered OAuth handshake binding',
    );
    return NextResponse.redirect(
      new URL('/profile/taste?spotify_error=invalid_state', request.url),
    );
  }

  // 2. Validate state matches
  if (!state || state !== binding.state) {
    console.warn('[Spotify Callback] State mismatch');
    return NextResponse.redirect(
      new URL('/profile/taste?spotify_error=invalid_state', request.url),
    );
  }

  // 3. Validate the initiating user ID against the current verified session
  if (binding.userId !== user.id) {
    console.warn(
      `[Spotify Callback] User session mismatch: initiated by ${binding.userId}, callback by ${user.id}`,
    );
    return NextResponse.redirect(
      new URL('/profile/taste?spotify_error=session_mismatch', request.url),
    );
  }

  const codeVerifier = binding.codeVerifier;
  if (!code || !codeVerifier) {
    console.warn('[Spotify Callback] Missing authorization code or verifier');
    return NextResponse.redirect(
      new URL('/profile/taste?spotify_error=missing_code', request.url),
    );
  }

  try {
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
