/**
 * Phase 2 User Music Preference Domain Types
 * Defines explicit user artist preferences with catalog independence.
 * Invariant: Manual live-attendance preferences are strictly isolated from Spotify listening signals.
 */

export type PreferenceLevel = 'favorite' | 'like' | 'interested' | 'dislike';

export const VALID_PREFERENCE_LEVELS: readonly PreferenceLevel[] = [
  'favorite',
  'like',
  'interested',
  'dislike',
] as const;

export interface CanonicalArtistSummary {
  id: string;
  name: string;
  imageUrl?: string | null;
  spotifyArtistId?: string | null;
}

export interface UserArtistPreference {
  id: string;
  userId: string;
  artistId: string | null;
  archivedArtistId?: string | null;
  artistName: string;
  normalizedArtistName: string;
  preferenceLevel: PreferenceLevel;
  createdAt: string;
  updatedAt: string;
  canonicalArtist?: CanonicalArtistSummary | null;
  spotifyArtistId?: string | null;
}

export interface SavePreferenceInput {
  userId: string;
  artistId?: string | null;
  artistName: string;
  preferenceLevel: PreferenceLevel;
  spotifyArtistId?: string | null;
}

export class InvalidCatalogArtistError extends Error {
  readonly artistId: string;

  constructor(artistId: string) {
    super('Selected artist does not exist in the concert catalog.');
    this.name = 'InvalidCatalogArtistError';
    this.artistId = artistId;
    Object.setPrototypeOf(this, InvalidCatalogArtistError.prototype);
  }
}

export class ConflictingArtistIdentityError extends Error {
  readonly artistId?: string | null;
  readonly spotifyArtistId?: string | null;

  constructor(
    message: string = 'Supplied Spotify artist identity conflicts with catalog artist identity.',
    artistId?: string | null,
    spotifyArtistId?: string | null,
  ) {
    super(message);
    this.name = 'ConflictingArtistIdentityError';
    this.artistId = artistId;
    this.spotifyArtistId = spotifyArtistId;
    Object.setPrototypeOf(this, ConflictingArtistIdentityError.prototype);
  }
}
