import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeName } from '@/lib/domain/value-objects';
import {
  type PreferenceLevel,
  type SavePreferenceInput,
  type UserArtistPreference,
  VALID_PREFERENCE_LEVELS,
} from '@/lib/domain/user-preference';
import type { IUserPreferenceRepository } from './interfaces';

interface UserArtistPreferenceRow {
  id: string;
  user_id: string;
  artist_id: string | null;
  archived_artist_id: string | null;
  artist_name: string;
  normalized_artist_name: string;
  preference_level: PreferenceLevel;
  created_at: string;
  updated_at: string;
  artists?: {
    id: string;
    name: string;
    image_url: string | null;
  } | null;
}

function mapRowToDomain(row: UserArtistPreferenceRow): UserArtistPreference {
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
        }
      : null,
  };
}

export class SupabaseUserPreferenceRepository implements IUserPreferenceRepository {
  private client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async getPreferences(userId: string): Promise<UserArtistPreference[]> {
    if (!userId) return [];

    const { data, error } = await this.client
      .from('user_artist_preferences')
      .select('*, artists(id, name, image_url)')
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
      .select('*, artists(id, name, image_url)')
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

    if (input.artistId) {
      // 1. Explicit canonical artist association: validate against actual catalog
      const { data: canonicalArtist, error: lookupErr } = await this.client
        .from('artists')
        .select('id, name, normalized_name, image_url')
        .eq('id', input.artistId)
        .maybeSingle();

      if (lookupErr) {
        throw new Error(
          `Failed to verify canonical artist in catalog: ${lookupErr.message}`,
        );
      }
      if (!canonicalArtist) {
        throw new Error(
          `Invalid canonical artist ID: ${input.artistId} does not exist in catalog.`,
        );
      }

      // Authoritative attributes derived from verified catalog record
      const authoritativeName = canonicalArtist.name;
      const authoritativeNorm = canonicalArtist.normalized_name;

      // Check strictly for existing preference for this user with this exact canonical artist_id
      const { data: existing, error: checkError } = await this.client
        .from('user_artist_preferences')
        .select('id')
        .eq('user_id', input.userId)
        .eq('artist_id', input.artistId)
        .maybeSingle();

      if (checkError) {
        throw new Error(
          `Failed to check existing canonical preference: ${checkError.message}`,
        );
      }

      if (existing) {
        const { data: updated, error: updateError } = await this.client
          .from('user_artist_preferences')
          .update({
            preference_level: input.preferenceLevel,
            artist_name: authoritativeName,
            normalized_artist_name: authoritativeNorm,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select('*, artists(id, name, image_url)')
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
        })
        .select('*, artists(id, name, image_url)')
        .single();

      if (insertError) {
        throw new Error(
          `Failed to insert user preference: ${insertError.message}`,
        );
      }

      return mapRowToDomain(inserted as unknown as UserArtistPreferenceRow);
    }

    // 2. Uncataloged artist entry: store with artist_id = null and archived_artist_id = null
    const normalizedName = normalizeName(rawArtistName);

    const { data: existingUnresolved, error: checkUnresolvedError } =
      await this.client
        .from('user_artist_preferences')
        .select('id')
        .eq('user_id', input.userId)
        .is('artist_id', null)
        .is('archived_artist_id', null)
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
        .select('*, artists(id, name, image_url)')
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
      })
      .select('*, artists(id, name, image_url)')
      .single();

    if (insertError) {
      throw new Error(
        `Failed to insert uncataloged user preference: ${insertError.message}`,
      );
    }

    return mapRowToDomain(inserted as unknown as UserArtistPreferenceRow);
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
