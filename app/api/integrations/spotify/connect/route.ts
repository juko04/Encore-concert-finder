import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { getServerEnv } from '@/lib/env/server';
import {
  buildSpotifyAuthorizeUrl,
  computeCodeChallenge,
  generateCodeVerifier,
  generateOAuthState,
  getOAuthCookieOptions,
  SPOTIFY_OAUTH_STATE_COOKIE,
  SPOTIFY_OAUTH_VERIFIER_COOKIE,
} from '@/lib/sources/spotify/oauth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirectTo', '/profile/taste');
    return NextResponse.redirect(loginUrl);
  }

  let serverEnv;
  try {
    serverEnv = getServerEnv();
  } catch (err) {
    console.warn('[Spotify Connect] Server env configuration error:', err);
    return NextResponse.redirect(
      new URL('/profile/taste?spotify_error=not_configured', request.url),
    );
  }

  if (
    !serverEnv.ENABLE_SPOTIFY_INTEGRATION ||
    !serverEnv.SPOTIFY_CLIENT_ID ||
    !serverEnv.SPOTIFY_CLIENT_SECRET ||
    !serverEnv.SPOTIFY_REDIRECT_URI ||
    !serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY
  ) {
    return NextResponse.redirect(
      new URL('/profile/taste?spotify_error=not_configured', request.url),
    );
  }

  const state = generateOAuthState();
  const verifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(verifier);

  const authUrl = buildSpotifyAuthorizeUrl({
    clientId: serverEnv.SPOTIFY_CLIENT_ID,
    redirectUri: serverEnv.SPOTIFY_REDIRECT_URI,
    state,
    codeChallenge,
    scopes: ['user-top-read'],
  });

  const cookieStore = await cookies();
  const cookieOptions = getOAuthCookieOptions(serverEnv.SPOTIFY_REDIRECT_URI);

  cookieStore.set(SPOTIFY_OAUTH_STATE_COOKIE, state, cookieOptions);
  cookieStore.set(SPOTIFY_OAUTH_VERIFIER_COOKIE, verifier, cookieOptions);

  return NextResponse.redirect(authUrl);
}
