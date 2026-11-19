import crypto from 'node:crypto';
import { decryptSecret, encryptSecret } from '@/lib/security/crypto';

/**
 * Phase 2, PR #10 Spotify OAuth 2.0 PKCE Helpers
 * Implements RFC 7636 Authorization Code Flow with Proof Key for Code Exchange (PKCE).
 */

export const SPOTIFY_OAUTH_STATE_COOKIE = 'encore_spotify_oauth_state';
export const SPOTIFY_OAUTH_VERIFIER_COOKIE = 'encore_spotify_oauth_verifier';
export const SPOTIFY_OAUTH_BINDING_COOKIE = 'encore_spotify_oauth_binding';

export const SPOTIFY_AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';

export const DEFAULT_SPOTIFY_SCOPES = ['user-top-read'];

export interface RedirectUriValidationResult {
  isValid: boolean;
  error?: string;
  normalizedUri?: string;
}

/**
 * Validates a Spotify OAuth redirect URI against RFC 6749 and Spotify 2026 Developer guidelines.
 * Strict rules:
 * - Must be non-empty and have no leading/trailing or internal whitespace.
 * - Must be a valid URL with http: (loopback only) or https:.
 * - Must specify a concrete path (not root '/' or empty).
 * - Must not contain URL fragment identifiers (#).
 */
export function validateSpotifyRedirectUri(
  redirectUri: unknown,
): RedirectUriValidationResult {
  if (typeof redirectUri !== 'string' || !redirectUri.trim()) {
    return {
      isValid: false,
      error: 'Redirect URI is required and must be a non-empty string.',
    };
  }

  if (redirectUri !== redirectUri.trim()) {
    return {
      isValid: false,
      error:
        'Redirect URI contains leading or trailing whitespace. Ensure no extra spaces or newlines exist in your environment configuration.',
    };
  }

  if (/\s/.test(redirectUri)) {
    return {
      isValid: false,
      error: 'Redirect URI contains internal whitespace characters.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return {
      isValid: false,
      error: `Redirect URI is not a valid URL: "${redirectUri}".`,
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      isValid: false,
      error: `Redirect URI must use http: or https: protocol. Received: "${parsed.protocol}".`,
    };
  }

  const isLoopback =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol === 'http:' && !isLoopback) {
    return {
      isValid: false,
      error: `Spotify requires HTTPS for all redirect URIs except localhost or 127.0.0.1. Received HTTP on "${parsed.hostname}".`,
    };
  }

  if (parsed.hash) {
    return {
      isValid: false,
      error:
        'Spotify redirect URI must not include URL fragment identifiers (#).',
    };
  }

  if (!parsed.pathname || parsed.pathname === '/') {
    return {
      isValid: false,
      error: `Redirect URI is missing a specific callback path (e.g., /api/integrations/spotify/callback). Received root path: "${parsed.pathname}".`,
    };
  }

  return {
    isValid: true,
    normalizedUri: parsed.toString(),
  };
}

export interface RedirectUriComparisonResult {
  matches: boolean;
  reason?: string;
}

/**
 * Compares configured redirect URI with an incoming redirect URI, providing clear diagnostics on mismatch.
 */
export function compareRedirectUris(
  configuredUri: string,
  incomingUri: string,
): RedirectUriComparisonResult {
  if (configuredUri === incomingUri) {
    return { matches: true };
  }

  if (
    configuredUri.trim() !== configuredUri ||
    incomingUri.trim() !== incomingUri
  ) {
    return {
      matches: false,
      reason: 'Redirect URI mismatch due to leading or trailing whitespace.',
    };
  }

  try {
    const parsedConfigured = new URL(configuredUri);
    const parsedIncoming = new URL(incomingUri);

    if (parsedConfigured.origin !== parsedIncoming.origin) {
      return {
        matches: false,
        reason: `Origin mismatch: expected "${parsedConfigured.origin}", received "${parsedIncoming.origin}".`,
      };
    }

    if (parsedConfigured.pathname !== parsedIncoming.pathname) {
      return {
        matches: false,
        reason: `Path mismatch: expected "${parsedConfigured.pathname}", received "${parsedIncoming.pathname}".`,
      };
    }

    if (parsedConfigured.search !== parsedIncoming.search) {
      return {
        matches: false,
        reason: `Query parameter mismatch: expected "${parsedConfigured.search}", received "${parsedIncoming.search}".`,
      };
    }
  } catch {
    // URL parsing failed
  }

  return {
    matches: false,
    reason: `Redirect URIs do not match exactly. Configured: "${configuredUri}", Received: "${incomingUri}".`,
  };
}

export interface SpotifyOAuthConfigInput {
  clientId?: string | null;
  clientSecret?: string | null;
  redirectUri?: string | null;
  encryptionKey?: string | null;
}

export interface SpotifyOAuthConfigDiagnostic {
  isValid: boolean;
  issues: string[];
  sanitizedConfig: {
    clientIdConfigured: boolean;
    clientSecretConfigured: boolean;
    redirectUri: string | null;
    redirectUriValid: boolean;
    encryptionKeyConfigured: boolean;
    encryptionKeyValidHex: boolean;
    encryptionKeyLength: number;
  };
}

/**
 * Diagnostic helper that validates Spotify OAuth environment configuration
 * (client ID, client secret, redirect URI, and encryption key) without leaking secrets.
 */
export function diagnoseSpotifyOAuthConfig(
  config: SpotifyOAuthConfigInput,
): SpotifyOAuthConfigDiagnostic {
  const issues: string[] = [];

  // 1. Client ID
  const clientId = config.clientId;
  const clientIdConfigured = Boolean(
    clientId && typeof clientId === 'string' && clientId.trim().length > 0,
  );
  if (!clientIdConfigured) {
    issues.push('SPOTIFY_CLIENT_ID is missing or empty.');
  } else if (
    typeof clientId === 'string' &&
    (clientId !== clientId.trim() || /\s/.test(clientId))
  ) {
    issues.push('SPOTIFY_CLIENT_ID contains whitespace characters.');
  }

  // 2. Client Secret (never leak the secret value)
  const clientSecret = config.clientSecret;
  const clientSecretConfigured = Boolean(
    clientSecret &&
    typeof clientSecret === 'string' &&
    clientSecret.trim().length > 0,
  );
  if (!clientSecretConfigured) {
    issues.push('SPOTIFY_CLIENT_SECRET is missing or empty.');
  } else if (
    typeof clientSecret === 'string' &&
    (clientSecret !== clientSecret.trim() || /\s/.test(clientSecret))
  ) {
    issues.push('SPOTIFY_CLIENT_SECRET contains whitespace characters.');
  }

  // 3. Redirect URI
  const redirectUri = config.redirectUri;
  let redirectUriValid = false;
  let sanitizedRedirectUri: string | null = null;
  if (!redirectUri || typeof redirectUri !== 'string' || !redirectUri.trim()) {
    issues.push('SPOTIFY_REDIRECT_URI is missing or empty.');
  } else {
    sanitizedRedirectUri = redirectUri.trim();
    const uriValidation = validateSpotifyRedirectUri(redirectUri);
    redirectUriValid = uriValidation.isValid;
    if (!uriValidation.isValid && uriValidation.error) {
      issues.push(`SPOTIFY_REDIRECT_URI invalid: ${uriValidation.error}`);
    }
  }

  // 4. Token Encryption Key (never leak the key value)
  const encryptionKey = config.encryptionKey;
  const encryptionKeyConfigured = Boolean(
    encryptionKey &&
    typeof encryptionKey === 'string' &&
    encryptionKey.trim().length > 0,
  );
  let encryptionKeyValidHex = false;
  let encryptionKeyLength = 0;

  if (!encryptionKeyConfigured) {
    issues.push('SPOTIFY_TOKEN_ENCRYPTION_KEY is missing or empty.');
  } else if (typeof encryptionKey === 'string') {
    const trimmedKey = encryptionKey.trim();
    encryptionKeyLength = trimmedKey.length;
    encryptionKeyValidHex = /^[0-9a-fA-F]{64}$/.test(trimmedKey);

    if (encryptionKey !== trimmedKey) {
      issues.push(
        'SPOTIFY_TOKEN_ENCRYPTION_KEY contains leading or trailing whitespace.',
      );
    }
    if (encryptionKeyLength !== 64) {
      issues.push(
        `SPOTIFY_TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes AES-256). Received length: ${encryptionKeyLength}.`,
      );
    } else if (!encryptionKeyValidHex) {
      issues.push(
        'SPOTIFY_TOKEN_ENCRYPTION_KEY contains non-hexadecimal characters.',
      );
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
    sanitizedConfig: {
      clientIdConfigured,
      clientSecretConfigured,
      redirectUri: sanitizedRedirectUri,
      redirectUriValid,
      encryptionKeyConfigured,
      encryptionKeyValidHex,
      encryptionKeyLength,
    },
  };
}

export interface OAuthHandshakePayload {
  state: string;
  codeVerifier: string;
  userId: string;
  createdAt: number;
}

/**
 * Encrypts and securely binds the OAuth state, PKCE verifier, and initiating Encore user ID.
 */
export function createOAuthHandshakeToken(
  payload: OAuthHandshakePayload,
  encryptionKey: string,
): string {
  if (!payload.state || !payload.codeVerifier || !payload.userId) {
    throw new Error(
      'OAuth handshake payload must include state, codeVerifier, and userId.',
    );
  }
  const serialized = JSON.stringify({
    state: payload.state,
    codeVerifier: payload.codeVerifier,
    userId: payload.userId,
    createdAt: payload.createdAt || Date.now(),
  });
  return encryptSecret(serialized, encryptionKey);
}

/**
 * Decrypts and verifies the OAuth handshake token, enforcing expiration and payload integrity.
 */
export function verifyOAuthHandshakeToken(
  token: string,
  encryptionKey: string,
  maxAgeMs = 10 * 60 * 1000,
): OAuthHandshakePayload | null {
  if (!token || typeof token !== 'string') return null;
  try {
    const decrypted = decryptSecret(token, encryptionKey);
    const parsed = JSON.parse(decrypted) as OAuthHandshakePayload;
    if (
      !parsed.state ||
      !parsed.codeVerifier ||
      !parsed.userId ||
      typeof parsed.createdAt !== 'number'
    ) {
      return null;
    }
    const age = Date.now() - parsed.createdAt;
    if (age < 0 || age > maxAgeMs) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

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
  const uriValidation = validateSpotifyRedirectUri(redirectUri);
  if (!uriValidation.isValid) {
    throw new Error(`Invalid redirect URI: ${uriValidation.error}`);
  }
  if (!state || !state.trim()) {
    throw new Error('OAuth state is required.');
  }
  if (!codeChallenge || !codeChallenge.trim()) {
    throw new Error('PKCE code challenge is required.');
  }

  // Ensure 'user-top-read' is always included per Spotify 2026 Developer guidelines
  const effectiveScopes = Array.from(
    new Set([...scopes, 'user-top-read']),
  ).filter(Boolean);

  const url = new URL(SPOTIFY_AUTH_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId.trim());
  url.searchParams.set('scope', effectiveScopes.join(' '));
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
