import {
  type SpotifyTimeRange,
  type SpotifyTopArtist,
  type SpotifyUserProfile,
  SpotifyAuthenticationError,
  SpotifyForbiddenError,
  SpotifyRateLimitError,
  VALID_SPOTIFY_TIME_RANGES,
} from '@/lib/domain/spotify';
import { SPOTIFY_TOKEN_ENDPOINT } from './oauth';

export const SPOTIFY_API_BASE_URL = 'https://api.spotify.com/v1';

export interface SpotifyTokenExchangeResult {
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  reauthorizationDeadline: Date;
  scopes: string[];
}

export interface SpotifyTokenRefreshResult {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt: Date;
  scopes?: string[];
}

export interface SpotifyClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchFn?: typeof fetch;
}

export class SpotifyApiClient {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private fetchFn: typeof fetch;

  constructor(config: SpotifyClientConfig) {
    if (!config.clientId || !config.clientId.trim()) {
      throw new Error('SpotifyApiClient requires a valid clientId.');
    }
    if (!config.clientSecret || !config.clientSecret.trim()) {
      throw new Error('SpotifyApiClient requires a valid clientSecret.');
    }
    if (!config.redirectUri || !config.redirectUri.trim()) {
      throw new Error('SpotifyApiClient requires a valid redirectUri.');
    }

    this.clientId = config.clientId.trim();
    this.clientSecret = config.clientSecret.trim();
    this.redirectUri = config.redirectUri.trim();
    this.fetchFn = config.fetchFn ?? fetch;
  }

  private getBasicAuthHeader(): string {
    const creds = `${this.clientId}:${this.clientSecret}`;
    return `Basic ${Buffer.from(creds).toString('base64')}`;
  }

  private parseRetryAfter(res: Response): number {
    const header = res.headers.get('Retry-After');
    if (!header) return 5;
    const parsed = Number.parseInt(header, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
  }

  /**
   * Exchanges an authorization code and PKCE code verifier for OAuth access and refresh tokens.
   */
  async exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
  ): Promise<SpotifyTokenExchangeResult> {
    if (!code || !code.trim()) {
      throw new Error('Authorization code is required.');
    }
    if (!codeVerifier || !codeVerifier.trim()) {
      throw new Error('Code verifier is required.');
    }

    const bodyParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code.trim(),
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      code_verifier: codeVerifier.trim(),
    });

    const response = await this.fetchFn(SPOTIFY_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: this.getBasicAuthHeader(),
      },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new SpotifyAuthenticationError(
          'Failed to exchange Spotify authorization code: invalid client credentials or expired code.',
        );
      }
      if (response.status === 429) {
        const retryAfter = this.parseRetryAfter(response);
        throw new SpotifyRateLimitError(retryAfter);
      }
      const errText = await response.text().catch(() => '');
      throw new Error(
        `Spotify token exchange failed with status ${response.status}: ${errText}`,
      );
    }

    const data = await response.json();
    if (!data.access_token || !data.refresh_token) {
      throw new Error(
        'Spotify token response missing access_token or refresh_token.',
      );
    }

    const expiresInSec =
      typeof data.expires_in === 'number' ? data.expires_in : 3600;
    // Apply 60s buffer for clock skew
    const tokenExpiresAt = new Date(Date.now() + (expiresInSec - 60) * 1000);
    // 6-month reauthorization deadline (180 days)
    const reauthorizationDeadline = new Date(Date.now() + 180 * 86400 * 1000);
    const scopes = typeof data.scope === 'string' ? data.scope.split(' ') : [];

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt,
      reauthorizationDeadline,
      scopes,
    };
  }

  /**
   * Refreshes an expired access token using the stored refresh token.
   */
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<SpotifyTokenRefreshResult> {
    if (!refreshToken || !refreshToken.trim()) {
      throw new Error('Refresh token is required.');
    }

    const bodyParams = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken.trim(),
      client_id: this.clientId,
    });

    const response = await this.fetchFn(SPOTIFY_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: this.getBasicAuthHeader(),
      },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        throw new SpotifyAuthenticationError(
          'Spotify refresh token is revoked or invalid. User reauthorization required.',
        );
      }
      if (response.status === 429) {
        const retryAfter = this.parseRetryAfter(response);
        throw new SpotifyRateLimitError(retryAfter);
      }
      const errText = await response.text().catch(() => '');
      throw new Error(
        `Spotify token refresh failed with status ${response.status}: ${errText}`,
      );
    }

    const data = await response.json();
    if (!data.access_token) {
      throw new Error('Spotify token refresh response missing access_token.');
    }

    const expiresInSec =
      typeof data.expires_in === 'number' ? data.expires_in : 3600;
    const tokenExpiresAt = new Date(Date.now() + (expiresInSec - 60) * 1000);
    const scopes =
      typeof data.scope === 'string' ? data.scope.split(' ') : undefined;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token, // Spotify may optionally issue a rolling refresh token
      tokenExpiresAt,
      scopes,
    };
  }

  /**
   * Retrieves the current user's profile, extracting stable account_id.
   */
  async getCurrentUser(accessToken: string): Promise<SpotifyUserProfile> {
    if (!accessToken || !accessToken.trim()) {
      throw new Error('Access token is required.');
    }

    const response = await this.fetchFn(`${SPOTIFY_API_BASE_URL}/me`, {
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new SpotifyAuthenticationError();
      }
      if (response.status === 403) {
        throw new SpotifyForbiddenError();
      }
      if (response.status === 429) {
        const retryAfter = this.parseRetryAfter(response);
        throw new SpotifyRateLimitError(retryAfter);
      }
      const errText = await response.text().catch(() => '');
      throw new Error(
        `Failed to fetch Spotify user profile: ${response.status} ${errText}`,
      );
    }

    const data = await response.json();
    // Authoritative preference for account_id over id per requirements
    const accountId = data.account_id || data.id;
    if (!accountId) {
      throw new Error(
        'Spotify user profile did not return an account ID or user ID.',
      );
    }

    return {
      accountId,
      displayName: data.display_name ?? null,
      email: data.email ?? null,
      uri: data.uri,
      product: data.product,
    };
  }

  /**
   * Fetches top artists for a specified time range (short_term, medium_term, long_term).
   */
  async getTopArtists(
    accessToken: string,
    timeRange: SpotifyTimeRange,
    limit = 20,
  ): Promise<SpotifyTopArtist[]> {
    if (!accessToken || !accessToken.trim()) {
      throw new Error('Access token is required.');
    }
    if (!VALID_SPOTIFY_TIME_RANGES.includes(timeRange)) {
      throw new Error(
        `Invalid Spotify timeRange: ${timeRange}. Must be one of: ${VALID_SPOTIFY_TIME_RANGES.join(', ')}`,
      );
    }

    const clampedLimit = Math.max(1, Math.min(50, limit));
    const url = new URL(`${SPOTIFY_API_BASE_URL}/me/top/artists`);
    url.searchParams.set('time_range', timeRange);
    url.searchParams.set('limit', clampedLimit.toString());

    const response = await this.fetchFn(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new SpotifyAuthenticationError();
      }
      if (response.status === 403) {
        throw new SpotifyForbiddenError();
      }
      if (response.status === 429) {
        const retryAfter = this.parseRetryAfter(response);
        throw new SpotifyRateLimitError(retryAfter);
      }
      const errText = await response.text().catch(() => '');
      throw new Error(
        `Failed to fetch Spotify top artists: ${response.status} ${errText}`,
      );
    }

    const data = await response.json();
    const items: Array<{
      id: string;
      name: string;
      images?: Array<{ url: string }>;
      external_urls?: { spotify?: string };
      genres?: string[];
      popularity?: number;
    }> = Array.isArray(data.items) ? data.items : [];

    return items.map((item, index): SpotifyTopArtist => {
      const imageUrl =
        Array.isArray(item.images) && item.images.length > 0
          ? item.images[0].url
          : null;

      const spotifyUrl =
        item.external_urls?.spotify ||
        `https://open.spotify.com/artist/${item.id}`;

      return {
        id: item.id,
        name: item.name,
        rank: index + 1,
        imageUrl,
        spotifyUrl,
        genres: Array.isArray(item.genres) ? item.genres : [],
        popularity: typeof item.popularity === 'number' ? item.popularity : 0,
        timeRange,
      };
    });
  }
}
