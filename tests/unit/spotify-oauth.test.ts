import { describe, expect, it } from 'vitest';
import {
  buildSpotifyAuthorizeUrl,
  computeCodeChallenge,
  generateCodeVerifier,
  generateOAuthState,
  getOAuthCookieOptions,
  shouldUseSecureCookies,
  SPOTIFY_AUTH_ENDPOINT,
} from '@/lib/sources/spotify/oauth';

describe('Spotify OAuth PKCE Utilities', () => {
  it('generates a valid RFC 7636 code verifier', () => {
    const verifier = generateCodeVerifier();
    expect(typeof verifier).toBe('string');
    // Base64URL encoding of 32 bytes is 43 characters
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    // RFC 7636 allows [A-Za-z0-9_-.~]
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('computes deterministic S256 code challenge from verifier', () => {
    // Known test vector
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = computeCodeChallenge(verifier);

    expect(typeof challenge).toBe('string');
    expect(challenge.length).toBeGreaterThanOrEqual(43);
    // Re-computing gives the exact same result
    expect(computeCodeChallenge(verifier)).toBe(challenge);
  });

  it('generates random hex state', () => {
    const state1 = generateOAuthState();
    const state2 = generateOAuthState();
    expect(state1).not.toBe(state2);
    expect(state1.length).toBe(48); // 24 bytes in hex
  });

  it('builds a compliant Spotify authorization URL with PKCE parameters', () => {
    const urlString = buildSpotifyAuthorizeUrl({
      clientId: 'mock-client-id-123',
      redirectUri: 'http://127.0.0.1:3000/api/integrations/spotify/callback',
      state: 'test-state-456',
      codeChallenge: 'test-challenge-789',
      scopes: ['user-top-read'],
    });

    const parsed = new URL(urlString);
    expect(parsed.origin + parsed.pathname).toBe(SPOTIFY_AUTH_ENDPOINT);
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('mock-client-id-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:3000/api/integrations/spotify/callback',
    );
    expect(parsed.searchParams.get('state')).toBe('test-state-456');
    expect(parsed.searchParams.get('code_challenge')).toBe(
      'test-challenge-789',
    );
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('scope')).toBe('user-top-read');
  });

  it('evaluates secure cookie policy based on protocol and host', () => {
    // Local loopback HTTP in development should allow non-secure cookie
    expect(
      shouldUseSecureCookies(
        'http://127.0.0.1:3000/api/integrations/spotify/callback',
        'development',
      ),
    ).toBe(false);

    // Production environment forces secure cookie
    expect(
      shouldUseSecureCookies(
        'http://127.0.0.1:3000/api/integrations/spotify/callback',
        'production',
      ),
    ).toBe(true);

    // HTTPS always forces secure cookie regardless of environment
    expect(
      shouldUseSecureCookies(
        'https://encore.live/api/integrations/spotify/callback',
        'development',
      ),
    ).toBe(true);
  });

  it('returns hardened cookie options for PKCE state and verifier', () => {
    const options = getOAuthCookieOptions(
      'http://127.0.0.1:3000/api/integrations/spotify/callback',
    );

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBe(600); // 10 minutes
  });
});
