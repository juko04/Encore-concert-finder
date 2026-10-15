import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type ISpotifyConnectionRepository,
  type SpotifyConnectionTokens,
} from './interfaces';
import {
  type SaveSpotifyConnectionInput,
  type SpotifyConnection,
  type SpotifyConnectionStatus,
  SpotifyAccountConflictError,
  type UpdateSpotifyTokensInput,
} from '@/lib/domain/spotify';
import { decryptSecret, encryptSecret } from '@/lib/security/crypto';

interface SpotifyConnectionRow {
  user_id: string;
  spotify_account_id: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string;
  token_expires_at: string;
  reauthorization_deadline: string;
  scopes: string[];
  status: SpotifyConnectionStatus;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToConnection(row: SpotifyConnectionRow): SpotifyConnection {
  return {
    userId: row.user_id,
    spotifyAccountId: row.spotify_account_id,
    status: row.status,
    tokenExpiresAt: row.token_expires_at,
    reauthorizationDeadline: row.reauthorization_deadline,
    scopes: row.scopes ?? [],
    lastSyncedAt: row.last_synced_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SupabaseSpotifyConnectionRepository implements ISpotifyConnectionRepository {
  private client: SupabaseClient;
  private encryptionKey: string;

  constructor(client: SupabaseClient, encryptionKey: string) {
    if (!encryptionKey || encryptionKey.length !== 64) {
      throw new Error(
        'SupabaseSpotifyConnectionRepository requires a valid 64-character hex encryption key.',
      );
    }
    this.client = client;
    this.encryptionKey = encryptionKey;
  }

  async getConnection(userId: string): Promise<SpotifyConnection | null> {
    if (!userId || !userId.trim()) return null;

    const { data, error } = await this.client
      .from('user_spotify_connections')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch Spotify connection: ${error.message}`);
    }

    return data ? mapRowToConnection(data as SpotifyConnectionRow) : null;
  }

  async getConnectionTokens(
    userId: string,
  ): Promise<SpotifyConnectionTokens | null> {
    if (!userId || !userId.trim()) return null;

    const { data, error } = await this.client
      .from('user_spotify_connections')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to fetch Spotify connection tokens: ${error.message}`,
      );
    }

    if (!data) return null;
    const row = data as SpotifyConnectionRow;

    if (row.status === 'disconnected' || row.status === 'revoked') {
      return null;
    }

    const accessToken = decryptSecret(
      row.encrypted_access_token,
      this.encryptionKey,
    );
    const refreshToken = decryptSecret(
      row.encrypted_refresh_token,
      this.encryptionKey,
    );

    return {
      accessToken,
      refreshToken,
      tokenExpiresAt: new Date(row.token_expires_at),
      reauthorizationDeadline: new Date(row.reauthorization_deadline),
      scopes: row.scopes ?? [],
    };
  }

  async findBySpotifyAccountId(
    spotifyAccountId: string,
  ): Promise<SpotifyConnection | null> {
    if (!spotifyAccountId || !spotifyAccountId.trim()) return null;

    const { data, error } = await this.client
      .from('user_spotify_connections')
      .select('*')
      .eq('spotify_account_id', spotifyAccountId.trim())
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to query Spotify connection by account ID: ${error.message}`,
      );
    }

    return data ? mapRowToConnection(data as SpotifyConnectionRow) : null;
  }

  async saveConnection(
    input: SaveSpotifyConnectionInput,
  ): Promise<SpotifyConnection> {
    if (!input.userId || !input.userId.trim()) {
      throw new Error('User ID is required');
    }
    const spotifyAccountId = input.spotifyAccountId?.trim();
    if (!spotifyAccountId) {
      throw new Error('Spotify account ID is required');
    }
    if (!input.accessToken || !input.refreshToken) {
      throw new Error('Access token and refresh token are required');
    }

    // 1. Explicit check: ensure this Spotify account is not already linked to another Encore user
    const existing = await this.findBySpotifyAccountId(spotifyAccountId);
    if (existing && existing.userId !== input.userId) {
      throw new SpotifyAccountConflictError(spotifyAccountId);
    }

    // 2. Encrypt token material before persistence
    const encryptedAccessToken = encryptSecret(
      input.accessToken,
      this.encryptionKey,
    );
    const encryptedRefreshToken = encryptSecret(
      input.refreshToken,
      this.encryptionKey,
    );

    const now = new Date().toISOString();

    const { data, error } = await this.client
      .from('user_spotify_connections')
      .upsert(
        {
          user_id: input.userId,
          spotify_account_id: spotifyAccountId,
          encrypted_access_token: encryptedAccessToken,
          encrypted_refresh_token: encryptedRefreshToken,
          token_expires_at: input.tokenExpiresAt.toISOString(),
          reauthorization_deadline: input.reauthorizationDeadline.toISOString(),
          scopes: input.scopes,
          status: 'connected',
          updated_at: now,
        },
        { onConflict: 'user_id' },
      )
      .select()
      .single();

    if (error) {
      // 23505 is PostgreSQL unique_violation code
      if (
        error.code === '23505' ||
        error.message?.includes('idx_user_spotify_connections_account_id') ||
        error.message?.includes('spotify_account_id')
      ) {
        throw new SpotifyAccountConflictError(spotifyAccountId);
      }
      throw new Error(`Failed to save Spotify connection: ${error.message}`);
    }

    return mapRowToConnection(data as SpotifyConnectionRow);
  }

  async updateTokens(
    userId: string,
    input: UpdateSpotifyTokensInput,
  ): Promise<SpotifyConnection> {
    if (!userId || !userId.trim()) {
      throw new Error('User ID is required');
    }
    if (!input.accessToken) {
      throw new Error('Access token is required');
    }

    const encryptedAccessToken = encryptSecret(
      input.accessToken,
      this.encryptionKey,
    );

    const updates: Record<string, unknown> = {
      encrypted_access_token: encryptedAccessToken,
      token_expires_at: input.tokenExpiresAt.toISOString(),
      status: 'connected',
      updated_at: new Date().toISOString(),
    };

    if (input.refreshToken) {
      updates.encrypted_refresh_token = encryptSecret(
        input.refreshToken,
        this.encryptionKey,
      );
    }
    if (input.reauthorizationDeadline) {
      updates.reauthorization_deadline =
        input.reauthorizationDeadline.toISOString();
    }

    const { data, error } = await this.client
      .from('user_spotify_connections')
      .update(updates)
      .eq('user_id', userId)
      .select()
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to update Spotify tokens: ${error.message}`);
    }
    if (!data) {
      throw new Error(`Spotify connection not found for user: ${userId}`);
    }

    return mapRowToConnection(data as SpotifyConnectionRow);
  }

  async updateStatus(
    userId: string,
    status: SpotifyConnectionStatus,
  ): Promise<void> {
    if (!userId || !userId.trim()) return;

    const { error } = await this.client
      .from('user_spotify_connections')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to update Spotify status: ${error.message}`);
    }
  }

  async recordSync(userId: string, syncedAt?: Date): Promise<void> {
    if (!userId || !userId.trim()) return;

    const syncDate = (syncedAt ?? new Date()).toISOString();

    const { error } = await this.client
      .from('user_spotify_connections')
      .update({
        last_synced_at: syncDate,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (error) {
      throw new Error(
        `Failed to record Spotify sync timestamp: ${error.message}`,
      );
    }
  }

  async deleteConnection(userId: string): Promise<boolean> {
    if (!userId || !userId.trim()) return false;

    const { error, count } = await this.client
      .from('user_spotify_connections')
      .delete({ count: 'exact' })
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to delete Spotify connection: ${error.message}`);
    }

    return (count ?? 0) > 0;
  }
}
