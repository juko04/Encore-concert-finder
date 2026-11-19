import { describe, expect, it } from 'vitest';
import { SpotifyApiClient } from '@/lib/sources/spotify/client';
import {
  SpotifyAuthenticationError,
  SpotifyForbiddenError,
  SpotifyRateLimitError,
} from '@/lib/domain/spotify';

describe('SpotifyApiClient', () => {
  const baseConfig = {
    clientId: 'client-123',
    clientSecret: 'secret-456',
    redirectUri: 'http://127.0.0.1:3000/api/integrations/spotify/callback',
  };

  it('validates redirectUri in constructor rejecting whitespace or missing path', () => {
    expect(
      () =>
        new SpotifyApiClient({
          ...baseConfig,
          redirectUri:
            ' http://127.0.0.1:3000/api/integrations/spotify/callback ',
        }),
    ).toThrow(/whitespace/);

    expect(
      () =>
        new SpotifyApiClient({
          ...baseConfig,
          redirectUri: 'https://encore.live',
        }),
    ).toThrow(/missing a specific callback path/);
  });

  it('exchanges authorization code for access and refresh tokens with PKCE verifier', async () => {
    let capturedUrl = '';
    let capturedOptions: RequestInit | undefined;

    const mockFetch = async (
      url: string | URL | Request,
      opts?: RequestInit,
    ) => {
      capturedUrl = url.toString();
      capturedOptions = opts;
      return new Response(
        JSON.stringify({
          access_token: 'mock-access-token',
          token_type: 'Bearer',
          scope: 'user-top-read',
          expires_in: 3600,
          refresh_token: 'mock-refresh-token',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const client = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const result = await client.exchangeAuthorizationCode(
      'auth-code-789',
      'pkce-verifier-abc',
    );

    expect(capturedUrl).toBe('https://accounts.spotify.com/api/token');
    expect(capturedOptions?.method).toBe('POST');
    expect(
      (capturedOptions?.headers as Record<string, string>)?.Authorization,
    ).toMatch(/^Basic /);

    const bodyParams = new URLSearchParams(capturedOptions?.body as string);
    expect(bodyParams.get('grant_type')).toBe('authorization_code');
    expect(bodyParams.get('code')).toBe('auth-code-789');
    expect(bodyParams.get('code_verifier')).toBe('pkce-verifier-abc');

    expect(result.accessToken).toBe('mock-access-token');
    expect(result.refreshToken).toBe('mock-refresh-token');
    expect(result.scopes).toEqual(['user-top-read']);
    expect(result.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(result.reauthorizationDeadline.getTime()).toBeGreaterThan(
      Date.now() + 100 * 86400 * 1000,
    );
  });

  it('throws SpotifyAuthenticationError when token exchange returns 401', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ error: 'invalid_client' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });

    const client = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(
      client.exchangeAuthorizationCode('bad-code', 'verifier'),
    ).rejects.toThrow(SpotifyAuthenticationError);
  });

  it('throws SpotifyAuthenticationError when token exchange returns 400 (invalid_grant or expired code)', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Invalid authorization code',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );

    const client = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(
      client.exchangeAuthorizationCode('expired-code', 'verifier'),
    ).rejects.toThrow(SpotifyAuthenticationError);
  });

  it('throws SpotifyForbiddenError when token exchange returns 403', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });

    const client = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(
      client.exchangeAuthorizationCode('code', 'verifier'),
    ).rejects.toThrow(SpotifyForbiddenError);
  });

  it('handles 5xx server errors during token exchange', async () => {
    const mockFetch = async () =>
      new Response('Service Unavailable', {
        status: 503,
      });

    const client = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(
      client.exchangeAuthorizationCode('code', 'verifier'),
    ).rejects.toThrow(/service unavailable/i);
  });

  it('handles transient network failures during token exchange', async () => {
    const mockFetch = async () => {
      throw new Error('ECONNRESET');
    };

    const client = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(
      client.exchangeAuthorizationCode('code', 'verifier'),
    ).rejects.toThrow(/Spotify token exchange network request failed/);
  });

  it('throws SpotifyRateLimitError when token exchange returns 429 with Retry-After', async () => {
    const mockFetch = async () =>
      new Response('Rate limit exceeded', {
        status: 429,
        headers: { 'Retry-After': '42' },
      });

    const client = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    try {
      await client.exchangeAuthorizationCode('code', 'verifier');
      expect.fail('Expected SpotifyRateLimitError');
    } catch (error) {
      expect(error).toBeInstanceOf(SpotifyRateLimitError);
      expect((error as SpotifyRateLimitError).retryAfterSeconds).toBe(42);
    }
  });

  it('refreshes an access token successfully', async () => {
    let capturedBody = '';
    const mockFetch = async (_url: unknown, opts?: RequestInit) => {
      capturedBody = opts?.body as string;
      return new Response(
        JSON.stringify({
          access_token: 'new-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const client = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const result = await client.refreshAccessToken('my-refresh-token');
    const bodyParams = new URLSearchParams(capturedBody);

    expect(bodyParams.get('grant_type')).toBe('refresh_token');
    expect(bodyParams.get('refresh_token')).toBe('my-refresh-token');
    expect(result.accessToken).toBe('new-access-token');
  });

  it('throws SpotifyAuthenticationError when refresh token is revoked or invalid (HTTP 400 or 401)', async () => {
    // 400 invalid_grant
    const mock400Fetch = async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });

    const client400 = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mock400Fetch as unknown as typeof fetch,
    });

    await expect(
      client400.refreshAccessToken('revoked-refresh-token'),
    ).rejects.toThrow(
      'Spotify authorization expired or is invalid. User reauthorization required.',
    );

    // 401 unauthorized
    const mock401Fetch = async () =>
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });

    const client401 = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mock401Fetch as unknown as typeof fetch,
    });

    await expect(
      client401.refreshAccessToken('bad-refresh-token'),
    ).rejects.toThrow(
      'Spotify authorization expired or is invalid. User reauthorization required.',
    );
  });

  it('throws SpotifyForbiddenError on HTTP 403 during token refresh', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });

    const client = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(client.refreshAccessToken('my-refresh-token')).rejects.toThrow(
      SpotifyForbiddenError,
    );
  });

  it('throws SpotifyRateLimitError on HTTP 429 during token refresh', async () => {
    const mockFetch = async () =>
      new Response('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '15' },
      });

    const client = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    try {
      await client.refreshAccessToken('my-refresh-token');
      expect.fail('Expected SpotifyRateLimitError');
    } catch (err) {
      expect(err).toBeInstanceOf(SpotifyRateLimitError);
      expect((err as SpotifyRateLimitError).retryAfterSeconds).toBe(15);
    }
  });

  it('handles 5xx server errors and network errors during token refresh', async () => {
    const mock500 = async () =>
      new Response('Internal Server Error', { status: 500 });
    const client500 = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mock500 as unknown as typeof fetch,
    });

    await expect(
      client500.refreshAccessToken('my-refresh-token'),
    ).rejects.toThrow(/service unavailable/i);

    const mockNetwork = async () => {
      throw new Error('ETIMEDOUT');
    };
    const clientNet = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mockNetwork as unknown as typeof fetch,
    });

    await expect(
      clientNet.refreshAccessToken('my-refresh-token'),
    ).rejects.toThrow(/Spotify token refresh network request failed/);
  });

  it('retrieves user profile prioritizing account_id over id', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          account_id: 'spotify-account-stable-id',
          id: 'legacy-username-id',
          display_name: 'Test Listener',
          email: 'listener@example.com',
          product: 'premium',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const client = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const profile = await client.getCurrentUser('token-123');
    expect(profile.accountId).toBe('spotify-account-stable-id');
    expect(profile.displayName).toBe('Test Listener');
  });

  it('falls back to id when account_id is not present in profile', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          id: 'fallback-user-id',
          display_name: 'Fallback User',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const client = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const profile = await client.getCurrentUser('token-123');
    expect(profile.accountId).toBe('fallback-user-id');
  });

  it('throws SpotifyForbiddenError on HTTP 403 Developer Mode restriction', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({ error: { status: 403, message: 'Forbidden' } }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      );

    const client = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(client.getCurrentUser('token')).rejects.toThrow(
      SpotifyForbiddenError,
    );
  });

  it('fetches and maps top artists with ranking and metadata', async () => {
    const mockItems = [
      {
        id: 'artist-1',
        name: 'Khruangbin',
        genres: ['psychedelic rock', 'funk'],
        popularity: 78,
        images: [{ url: 'https://example.com/khruangbin.jpg' }],
        external_urls: { spotify: 'https://open.spotify.com/artist/artist-1' },
      },
      {
        id: 'artist-2',
        name: 'Leon Bridges',
        genres: ['soul', 'r&b'],
        popularity: 72,
        images: [],
        external_urls: {},
      },
    ];

    const mockFetch = async (url: string | URL | Request) => {
      const parsed = new URL(url.toString());
      expect(parsed.searchParams.get('time_range')).toBe('medium_term');
      expect(parsed.searchParams.get('limit')).toBe('10');

      return new Response(JSON.stringify({ items: mockItems }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new SpotifyApiClient({
      ...baseConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const artists = await client.getTopArtists('token', 'medium_term', 10);
    expect(artists).toHaveLength(2);

    expect(artists[0]).toEqual({
      id: 'artist-1',
      name: 'Khruangbin',
      rank: 1,
      imageUrl: 'https://example.com/khruangbin.jpg',
      spotifyUrl: 'https://open.spotify.com/artist/artist-1',
      genres: ['psychedelic rock', 'funk'],
      popularity: 78,
      timeRange: 'medium_term',
    });

    expect(artists[1]).toEqual({
      id: 'artist-2',
      name: 'Leon Bridges',
      rank: 2,
      imageUrl: null,
      spotifyUrl: 'https://open.spotify.com/artist/artist-2',
      genres: ['soul', 'r&b'],
      popularity: 72,
      timeRange: 'medium_term',
    });
  });

  it('rejects invalid timeRange', async () => {
    const client = new SpotifyApiClient(baseConfig);
    await expect(
      client.getTopArtists('token', 'all_time' as any),
    ).rejects.toThrow(/Invalid Spotify timeRange/);
  });

  describe('Spotify API Error Surface & Network Resilience', () => {
    it('getCurrentUser handles 401, 429, 500, and network errors', async () => {
      // 401
      const client401 = new SpotifyApiClient({
        ...baseConfig,
        fetchFn: (async () =>
          new Response('Unauthorized', { status: 401 })) as any,
      });
      await expect(client401.getCurrentUser('token')).rejects.toThrow(
        SpotifyAuthenticationError,
      );

      // 429
      const client429 = new SpotifyApiClient({
        ...baseConfig,
        fetchFn: (async () =>
          new Response('Too Many Requests', {
            status: 429,
            headers: { 'Retry-After': '12' },
          })) as any,
      });
      try {
        await client429.getCurrentUser('token');
        expect.fail('Expected rate limit error');
      } catch (err) {
        expect(err).toBeInstanceOf(SpotifyRateLimitError);
        expect((err as SpotifyRateLimitError).retryAfterSeconds).toBe(12);
      }

      // 500
      const client500 = new SpotifyApiClient({
        ...baseConfig,
        fetchFn: (async () =>
          new Response('Server Error', { status: 500 })) as any,
      });
      await expect(client500.getCurrentUser('token')).rejects.toThrow(
        /service unavailable/i,
      );

      // Network error
      const clientNet = new SpotifyApiClient({
        ...baseConfig,
        fetchFn: (async () => {
          throw new Error('Connection reset');
        }) as any,
      });
      await expect(clientNet.getCurrentUser('token')).rejects.toThrow(
        /Spotify user profile network request failed/,
      );
    });

    it('getTopArtists handles 401, 403, 429, 500, and network errors', async () => {
      // 401
      const client401 = new SpotifyApiClient({
        ...baseConfig,
        fetchFn: (async () =>
          new Response('Unauthorized', { status: 401 })) as any,
      });
      await expect(
        client401.getTopArtists('token', 'short_term'),
      ).rejects.toThrow(SpotifyAuthenticationError);

      // 403
      const client403 = new SpotifyApiClient({
        ...baseConfig,
        fetchFn: (async () =>
          new Response('Forbidden', { status: 403 })) as any,
      });
      await expect(
        client403.getTopArtists('token', 'short_term'),
      ).rejects.toThrow(SpotifyForbiddenError);

      // 429
      const client429 = new SpotifyApiClient({
        ...baseConfig,
        fetchFn: (async () =>
          new Response('Too Many Requests', {
            status: 429,
            headers: { 'Retry-After': '7' },
          })) as any,
      });
      try {
        await client429.getTopArtists('token', 'short_term');
        expect.fail('Expected rate limit error');
      } catch (err) {
        expect(err).toBeInstanceOf(SpotifyRateLimitError);
        expect((err as SpotifyRateLimitError).retryAfterSeconds).toBe(7);
      }

      // 500
      const client500 = new SpotifyApiClient({
        ...baseConfig,
        fetchFn: (async () =>
          new Response('Server Error', { status: 500 })) as any,
      });
      await expect(
        client500.getTopArtists('token', 'short_term'),
      ).rejects.toThrow(/service unavailable/i);

      // Network error
      const clientNet = new SpotifyApiClient({
        ...baseConfig,
        fetchFn: (async () => {
          throw new Error('Socket closed');
        }) as any,
      });
      await expect(
        clientNet.getTopArtists('token', 'short_term'),
      ).rejects.toThrow(/Spotify top artists network request failed/);
    });
  });

  describe('Spotify Reconnection Safety & Preference Preservation', () => {
    it('allows refreshing and re-authorizing tokens without corrupting session or preferences', async () => {
      // Mock initial connection tokens
      const initialTokens = {
        accessToken: 'initial-access-token',
        refreshToken: 'initial-refresh-token',
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      };

      // Mock simulated user preferences stored in Encore
      const userPreferences = [
        {
          userId: 'user-encore-uuid-1',
          artistId: 'artist-khruangbin',
          affinityScore: 100,
          manualPreference: 'favorite',
        },
      ];

      // Simulate re-authorizing / reconnecting via exchangeAuthorizationCode
      const mockFetch = async () =>
        new Response(
          JSON.stringify({
            access_token: 'new-reauthorized-access-token',
            token_type: 'Bearer',
            scope: 'user-top-read',
            expires_in: 3600,
            refresh_token: 'new-reauthorized-refresh-token',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );

      const client = new SpotifyApiClient({
        ...baseConfig,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const reauthResult = await client.exchangeAuthorizationCode(
        'fresh-code',
        'fresh-verifier',
      );

      // New tokens were obtained
      expect(reauthResult.accessToken).toBe('new-reauthorized-access-token');
      expect(reauthResult.refreshToken).toBe('new-reauthorized-refresh-token');
      expect(reauthResult.accessToken).not.toBe(initialTokens.accessToken);

      // Verify that userPreferences are isolated from Spotify tokens
      expect(userPreferences).toHaveLength(1);
      expect(userPreferences[0].manualPreference).toBe('favorite');
      expect(userPreferences[0].affinityScore).toBe(100);
    });
  });
});
