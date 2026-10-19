import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeName } from '@/lib/domain/value-objects';
import {
  ConflictingArtistIdentityError,
  InvalidCatalogArtistError,
  type PreferenceLevel,
  type SavePreferenceInput,
  type UserArtistPreference,
  VALID_PREFERENCE_LEVELS,
} from '@/lib/domain/user-preference';
import type { IUserPreferenceRepository } from './interfaces';

export { ConflictingArtistIdentityError };

interface UserArtistPreferenceRow {
  id: string;
  user_id: string;
  artist_id: string | null;
  archived_artist_id: string | null;
  artist_name: string;
  normalized_artist_name: string;
  preference_level: PreferenceLevel;
  spotify_artist_id?: string | null;
  created_at: string;
  updated_at: string;
  artists?: {
    id: string;
    name: string;
    image_url: string | null;
    artist_external_ids?: Array<{
      provider: string;
      external_id: string;
    }> | null;
  } | null;
}

function mapRowToDomain(row: UserArtistPreferenceRow): UserArtistPreference {
  const canonicalSpotifyExtId =
    row.artists?.artist_external_ids?.find((e) => e.provider === 'spotify')
      ?.external_id ?? null;
  const effectiveSpotifyArtistId =
    row.spotify_artist_id ?? canonicalSpotifyExtId;

  return {
    id: row.id,
    userId: row.user_id,
    artistId: row.artist_id,
    archivedArtistId: row.archived_artist_id ?? null,
    artistName: row.artist_name,
    normalizedArtistName: row.normalized_artist_name,
    preferenceLevel: row.preference_level,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canonicalArtist: row.artists
      ? {
          id: row.artists.id,
          name: row.artists.name,
          imageUrl: row.artists.image_url,
          spotifyArtistId: canonicalSpotifyExtId ?? effectiveSpotifyArtistId,
        }
      : null,
    spotifyArtistId: effectiveSpotifyArtistId,
  };
}

const PREFERENCE_SELECT_QUERY =
  '*, artists(id, name, image_url, artist_external_ids(provider, external_id))';

export class SupabaseUserPreferenceRepository implements IUserPreferenceRepository {
  private client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async getPreferences(userId: string): Promise<UserArtistPreference[]> {
    if (!userId) return [];

    const { data, error } = await this.client
      .from('user_artist_preferences')
      .select(PREFERENCE_SELECT_QUERY)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch user preferences: ${error.message}`);
    }

    return ((data as unknown as UserArtistPreferenceRow[]) || []).map(
      mapRowToDomain,
    );
  }

  async getPreference(
    userId: string,
    preferenceId: string,
  ): Promise<UserArtistPreference | null> {
    if (!userId || !preferenceId) return null;

    const { data, error } = await this.client
      .from('user_artist_preferences')
      .select(PREFERENCE_SELECT_QUERY)
      .eq('id', preferenceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch user preference: ${error.message}`);
    }

    return data
      ? mapRowToDomain(data as unknown as UserArtistPreferenceRow)
      : null;
  }

  async savePreference(
    input: SavePreferenceInput,
  ): Promise<UserArtistPreference> {
    if (!input.userId || !input.userId.trim()) {
      throw new Error('User ID is required');
    }
    const rawArtistName = input.artistName?.trim();
    if (!rawArtistName) {
      throw new Error('Artist name must not be empty');
    }
    if (!VALID_PREFERENCE_LEVELS.includes(input.preferenceLevel)) {
      throw new Error(`Invalid preference level: ${input.preferenceLevel}`);
    }

    const trimmedSpotifyId = input.spotifyArtistId?.trim() || null;

    // 1. Explicit canonical artist ID provided (e.g. user selected from catalog search dropdown)
    if (input.artistId) {
      const { data: canonicalArtist, error: lookupErr } = await this.client
        .from('artists')
        .select('id, name, normalized_name, image_url')
        .eq('id', input.artistId)
        .maybeSingle();

      if (lookupErr) {
        throw new Error(
          `Failed to verify canonical artist in database: ${lookupErr.message}`,
        );
      }
      if (!canonicalArtist) {
        throw new InvalidCatalogArtistError(input.artistId);
      }

      const authoritativeName = canonicalArtist.name;
      const authoritativeNorm = canonicalArtist.normalized_name;

      // Find all external IDs mapped to this canonical artist
      const { data: canonicalExtIds, error: extErr } = await this.client
        .from('artist_external_ids')
        .select('provider, external_id')
        .eq('artist_id', input.artistId);

      if (extErr) {
        throw new Error(
          `Failed to check artist external IDs: ${extErr.message}`,
        );
      }

      const canonicalSpotifyExtId =
        canonicalExtIds?.find((e) => e.provider === 'spotify')?.external_id ??
        null;

      if (trimmedSpotifyId) {
        const { data: mappedToArtist, error: mapErr } = await this.client
          .from('artist_external_ids')
          .select('artist_id')
          .eq('provider', 'spotify')
          .eq('external_id', trimmedSpotifyId)
          .maybeSingle();

        if (mapErr) {
          throw new Error(
            `Failed to verify external ID mapping: ${mapErr.message}`,
          );
        }

        if (mappedToArtist && mappedToArtist.artist_id !== input.artistId) {
          throw new ConflictingArtistIdentityError(
            `Supplied Spotify artist ID '${trimmedSpotifyId}' is mapped to a different canonical artist ('${mappedToArtist.artist_id}') than '${input.artistId}'.`,
            input.artistId,
            trimmedSpotifyId,
          );
        }

        if (
          canonicalSpotifyExtId &&
          canonicalSpotifyExtId !== trimmedSpotifyId
        ) {
          throw new ConflictingArtistIdentityError(
            `Canonical artist '${input.artistId}' is already mapped to Spotify artist '${canonicalSpotifyExtId}', which conflicts with supplied Spotify artist '${trimmedSpotifyId}'.`,
            input.artistId,
            trimmedSpotifyId,
          );
        }

        if (!mappedToArtist && !canonicalSpotifyExtId) {
          throw new ConflictingArtistIdentityError(
            `Supplied Spotify artist ID '${trimmedSpotifyId}' cannot be verified against canonical artist '${input.artistId}' via trusted external-ID mappings.`,
            input.artistId,
            trimmedSpotifyId,
          );
        }
      }

      // Check strictly for existing preference for this user with this exact canonical artist_id
      const { data: existingByArtist, error: checkError } = await this.client
        .from('user_artist_preferences')
        .select('id, spotify_artist_id')
        .eq('user_id', input.userId)
        .eq('artist_id', input.artistId)
        .maybeSingle();

      if (checkError) {
        throw new Error(
          `Failed to check existing canonical preference: ${checkError.message}`,
        );
      }

      let existing = existingByArtist;
      const targetSpotifyIdToCheck = trimmedSpotifyId ?? canonicalSpotifyExtId;

      if (!existing && targetSpotifyIdToCheck) {
        const { data: existingBySpotify } = await this.client
          .from('user_artist_preferences')
          .select('id, spotify_artist_id')
          .eq('user_id', input.userId)
          .eq('spotify_artist_id', targetSpotifyIdToCheck)
          .maybeSingle();

        if (existingBySpotify) {
          existing = existingBySpotify;
        }
      }

      // Preserve existing Spotify artist ID if catalog search did not supply a new provider ID
      const finalSpotifyArtistId =
        trimmedSpotifyId ??
        existing?.spotify_artist_id ??
        canonicalSpotifyExtId ??
        null;

      if (existing) {
        const { data: updated, error: updateError } = await this.client
          .from('user_artist_preferences')
          .update({
            artist_id: input.artistId,
            preference_level: input.preferenceLevel,
            artist_name: authoritativeName,
            normalized_artist_name: authoritativeNorm,
            spotify_artist_id: finalSpotifyArtistId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select(PREFERENCE_SELECT_QUERY)
          .single();

        if (updateError) {
          throw new Error(
            `Failed to update user preference: ${updateError.message}`,
          );
        }

        return mapRowToDomain(updated as unknown as UserArtistPreferenceRow);
      }

      const { data: inserted, error: insertError } = await this.client
        .from('user_artist_preferences')
        .insert({
          user_id: input.userId,
          artist_id: input.artistId,
          archived_artist_id: null,
          artist_name: authoritativeName,
          normalized_artist_name: authoritativeNorm,
          preference_level: input.preferenceLevel,
          spotify_artist_id: finalSpotifyArtistId,
        })
        .select(PREFERENCE_SELECT_QUERY)
        .single();

      if (insertError) {
        throw new Error(
          `Failed to insert user preference: ${insertError.message}`,
        );
      }

      return mapRowToDomain(inserted as unknown as UserArtistPreferenceRow);
    }

    // 2. Explicit Spotify Artist ID provided (e.g. from Spotify top artists import)
    if (trimmedSpotifyId) {
      // 2a. Check if authoritative external-ID mapping exists in Encore's catalog
      let matchedCanonicalArtistId: string | null = null;
      let authoritativeName = rawArtistName;
      let authoritativeNorm = normalizeName(rawArtistName);

      const { data: extMapping, error: extLookupErr } = await this.client
        .from('artist_external_ids')
        .select('artist_id, artists(id, name, normalized_name, image_url)')
        .eq('provider', 'spotify')
        .eq('external_id', trimmedSpotifyId)
        .maybeSingle();

      if (extLookupErr) {
        throw new Error(
          `Failed to check artist external ID: ${extLookupErr.message}`,
        );
      }

      if (extMapping?.artists) {
        matchedCanonicalArtistId = extMapping.artist_id;
        const artistRecord = extMapping.artists as unknown as {
          id: string;
          name: string;
          normalized_name: string;
        };
        authoritativeName = artistRecord.name;
        authoritativeNorm = artistRecord.normalized_name;
      }

      // 2b. Check if user already has a preference for this Spotify artist ID
      let existingPrefId: string | null = null;
      const { data: existingSpotifyPref, error: spotifyPrefError } =
        await this.client
          .from('user_artist_preferences')
          .select('id')
          .eq('user_id', input.userId)
          .eq('spotify_artist_id', trimmedSpotifyId)
          .maybeSingle();

      if (spotifyPrefError) {
        throw new Error(
          `Failed to check existing Spotify preference: ${spotifyPrefError.message}`,
        );
      }

      if (existingSpotifyPref) {
        existingPrefId = existingSpotifyPref.id;
      } else if (matchedCanonicalArtistId) {
        // Also check if user already had a preference for this canonical artist without spotify_artist_id
        const { data: existingCanonicalPref } = await this.client
          .from('user_artist_preferences')
          .select('id')
          .eq('user_id', input.userId)
          .eq('artist_id', matchedCanonicalArtistId)
          .maybeSingle();

        if (existingCanonicalPref) {
          existingPrefId = existingCanonicalPref.id;
        }
      }

      if (existingPrefId) {
        const { data: updated, error: updateError } = await this.client
          .from('user_artist_preferences')
          .update({
            preference_level: input.preferenceLevel,
            artist_id: matchedCanonicalArtistId,
            artist_name: authoritativeName,
            normalized_artist_name: authoritativeNorm,
            spotify_artist_id: trimmedSpotifyId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingPrefId)
          .select(PREFERENCE_SELECT_QUERY)
          .single();

        if (updateError) {
          throw new Error(
            `Failed to update Spotify user preference: ${updateError.message}`,
          );
        }

        return mapRowToDomain(updated as unknown as UserArtistPreferenceRow);
      }

      // Insert new preference for this Spotify artist
      const { data: inserted, error: insertError } = await this.client
        .from('user_artist_preferences')
        .insert({
          user_id: input.userId,
          artist_id: matchedCanonicalArtistId,
          archived_artist_id: null,
          artist_name: authoritativeName,
          normalized_artist_name: authoritativeNorm,
          preference_level: input.preferenceLevel,
          spotify_artist_id: trimmedSpotifyId,
        })
        .select(PREFERENCE_SELECT_QUERY)
        .single();

      if (insertError) {
        throw new Error(
          `Failed to insert Spotify user preference: ${insertError.message}`,
        );
      }

      return mapRowToDomain(inserted as unknown as UserArtistPreferenceRow);
    }

    // 3. Uncataloged free-text artist entry: store with artist_id = null and spotify_artist_id = null
    const normalizedName = normalizeName(rawArtistName);

    const { data: existingUnresolved, error: checkUnresolvedError } =
      await this.client
        .from('user_artist_preferences')
        .select('id')
        .eq('user_id', input.userId)
        .is('artist_id', null)
        .is('archived_artist_id', null)
        .is('spotify_artist_id', null)
        .eq('normalized_artist_name', normalizedName)
        .maybeSingle();

    if (checkUnresolvedError) {
      throw new Error(
        `Failed to check existing uncataloged preference: ${checkUnresolvedError.message}`,
      );
    }

    if (existingUnresolved) {
      const { data: updated, error: updateError } = await this.client
        .from('user_artist_preferences')
        .update({
          preference_level: input.preferenceLevel,
          artist_name: rawArtistName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingUnresolved.id)
        .select(PREFERENCE_SELECT_QUERY)
        .single();

      if (updateError) {
        throw new Error(
          `Failed to update uncataloged user preference: ${updateError.message}`,
        );
      }

      return mapRowToDomain(updated as unknown as UserArtistPreferenceRow);
    }

    const { data: inserted, error: insertError } = await this.client
      .from('user_artist_preferences')
      .insert({
        user_id: input.userId,
        artist_id: null,
        archived_artist_id: null,
        artist_name: rawArtistName,
        normalized_artist_name: normalizedName,
        preference_level: input.preferenceLevel,
        spotify_artist_id: null,
      })
      .select(PREFERENCE_SELECT_QUERY)
      .single();

    if (insertError) {
      throw new Error(
        `Failed to insert uncataloged user preference: ${insertError.message}`,
      );
    }

    return mapRowToDomain(inserted as unknown as UserArtistPreferenceRow);
  }

  async updatePreferenceLevel(
    userId: string,
    preferenceId: string,
    preferenceLevel: PreferenceLevel,
  ): Promise<UserArtistPreference> {
    if (!userId || !userId.trim()) {
      throw new Error('User ID is required');
    }
    if (!preferenceId || !preferenceId.trim()) {
      throw new Error('Preference ID is required');
    }
    if (!VALID_PREFERENCE_LEVELS.includes(preferenceLevel)) {
      throw new Error(`Invalid preference level: ${preferenceLevel}`);
    }

    const { data, error } = await this.client
      .from('user_artist_preferences')
      .update({
        preference_level: preferenceLevel,
        updated_at: new Date().toISOString(),
      })
      .eq('id', preferenceId)
      .eq('user_id', userId)
      .select(PREFERENCE_SELECT_QUERY)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to update user preference: ${error.message}`);
    }
    if (!data) {
      throw new Error(`Preference not found: ${preferenceId}`);
    }

    return mapRowToDomain(data as unknown as UserArtistPreferenceRow);
  }

  async deletePreference(
    userId: string,
    preferenceId: string,
  ): Promise<boolean> {
    if (!userId || !preferenceId) return false;

    const { error, count } = await this.client
      .from('user_artist_preferences')
      .delete({ count: 'exact' })
      .eq('id', preferenceId)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to delete user preference: ${error.message}`);
    }

    return (count ?? 0) > 0;
  }
}
