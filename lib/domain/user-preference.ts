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
}

export interface SavePreferenceInput {
  userId: string;
  artistId?: string | null;
  artistName: string;
  preferenceLevel: PreferenceLevel;
}
