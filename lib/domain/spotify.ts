/**
 * Phase 2, PR #10 Spotify Domain Types & Errors
 * Invariants:
 * - One-to-one mapping between Spotify account and Encore user.
 * - Explicit user preferences remain authoritative; Spotify listening history is not stored as synthetic live preferences.
 */

export type SpotifyConnectionStatus =
  'connected' | 'expired' | 'disconnected' | 'revoked';

export type SpotifyTimeRange = 'short_term' | 'medium_term' | 'long_term';

export const VALID_SPOTIFY_TIME_RANGES: readonly SpotifyTimeRange[] = [
  'short_term',
  'medium_term',
  'long_term',
] as const;

export interface SpotifyConnection {
  userId: string;
  spotifyAccountId: string;
  status: SpotifyConnectionStatus;
  tokenExpiresAt: string;
  reauthorizationDeadline: string;
  scopes: string[];
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveSpotifyConnectionInput {
  userId: string;
  spotifyAccountId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  reauthorizationDeadline: Date;
  scopes: string[];
}

export interface UpdateSpotifyTokensInput {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt: Date;
  reauthorizationDeadline?: Date;
}

export interface SpotifyTopArtist {
  id: string; // Spotify artist ID
  name: string;
  rank: number;
  imageUrl: string | null;
  spotifyUrl: string;
  genres: string[];
  popularity: number;
  trend?: 'rising' | 'consistent' | 'fading';
  timeRange: SpotifyTimeRange;
}

export interface SpotifyUserProfile {
  accountId: string;
  displayName: string | null;
  email?: string | null;
  uri?: string;
  product?: string;
}

// ---------------------------------------------------------------------------
// Domain Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when an attempt is made to link a Spotify account that is already
 * associated with another Encore user account.
 */
export class SpotifyAccountConflictError extends Error {
  readonly spotifyAccountId: string;

  constructor(spotifyAccountId: string) {
    super(
      'This Spotify account is already linked to another Encore account. Please disconnect it first or connect a different Spotify account.',
    );
    this.name = 'SpotifyAccountConflictError';
    this.spotifyAccountId = spotifyAccountId;
    Object.setPrototypeOf(this, SpotifyAccountConflictError.prototype);
  }
}

/**
 * Thrown when Spotify API access fails due to invalid/expired credentials or token revocation.
 */
export class SpotifyAuthenticationError extends Error {
  constructor(message = 'Spotify authorization expired or is invalid.') {
    super(message);
    this.name = 'SpotifyAuthenticationError';
    Object.setPrototypeOf(this, SpotifyAuthenticationError.prototype);
  }
}

/**
 * Thrown when Spotify returns HTTP 403 (e.g. Developer Mode allowlist restriction).
 */
export class SpotifyForbiddenError extends Error {
  constructor(
    message = 'Access to the Spotify application is restricted to allowlisted beta users in Development Mode.',
  ) {
    super(message);
    this.name = 'SpotifyForbiddenError';
    Object.setPrototypeOf(this, SpotifyForbiddenError.prototype);
  }
}

/**
 * Thrown when Spotify returns HTTP 429 with rate limit or quota exceeded.
 */
export class SpotifyRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  readonly isQuotaExceeded: boolean;

  constructor(retryAfterSeconds = 5, isQuotaExceeded = false) {
    super(
      isQuotaExceeded
        ? 'Spotify development API quota exceeded. Please try again later.'
        : `Spotify rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`,
    );
    this.name = 'SpotifyRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
    this.isQuotaExceeded = isQuotaExceeded;
    Object.setPrototypeOf(this, SpotifyRateLimitError.prototype);
  }
}

/**
 * Thrown when Spotify integration is requested but disabled via environment configuration.
 */
export class SpotifyFeatureDisabledError extends Error {
  constructor(
    message = 'Spotify integration is not enabled in this environment.',
  ) {
    super(message);
    this.name = 'SpotifyFeatureDisabledError';
    Object.setPrototypeOf(this, SpotifyFeatureDisabledError.prototype);
  }
}
