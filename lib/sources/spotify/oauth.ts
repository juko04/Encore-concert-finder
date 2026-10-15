import crypto from 'node:crypto';

/**
 * Phase 2, PR #10 Spotify OAuth 2.0 PKCE Helpers
 * Implements RFC 7636 Authorization Code Flow with Proof Key for Code Exchange (PKCE).
 */

export const SPOTIFY_OAUTH_STATE_COOKIE = 'encore_spotify_oauth_state';
export const SPOTIFY_OAUTH_VERIFIER_COOKIE = 'encore_spotify_oauth_verifier';

export const SPOTIFY_AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';

export const DEFAULT_SPOTIFY_SCOPES = ['user-top-read'];

/**
 * Generates a cryptographically random RFC 7636 code verifier.
 * Using 32 random bytes encoded as base64url yields 43 URL-safe characters.
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Computes the S256 code challenge for an RFC 7636 code verifier.
 * challenge = base64url(sha256(verifier))
 */
export function computeCodeChallenge(verifier: string): string {
  if (!verifier || typeof verifier !== 'string') {
    throw new Error('Code verifier must be a non-empty string.');
  }
  return crypto
    .createHash('sha256')
    .update(verifier, 'utf8')
    .digest('base64url');
}

/**
 * Generates a cryptographically random state parameter for CSRF mitigation.
 */
export function generateOAuthState(): string {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Determines whether cookies should have the Secure flag set.
 * In production or over HTTPS, Secure must be true.
 * For local HTTP development (e.g. 127.0.0.1:3000), Secure is false to avoid cookie drop.
 */
export function shouldUseSecureCookies(
  redirectUri: string,
  nodeEnv = process.env.NODE_ENV,
): boolean {
  try {
    const parsed = new URL(redirectUri);
    // Explicit HTTPS always uses secure cookies
    if (parsed.protocol === 'https:') {
      return true;
    }
    // Local loopback HTTP (127.0.0.1, localhost) in non-production allows non-secure cookies
    if (
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
      nodeEnv !== 'production'
    ) {
      return false;
    }
    return true;
  } catch {
    return nodeEnv === 'production';
  }
}

export interface BuildAuthorizeUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
  showDialog?: boolean;
}

/**
 * Constructs the Spotify authorization URL with PKCE parameters.
 */
export function buildSpotifyAuthorizeUrl(
  params: BuildAuthorizeUrlParams,
): string {
  const {
    clientId,
    redirectUri,
    state,
    codeChallenge,
    scopes = DEFAULT_SPOTIFY_SCOPES,
    showDialog = false,
  } = params;

  if (!clientId || !clientId.trim()) {
    throw new Error('Spotify client ID is required.');
  }
  if (!redirectUri || !redirectUri.trim()) {
    throw new Error('Spotify redirect URI is required.');
  }
  if (!state || !state.trim()) {
    throw new Error('OAuth state is required.');
  }
  if (!codeChallenge || !codeChallenge.trim()) {
    throw new Error('PKCE code challenge is required.');
  }

  const url = new URL(SPOTIFY_AUTH_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId.trim());
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('redirect_uri', redirectUri.trim());
  url.searchParams.set('state', state.trim());
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', codeChallenge.trim());

  if (showDialog) {
    url.searchParams.set('show_dialog', 'true');
  }

  return url.toString();
}

export interface SpotifyCookieOptions {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number; // in seconds
}

/**
 * Returns strict, security-hardened cookie configuration for OAuth PKCE state and verifier.
 */
export function getOAuthCookieOptions(
  redirectUri: string,
  nodeEnv = process.env.NODE_ENV,
): SpotifyCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(redirectUri, nodeEnv),
    path: '/',
    maxAge: 10 * 60, // 10 minutes (plenty of time for auth completion, short enough to limit exposure)
  };
}
