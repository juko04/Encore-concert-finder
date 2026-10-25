/**
 * Supabase User Profile Repository
 * Manages user profile data, budget thresholds, travel parameters,
 * and recommendation preset configuration.
 * Protected by Row Level Security (auth.uid() = id).
 */

import { type SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import type {
  RecommendationPreset,
  UserProfile,
  UserProfileUpdateInput,
} from '@/lib/domain/profile';
import type { IProfileRepository } from './interfaces';

interface ProfileRow {
  id: string;
  created_at: string;
  updated_at: string;
  home_lat_approx: number | string | null;
  home_lng_approx: number | string | null;
  default_radius_miles: number | null;
  max_spontaneous_price: number | string | null;
  max_normal_ticket_price: number | string | null;
  max_favorite_artist_price: number | string | null;
  travel_willingness: string | null;
  recommendation_preset?: string | null;
}

function mapProfileRow(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    homeLatApprox:
      row.home_lat_approx !== null && row.home_lat_approx !== undefined
        ? Number(row.home_lat_approx)
        : null,
    homeLngApprox:
      row.home_lng_approx !== null && row.home_lng_approx !== undefined
        ? Number(row.home_lng_approx)
        : null,
    defaultRadiusMiles:
      row.default_radius_miles !== null &&
      row.default_radius_miles !== undefined
        ? Number(row.default_radius_miles)
        : 25,
    maxSpontaneousPrice:
      row.max_spontaneous_price !== null &&
      row.max_spontaneous_price !== undefined
        ? Number(row.max_spontaneous_price)
        : null,
    maxNormalTicketPrice:
      row.max_normal_ticket_price !== null &&
      row.max_normal_ticket_price !== undefined
        ? Number(row.max_normal_ticket_price)
        : null,
    maxFavoriteArtistPrice:
      row.max_favorite_artist_price !== null &&
      row.max_favorite_artist_price !== undefined
        ? Number(row.max_favorite_artist_price)
        : null,
    travelWillingness: row.travel_willingness ?? null,
    recommendationPreset:
      (row.recommendation_preset as RecommendationPreset) || 'balanced',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SupabaseProfileRepository implements IProfileRepository {
  private clientPromise?: Promise<SupabaseClient>;
  private explicitClient?: SupabaseClient;

  constructor(client?: SupabaseClient) {
    if (client) {
      this.explicitClient = client;
    }
  }

  private async getClient(): Promise<SupabaseClient> {
    if (this.explicitClient) {
      return this.explicitClient;
    }
    if (!this.clientPromise) {
      this.clientPromise = createClient();
    }
    return this.clientPromise;
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    const client = await this.getClient();
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch user profile: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    return mapProfileRow(data as ProfileRow);
  }

  async upsertProfile(
    userId: string,
    input: UserProfileUpdateInput,
  ): Promise<UserProfile> {
    const client = await this.getClient();

    const rowPayload: Record<string, unknown> = {
      id: userId,
      updated_at: new Date().toISOString(),
    };

    if (input.homeLatApprox !== undefined) {
      rowPayload.home_lat_approx = input.homeLatApprox;
    }
    if (input.homeLngApprox !== undefined) {
      rowPayload.home_lng_approx = input.homeLngApprox;
    }
    if (input.defaultRadiusMiles !== undefined) {
      rowPayload.default_radius_miles = input.defaultRadiusMiles;
    }
    if (input.maxSpontaneousPrice !== undefined) {
      rowPayload.max_spontaneous_price = input.maxSpontaneousPrice;
    }
    if (input.maxNormalTicketPrice !== undefined) {
      rowPayload.max_normal_ticket_price = input.maxNormalTicketPrice;
    }
    if (input.maxFavoriteArtistPrice !== undefined) {
      rowPayload.max_favorite_artist_price = input.maxFavoriteArtistPrice;
    }
    if (input.travelWillingness !== undefined) {
      rowPayload.travel_willingness = input.travelWillingness;
    }
    if (input.recommendationPreset !== undefined) {
      rowPayload.recommendation_preset = input.recommendationPreset;
    }

    const { data, error } = await client
      .from('profiles')
      .upsert(rowPayload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to upsert user profile: ${error.message}`);
    }

    return mapProfileRow(data as ProfileRow);
  }

  async updatePreset(
    userId: string,
    preset: RecommendationPreset,
  ): Promise<UserProfile> {
    return this.upsertProfile(userId, { recommendationPreset: preset });
  }
}
