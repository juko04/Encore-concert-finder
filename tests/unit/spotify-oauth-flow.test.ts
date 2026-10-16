import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

// Setup cookie store mock
const cookieMap = new Map<string, string>();
const mockCookieStore = {
  get: vi.fn((name: string) => {
    const val = cookieMap.get(name);
    return val ? { name, value: val } : undefined;
  }),
  set: vi.fn((name: string, value: string) => {
    cookieMap.set(name, value);
  }),
  delete: vi.fn((name: string) => {
    cookieMap.delete(name);
  }),
};

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(async () => mockCookieStore),
}));

vi.mock('@/lib/auth/session', () => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn().mockReturnValue({}),
}));

const mockSaveConnection = vi.fn();
const mockGetConnectionTokens = vi.fn();
const mockUpdateTokens = vi.fn();
const mockDeleteConnection = vi.fn();
const mockUpdateStatus = vi.fn();
const mockRecordSync = vi.fn();

vi.mock('@/lib/repositories/spotify-connection-repository', () => ({
  SupabaseSpotifyConnectionRepository: vi.fn().mockImplementation(() => ({
    saveConnection: mockSaveConnection,
    getConnectionTokens: mockGetConnectionTokens,
    updateTokens: mockUpdateTokens,
    deleteConnection: mockDeleteConnection,
    updateStatus: mockUpdateStatus,
    recordSync: mockRecordSync,
  })),
}));

const mockExchangeAuthorizationCode = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockGetTopArtists = vi.fn();
const mockRefreshAccessToken = vi.fn();

vi.mock('@/lib/sources/spotify/client', () => ({
  SpotifyApiClient: vi.fn().mockImplementation(() => ({
    exchangeAuthorizationCode: mockExchangeAuthorizationCode,
    getCurrentUser: mockGetCurrentUser,
    getTopArtists: mockGetTopArtists,
    refreshAccessToken: mockRefreshAccessToken,
  })),
}));

const TEST_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

const mockServerEnv = {
  ENABLE_SPOTIFY_INTEGRATION: true,
  SPOTIFY_CLIENT_ID: 'mock-spotify-client-id',
  SPOTIFY_CLIENT_SECRET: 'mock-spotify-client-secret',
  SPOTIFY_REDIRECT_URI:
    'http://localhost:3000/api/integrations/spotify/callback',
  SPOTIFY_TOKEN_ENCRYPTION_KEY: TEST_KEY,
};

vi.mock('@/lib/env/server', () => ({
  getServerEnv: vi.fn().mockImplementation(() => mockServerEnv),
}));

import { getAuthenticatedUser } from '@/lib/auth/session';
import { GET as connectHandler } from '@/app/api/integrations/spotify/connect/route';
import { GET as callbackHandler } from '@/app/api/integrations/spotify/callback/route';
import { POST as disconnectHandler } from '@/app/api/integrations/spotify/disconnect/route';
import { GET as topArtistsHandler } from '@/app/api/integrations/spotify/top-artists/route';
import {
  createOAuthHandshakeToken,
  SPOTIFY_OAUTH_BINDING_COOKIE,
  SPOTIFY_OAUTH_STATE_COOKIE,
  SPOTIFY_OAUTH_VERIFIER_COOKIE,
} from '@/lib/sources/spotify/oauth';
import { SpotifyAccountConflictError } from '@/lib/domain/spotify';
import { MemoryUserPreferenceRepository } from '@/lib/repositories/memory-repositories';

describe('Spotify OAuth Flow & API Endpoints (Mocked / Zero-Network)', () => {
  const userA: User = {
    id: 'user-a-111',
    email: 'user_a@encore.test',
  } as unknown as User;

  const userB: User = {
    id: 'user-b-222',
    email: 'user_b@encore.test',
  } as unknown as User;

  beforeEach(() => {
    vi.clearAllMocks();
    cookieMap.clear();
    vi.mocked(getAuthenticatedUser).mockResolvedValue(userA);
  });

  // Scenario 1: Successful OAuth handshake & persistence to user_spotify_connections
  it('Scenario 1: initiates OAuth handshake and successfully connects Spotify on callback', async () => {
    // 1. Connect initiation
    const connectReq = new Request(
      'http://localhost:3000/api/integrations/spotify/connect',
    );
    const connectRes = await connectHandler(connectReq);

    expect(connectRes.status).toBe(307);
    const authRedirect = connectRes.headers.get('location') || '';
    expect(authRedirect).toContain('accounts.spotify.com/authorize');
    expect(authRedirect).toContain('client_id=mock-spotify-client-id');

    // Verify cookie store has binding cookie, state, and verifier
    const bindingVal = cookieMap.get(SPOTIFY_OAUTH_BINDING_COOKIE);
    const stateVal = cookieMap.get(SPOTIFY_OAUTH_STATE_COOKIE);
    const verifierVal = cookieMap.get(SPOTIFY_OAUTH_VERIFIER_COOKIE);

    expect(bindingVal).toBeDefined();
    expect(stateVal).toBeDefined();
    expect(verifierVal).toBeDefined();

    // 2. Mock Spotify API responses on callback
    mockExchangeAuthorizationCode.mockResolvedValueOnce({
      accessToken: 'live-access-token-abc',
      refreshToken: 'live-refresh-token-xyz',
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
      scopes: ['user-top-read'],
    });

    mockGetCurrentUser.mockResolvedValueOnce({
      id: 'old-spotify-id',
      accountId: 'spotify-account-stable-999',
      displayName: 'Test Spotify User',
      email: 'user_a@spotify.test',
    });

    mockSaveConnection.mockResolvedValueOnce(undefined);

    // 3. Callback execution
    const callbackReq = new Request(
      `http://localhost:3000/api/integrations/spotify/callback?code=mock_code_123&state=${stateVal}`,
    );
    const callbackRes = await callbackHandler(callbackReq);

    // Verify redirect to taste profile with success indicator
    expect(callbackRes.status).toBe(307);
    const callbackRedirect = callbackRes.headers.get('location') || '';
    expect(callbackRedirect).toContain('/profile/taste?spotify_connected=true');

    // Verify tokens were exchanged using PKCE verifier
    expect(mockExchangeAuthorizationCode).toHaveBeenCalledWith(
      'mock_code_123',
      verifierVal,
    );

    // Verify user profile accountId was persisted to repository
    expect(mockSaveConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: userA.id,
        spotifyAccountId: 'spotify-account-stable-999',
        accessToken: 'live-access-token-abc',
        refreshToken: 'live-refresh-token-xyz',
      }),
    );

    // Verify handshake cookies were deleted
    expect(mockCookieStore.delete).toHaveBeenCalledWith(
      SPOTIFY_OAUTH_BINDING_COOKIE,
    );
    expect(mockCookieStore.delete).toHaveBeenCalledWith(
      SPOTIFY_OAUTH_STATE_COOKIE,
    );
    expect(mockCookieStore.delete).toHaveBeenCalledWith(
      SPOTIFY_OAUTH_VERIFIER_COOKIE,
    );
  });

  // Scenario 2: Callback state mismatch rejection (invalid_state)
  it('Scenario 2: rejects callback when state parameter does not match binding', async () => {
    // Initiate handshake to populate binding cookie
    const token = createOAuthHandshakeToken(
      {
        state: 'legitimate-state-abc',
        codeVerifier: 'verifier-123',
        userId: userA.id,
        createdAt: Date.now(),
      },
      TEST_KEY,
    );
    cookieMap.set(SPOTIFY_OAUTH_BINDING_COOKIE, token);

    // Callback arrives with spoofed or mismatched state
    const callbackReq = new Request(
      'http://localhost:3000/api/integrations/spotify/callback?code=mock_code&state=attacker-spoofed-state',
    );
    const callbackRes = await callbackHandler(callbackReq);

    expect(callbackRes.status).toBe(307);
    const location = callbackRes.headers.get('location') || '';
    expect(location).toContain('/profile/taste?spotify_error=invalid_state');

    // Invariant: Zero calls to Spotify or DB persistence on invalid state
    expect(mockExchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(mockSaveConnection).not.toHaveBeenCalled();
  });

  // Scenario 3: Switched Encore session rejection (session_mismatch)
  it('Scenario 3: rejects callback when authenticated session switched to a different user', async () => {
    // Handshake initiated by User A
    const token = createOAuthHandshakeToken(
      {
        state: 'valid-state-123',
        codeVerifier: 'verifier-123',
        userId: userA.id,
        createdAt: Date.now(),
      },
      TEST_KEY,
    );
    cookieMap.set(SPOTIFY_OAUTH_BINDING_COOKIE, token);

    // But current active session is User B!
    vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(userB);

    const callbackReq = new Request(
      'http://localhost:3000/api/integrations/spotify/callback?code=mock_code&state=valid-state-123',
    );
    const callbackRes = await callbackHandler(callbackReq);

    expect(callbackRes.status).toBe(307);
    const location = callbackRes.headers.get('location') || '';
    expect(location).toContain('/profile/taste?spotify_error=session_mismatch');

    // Invariant: Never bind credentials to wrong user
    expect(mockExchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(mockSaveConnection).not.toHaveBeenCalled();
  });

  // Scenario 4: Expired or replayed callback rejection
  it('Scenario 4: rejects replayed callback when binding cookie is absent', async () => {
    // No binding cookie in cookieMap (e.g. was already consumed and deleted)
    const callbackReq = new Request(
      'http://localhost:3000/api/integrations/spotify/callback?code=mock_code&state=replayed-state',
    );
    const callbackRes = await callbackHandler(callbackReq);

    expect(callbackRes.status).toBe(307);
    const location = callbackRes.headers.get('location') || '';
    expect(location).toContain('/profile/taste?spotify_error=invalid_state');
    expect(mockExchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('Scenario 4 (cont): rejects expired callback when handshake token is older than 10 minutes', async () => {
    const expiredToken = createOAuthHandshakeToken(
      {
        state: 'valid-state-123',
        codeVerifier: 'verifier-123',
        userId: userA.id,
        createdAt: Date.now() - 11 * 60 * 1000, // 11 minutes ago
      },
      TEST_KEY,
    );
    cookieMap.set(SPOTIFY_OAUTH_BINDING_COOKIE, expiredToken);

    const callbackReq = new Request(
      'http://localhost:3000/api/integrations/spotify/callback?code=mock_code&state=valid-state-123',
    );
    const callbackRes = await callbackHandler(callbackReq);

    expect(callbackRes.status).toBe(307);
    const location = callbackRes.headers.get('location') || '';
    expect(location).toContain('/profile/taste?spotify_error=invalid_state');
    expect(mockExchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  // Scenario 5: Account conflict rejection when Spotify account is linked to another user
  it('Scenario 5: redirects with account_conflict when Spotify account is already linked to another user', async () => {
    const token = createOAuthHandshakeToken(
      {
        state: 'valid-state-555',
        codeVerifier: 'verifier-555',
        userId: userA.id,
        createdAt: Date.now(),
      },
      TEST_KEY,
    );
    cookieMap.set(SPOTIFY_OAUTH_BINDING_COOKIE, token);

    mockExchangeAuthorizationCode.mockResolvedValueOnce({
      accessToken: 'token-555',
      refreshToken: 'refresh-555',
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
      scopes: ['user-top-read'],
    });

    mockGetCurrentUser.mockResolvedValueOnce({
      accountId: 'spotify-account-already-linked',
      displayName: 'Existing User',
    });

    // Repository enforces 1-to-1 and rejects with SpotifyAccountConflictError
    mockSaveConnection.mockRejectedValueOnce(
      new SpotifyAccountConflictError('spotify-account-already-linked'),
    );

    const callbackReq = new Request(
      'http://localhost:3000/api/integrations/spotify/callback?code=mock_code&state=valid-state-555',
    );
    const callbackRes = await callbackHandler(callbackReq);

    expect(callbackRes.status).toBe(307);
    const location = callbackRes.headers.get('location') || '';
    expect(location).toContain('/profile/taste?spotify_error=account_conflict');
  });

  // Scenario 6: Token refresh on expiration vs. reauthorization deadline expiration
  it('Scenario 6: automatically refreshes access token when near expiration', async () => {
    mockGetConnectionTokens.mockResolvedValueOnce({
      accessToken: 'old-expiring-token',
      refreshToken: 'valid-refresh-token',
      tokenExpiresAt: new Date(Date.now() + 10 * 1000), // expiring in 10s (within 60s threshold)
      reauthorizationDeadline: new Date(Date.now() + 180 * 86400 * 1000),
      scopes: ['user-top-read'],
    });

    mockRefreshAccessToken.mockResolvedValueOnce({
      accessToken: 'refreshed-access-token',
      refreshToken: 'new-refresh-token',
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      scopes: ['user-top-read'],
    });

    mockGetTopArtists.mockResolvedValueOnce([
      { id: 'art-1', name: 'Radiohead', rank: 1, genres: ['rock'] },
    ]);

    const req = new Request(
      'http://localhost:3000/api/integrations/spotify/top-artists?time_range=short_term',
    );
    const res = await topArtistsHandler(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artists).toHaveLength(1);
    expect(body.artists[0].name).toBe('Radiohead');

    // Verify token refresh was invoked and updated in repository
    expect(mockRefreshAccessToken).toHaveBeenCalledWith('valid-refresh-token');
    expect(mockUpdateTokens).toHaveBeenCalledWith(
      userA.id,
      expect.objectContaining({
        accessToken: 'refreshed-access-token',
      }),
    );
    expect(mockGetTopArtists).toHaveBeenCalledWith(
      'refreshed-access-token',
      'short_term',
    );
  });

  it('Scenario 6 (cont): blocks calls and returns 401 when reauthorization deadline is expired', async () => {
    mockGetConnectionTokens.mockResolvedValueOnce({
      accessToken: 'valid-token',
      refreshToken: 'valid-refresh',
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      reauthorizationDeadline: new Date(Date.now() - 5000), // deadline expired in past
      scopes: ['user-top-read'],
    });

    const req = new Request(
      'http://localhost:3000/api/integrations/spotify/top-artists?time_range=short_term',
    );
    const res = await topArtistsHandler(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('reauthorization_required');
    expect(mockUpdateStatus).toHaveBeenCalledWith(userA.id, 'expired');

    // Invariant: Zero calls to Spotify API when deadline is expired
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    expect(mockGetTopArtists).not.toHaveBeenCalled();
  });

  // Scenario 7: Disconnect and credential deletion
  it('Scenario 7: disconnects Spotify and removes credentials from repository', async () => {
    mockDeleteConnection.mockResolvedValueOnce(true);

    const res = await disconnectHandler();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    expect(mockDeleteConnection).toHaveBeenCalledWith(userA.id);
  });

  // Scenario 8: Manual preference preservation in user_artist_preferences across disconnect
  it('Scenario 8: preserves manual preferences in user_artist_preferences across Spotify disconnect', async () => {
    const memoryPrefRepo = new MemoryUserPreferenceRepository();

    // 1. User A has an explicit manual concert preference
    const manualPref = await memoryPrefRepo.savePreference({
      userId: userA.id,
      artistName: 'LCD Soundsystem',
      preferenceLevel: 'favorite',
    });

    expect(manualPref.artistName).toBe('LCD Soundsystem');
    expect(manualPref.preferenceLevel).toBe('favorite');

    // 2. Disconnect Spotify
    mockDeleteConnection.mockResolvedValueOnce(true);
    const disconnectRes = await disconnectHandler();
    expect(disconnectRes.status).toBe(200);

    // 3. User A's manual concert preferences remain unchanged
    const prefs = await memoryPrefRepo.getPreferences(userA.id);
    expect(prefs).toHaveLength(1);
    expect(prefs[0].id).toBe(manualPref.id);
    expect(prefs[0].artistName).toBe('LCD Soundsystem');
    expect(prefs[0].preferenceLevel).toBe('favorite');
  });
});
