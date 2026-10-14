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
    const artistName = input.artistName?.trim();
    if (!artistName) {
      throw new Error('Artist name must not be empty');
    }
    if (!VALID_PREFERENCE_LEVELS.includes(input.preferenceLevel)) {
      throw new Error(`Invalid preference level: ${input.preferenceLevel}`);
    }

    const normalizedName = normalizeName(artistName);

    // 1. Check for existing preference for this user
    let existingId: string | null = null;
    let existingArtistId: string | null = null;

    if (input.artistId) {
      // Check for canonical match first
      const { data: byArtistId, error: checkError1 } = await this.client
        .from('user_artist_preferences')
        .select('id, artist_id')
        .eq('user_id', input.userId)
        .eq('artist_id', input.artistId)
        .maybeSingle();

      if (checkError1) {
        throw new Error(
          `Failed to check existing preference: ${checkError1.message}`,
        );
      }

      if (byArtistId) {
        existingId = byArtistId.id;
        existingArtistId = byArtistId.artist_id;
      } else {
        // Also check if an uncataloged row with the same normalized name exists to upgrade
        const { data: byName, error: checkError2 } = await this.client
          .from('user_artist_preferences')
          .select('id, artist_id')
          .eq('user_id', input.userId)
          .is('artist_id', null)
          .eq('normalized_artist_name', normalizedName)
          .maybeSingle();

        if (checkError2) {
          throw new Error(
            `Failed to check existing preference by name: ${checkError2.message}`,
          );
        }

        if (byName) {
          existingId = byName.id;
          existingArtistId = byName.artist_id;
        }
      }
    } else {
      // Searching for uncataloged preference by normalized name
      const { data: byName, error: checkError } = await this.client
        .from('user_artist_preferences')
        .select('id, artist_id')
        .eq('user_id', input.userId)
        .is('artist_id', null)
        .eq('normalized_artist_name', normalizedName)
        .maybeSingle();

      if (checkError) {
        throw new Error(
          `Failed to check existing preference: ${checkError.message}`,
        );
      }

      if (byName) {
        existingId = byName.id;
        existingArtistId = byName.artist_id;
      }
    }

    // 2. Update if existing, or insert if new
    if (existingId) {
      const { data: updated, error: updateError } = await this.client
        .from('user_artist_preferences')
        .update({
          preference_level: input.preferenceLevel,
          artist_id: input.artistId ?? existingArtistId,
          artist_name: artistName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingId)
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
        artist_id: input.artistId || null,
        artist_name: artistName,
        normalized_artist_name: normalizedName,
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
