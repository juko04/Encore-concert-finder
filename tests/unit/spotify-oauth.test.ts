import { describe, expect, it } from 'vitest';
import {
  buildSpotifyAuthorizeUrl,
  compareRedirectUris,
  computeCodeChallenge,
  createOAuthHandshakeToken,
  diagnoseSpotifyOAuthConfig,
  generateCodeVerifier,
  generateOAuthState,
  getOAuthCookieOptions,
  shouldUseSecureCookies,
  SPOTIFY_AUTH_ENDPOINT,
  validateSpotifyRedirectUri,
  verifyOAuthHandshakeToken,
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

  it('enforces required user-top-read scope even when custom scopes are passed', () => {
    // If scopes is omitted or doesn't contain user-top-read, it must be added
    const urlString = buildSpotifyAuthorizeUrl({
      clientId: 'mock-client-id-123',
      redirectUri: 'http://127.0.0.1:3000/api/integrations/spotify/callback',
      state: 'test-state-456',
      codeChallenge: 'test-challenge-789',
      scopes: ['user-read-email'],
    });

    const parsed = new URL(urlString);
    const scopes = parsed.searchParams.get('scope')?.split(' ') || [];
    expect(scopes).toContain('user-top-read');
    expect(scopes).toContain('user-read-email');
  });

  it('rejects authorization URL generation if redirect URI is invalid', () => {
    expect(() =>
      buildSpotifyAuthorizeUrl({
        clientId: 'mock-client-id-123',
        redirectUri: ' http://127.0.0.1:3000/callback ', // whitespace
        state: 'test-state-456',
        codeChallenge: 'test-challenge-789',
      }),
    ).toThrow(/Invalid redirect URI/);
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

  describe('OAuth Handshake User Binding', () => {
    const validKey =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    it('encrypts and verifies handshake binding containing state, codeVerifier, and userId', () => {
      const payload = {
        state: 'oauth-state-abc',
        codeVerifier: 'verifier-xyz-12345',
        userId: 'encore-user-uuid-999',
        createdAt: Date.now(),
      };

      const token = createOAuthHandshakeToken(payload, validKey);
      expect(typeof token).toBe('string');
      expect(token).toContain(':'); // IV:tag:ciphertext

      const verified = verifyOAuthHandshakeToken(token, validKey);
      expect(verified).not.toBeNull();
      expect(verified?.state).toBe(payload.state);
      expect(verified?.codeVerifier).toBe(payload.codeVerifier);
      expect(verified?.userId).toBe(payload.userId);
    });

    it('rejects expired handshake binding tokens', () => {
      const expiredPayload = {
        state: 'oauth-state-abc',
        codeVerifier: 'verifier-xyz-12345',
        userId: 'encore-user-uuid-999',
        createdAt: Date.now() - 15 * 60 * 1000, // 15 minutes ago
      };

      const token = createOAuthHandshakeToken(expiredPayload, validKey);
      const verified = verifyOAuthHandshakeToken(
        token,
        validKey,
        10 * 60 * 1000,
      );
      expect(verified).toBeNull();
    });

    it('rejects tampered handshake binding tokens', () => {
      const payload = {
        state: 'oauth-state-abc',
        codeVerifier: 'verifier-xyz-12345',
        userId: 'encore-user-uuid-999',
        createdAt: Date.now(),
      };

      const token = createOAuthHandshakeToken(payload, validKey);
      const tampered = token.slice(0, -4) + 'ffff';
      expect(verifyOAuthHandshakeToken(tampered, validKey)).toBeNull();
    });

    it('fails if required properties are missing when creating token', () => {
      expect(() =>
        createOAuthHandshakeToken(
          {
            state: '',
            codeVerifier: 'verifier',
            userId: 'user',
            createdAt: Date.now(),
          },
          validKey,
        ),
      ).toThrow('OAuth handshake payload must include state');
    });
  });

  describe('Spotify Redirect URI Validation & Matching', () => {
    it('accepts valid HTTPS redirect URI with a path', () => {
      const res = validateSpotifyRedirectUri(
        'https://encore.live/api/integrations/spotify/callback',
      );
      expect(res.isValid).toBe(true);
      expect(res.normalizedUri).toBe(
        'https://encore.live/api/integrations/spotify/callback',
      );
    });

    it('accepts valid loopback HTTP redirect URIs (localhost and 127.0.0.1)', () => {
      expect(
        validateSpotifyRedirectUri(
          'http://localhost:3000/api/integrations/spotify/callback',
        ).isValid,
      ).toBe(true);

      expect(
        validateSpotifyRedirectUri(
          'http://127.0.0.1:3000/api/integrations/spotify/callback',
        ).isValid,
      ).toBe(true);
    });

    it('rejects redirect URI with leading or trailing whitespace', () => {
      const res = validateSpotifyRedirectUri(
        ' http://127.0.0.1:3000/api/integrations/spotify/callback ',
      );
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/leading or trailing whitespace/);
    });

    it('rejects redirect URI with internal whitespace', () => {
      const res = validateSpotifyRedirectUri(
        'http://127.0.0.1:3000/api/ integrations/spotify/callback',
      );
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/internal whitespace/);
    });

    it('rejects redirect URI with missing path or root slash only', () => {
      const noPath = validateSpotifyRedirectUri('https://encore.live');
      expect(noPath.isValid).toBe(false);
      expect(noPath.error).toMatch(/missing a specific callback path/);

      const rootSlash = validateSpotifyRedirectUri('https://encore.live/');
      expect(rootSlash.isValid).toBe(false);
      expect(rootSlash.error).toMatch(/missing a specific callback path/);
    });

    it('rejects HTTP on non-loopback domains', () => {
      const res = validateSpotifyRedirectUri(
        'http://encore.live/api/integrations/spotify/callback',
      );
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/Spotify requires HTTPS/);
    });

    it('rejects redirect URIs containing fragments (#)', () => {
      const res = validateSpotifyRedirectUri(
        'https://encore.live/api/integrations/spotify/callback#access_token=123',
      );
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/fragment/);
    });

    it('rejects invalid URL strings or empty input', () => {
      expect(validateSpotifyRedirectUri('').isValid).toBe(false);
      expect(validateSpotifyRedirectUri(null).isValid).toBe(false);
      expect(validateSpotifyRedirectUri('not-a-valid-url').isValid).toBe(false);
    });

    it('compares redirect URIs and accurately identifies reasons for mismatch', () => {
      const configured =
        'http://127.0.0.1:3000/api/integrations/spotify/callback';

      // Exact match
      expect(compareRedirectUris(configured, configured).matches).toBe(true);

      // Whitespace mismatch
      const withSpace = configured + ' ';
      const wsComp = compareRedirectUris(configured, withSpace);
      expect(wsComp.matches).toBe(false);
      expect(wsComp.reason).toMatch(/whitespace/);

      // Origin mismatch
      const diffOrigin =
        'http://localhost:3000/api/integrations/spotify/callback';
      const originComp = compareRedirectUris(configured, diffOrigin);
      expect(originComp.matches).toBe(false);
      expect(originComp.reason).toMatch(/Origin mismatch/);

      // Path mismatch
      const diffPath = 'http://127.0.0.1:3000/callback';
      const pathComp = compareRedirectUris(configured, diffPath);
      expect(pathComp.matches).toBe(false);
      expect(pathComp.reason).toMatch(/Path mismatch/);
    });
  });

  describe('Spotify OAuth Configuration Diagnostics', () => {
    const validConfig = {
      clientId: 'abcdef0123456789abcdef0123456789',
      clientSecret: 'fedcba9876543210fedcba9876543210',
      redirectUri: 'http://127.0.0.1:3000/api/integrations/spotify/callback',
      encryptionKey:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    };

    it('passes for a fully valid configuration', () => {
      const result = diagnoseSpotifyOAuthConfig(validConfig);
      expect(result.isValid).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.sanitizedConfig.clientIdConfigured).toBe(true);
      expect(result.sanitizedConfig.clientSecretConfigured).toBe(true);
      expect(result.sanitizedConfig.redirectUriValid).toBe(true);
      expect(result.sanitizedConfig.encryptionKeyConfigured).toBe(true);
      expect(result.sanitizedConfig.encryptionKeyValidHex).toBe(true);
      expect(result.sanitizedConfig.encryptionKeyLength).toBe(64);
    });

    it('flags missing and empty configuration variables', () => {
      const result = diagnoseSpotifyOAuthConfig({});
      expect(result.isValid).toBe(false);
      expect(result.issues.length).toBe(4);
      expect(result.issues.some((i) => i.includes('SPOTIFY_CLIENT_ID'))).toBe(
        true,
      );
      expect(
        result.issues.some((i) => i.includes('SPOTIFY_CLIENT_SECRET')),
      ).toBe(true);
      expect(
        result.issues.some((i) => i.includes('SPOTIFY_REDIRECT_URI')),
      ).toBe(true);
      expect(
        result.issues.some((i) => i.includes('SPOTIFY_TOKEN_ENCRYPTION_KEY')),
      ).toBe(true);
    });

    it('flags whitespace in credentials without leaking secrets', () => {
      const result = diagnoseSpotifyOAuthConfig({
        ...validConfig,
        clientId: ' abcdef0123456789abcdef0123456789 ',
        clientSecret: 'fedcba 9876543210',
      });

      expect(result.isValid).toBe(false);
      expect(
        result.issues.some(
          (i) => i.includes('SPOTIFY_CLIENT_ID') && i.includes('whitespace'),
        ),
      ).toBe(true);
      expect(
        result.issues.some(
          (i) =>
            i.includes('SPOTIFY_CLIENT_SECRET') && i.includes('whitespace'),
        ),
      ).toBe(true);

      // Verify that clientSecret is NEVER leaked in issues or sanitizedConfig
      const joinedIssues = result.issues.join(' ');
      expect(joinedIssues).not.toContain('fedcba');
      expect(result.sanitizedConfig).not.toHaveProperty('clientSecret');
    });

    it('flags invalid encryption key format and length without leaking the key', () => {
      const secretBadKey =
        'this-is-not-a-valid-hex-encryption-key-secret-12345';
      const result = diagnoseSpotifyOAuthConfig({
        ...validConfig,
        encryptionKey: secretBadKey,
      });

      expect(result.isValid).toBe(false);
      expect(result.sanitizedConfig.encryptionKeyValidHex).toBe(false);
      expect(
        result.issues.some((i) =>
          i.includes('SPOTIFY_TOKEN_ENCRYPTION_KEY must be exactly 64 hex'),
        ),
      ).toBe(true);

      // Verify the secret key is NOT leaked
      const joinedIssues = result.issues.join(' ');
      expect(joinedIssues).not.toContain('secret-12345');
      expect(result.sanitizedConfig).not.toHaveProperty('encryptionKey');
    });

    it('flags invalid redirect URI in diagnostics', () => {
      const result = diagnoseSpotifyOAuthConfig({
        ...validConfig,
        redirectUri: 'https://encore.live', // missing path
      });

      expect(result.isValid).toBe(false);
      expect(result.sanitizedConfig.redirectUriValid).toBe(false);
      expect(
        result.issues.some((i) =>
          i.includes('missing a specific callback path'),
        ),
      ).toBe(true);
    });
  });
});
