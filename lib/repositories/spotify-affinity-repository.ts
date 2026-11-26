/**
 * Durable storage for Spotify-derived artist rankings/affinities (user_spotify_artist_affinities).
 *
 * Invariants:
 * - Separate from user_spotify_connections: disconnecting Spotify deletes tokens only, never these rows.
 * - Never touches user_artist_preferences (explicit manual preferences stay authoritative).
 * - Rows are removed only by account deletion (auth.users cascade) or an explicit clear.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SpotifyTimeRange, SpotifyTopArtist } from '@/lib/domain/spotify';

export interface ISpotifyAffinityRepository {
  /** Replaces the user's stored snapshot with the given artists (upsert + prune stale). */
  replaceAffinities(
    userId: string,
    artists: SpotifyTopArtist[],
    syncedAt?: Date,
  ): Promise<number>;
  getAffinities(userId: string): Promise<SpotifyTopArtist[]>;
  clearAffinities(userId: string): Promise<void>;
}

interface AffinityRow {
  user_id: string;
  spotify_artist_id: string;
  artist_name: string;
  canonical_artist_id: string | null;
  rank: number;
  ranks_by_range: Partial<Record<SpotifyTimeRange, number>> | null;
  affinity: number | string | null;
  affinity_reason: string | null;
  trend: 'rising' | 'consistent' | 'fading' | null;
  popularity: number | null;
  genres: string[] | null;
  image_url: string | null;
  spotify_url: string | null;
  synced_at: string;
}

export function mapAffinityRowToArtist(row: AffinityRow): SpotifyTopArtist {
  const ranks = row.ranks_by_range ?? {};
  return {
    id: row.spotify_artist_id,
    name: row.artist_name,
    rank: row.rank,
    imageUrl: row.image_url,
    spotifyUrl: row.spotify_url ?? '',
    genres: row.genres ?? [],
    popularity: row.popularity ?? 0,
    trend: row.trend ?? undefined,
    timeRange: ranks.short_term ? 'short_term' : 'medium_term',
    canonicalArtistId: row.canonical_artist_id,
    ranksByRange: ranks,
    syncedAt: row.synced_at,
    affinity:
      row.affinity === null || row.affinity === undefined
        ? undefined
        : Number(row.affinity),
    affinityReason: row.affinity_reason ?? undefined,
  };
}

export class SupabaseSpotifyAffinityRepository implements ISpotifyAffinityRepository {
  constructor(private readonly client: SupabaseClient) {}

  async replaceAffinities(
    userId: string,
    artists: SpotifyTopArtist[],
    syncedAt: Date = new Date(),
  ): Promise<number> {
    if (!userId || !userId.trim()) return 0;
    // An empty snapshot must never wipe previously stored listening data.
    if (artists.length === 0) return 0;

    const nowIso = new Date().toISOString();
    const seen = new Set<string>();
    const rows = [];
    for (const a of artists) {
      if (!a.id || seen.has(a.id)) continue;
      seen.add(a.id);
      rows.push({
        user_id: userId,
        spotify_artist_id: a.id,
        artist_name: a.name,
        canonical_artist_id: a.canonicalArtistId ?? null,
        rank: Math.max(1, Math.round(a.rank)),
        ranks_by_range: a.ranksByRange ?? {},
        affinity: a.affinity ?? null,
        affinity_reason: a.affinityReason ?? null,
        trend: a.trend ?? null,
        popularity: a.popularity ?? 0,
        genres: a.genres ?? [],
        image_url: a.imageUrl ?? null,
        spotify_url: a.spotifyUrl || null,
        source: 'spotify',
        synced_at: (a.syncedAt ? new Date(a.syncedAt) : syncedAt).toISOString(),
        updated_at: nowIso,
      });
    }
    if (rows.length === 0) return 0;

    const { error } = await this.client
      .from('user_spotify_artist_affinities')
      .upsert(rows, { onConflict: 'user_id,spotify_artist_id' });
    if (error) {
      throw new Error(`Failed to store Spotify affinities: ${error.message}`);
    }

    // Prune artists that dropped out of the latest successful sync.
    const { error: pruneError } = await this.client
      .from('user_spotify_artist_affinities')
      .delete()
      .eq('user_id', userId)
      .lt('updated_at', nowIso);
    if (pruneError) {
      throw new Error(
        `Failed to prune stale Spotify affinities: ${pruneError.message}`,
      );
    }
    return rows.length;
  }

  async getAffinities(userId: string): Promise<SpotifyTopArtist[]> {
    if (!userId || !userId.trim()) return [];
    const { data, error } = await this.client
      .from('user_spotify_artist_affinities')
      .select('*')
      .eq('user_id', userId)
      .order('rank', { ascending: true });
    if (error) {
      throw new Error(`Failed to load Spotify affinities: ${error.message}`);
    }
    return ((data ?? []) as AffinityRow[]).map(mapAffinityRowToArtist);
  }

  async clearAffinities(userId: string): Promise<void> {
    if (!userId || !userId.trim()) return;
    const { error } = await this.client
      .from('user_spotify_artist_affinities')
      .delete()
      .eq('user_id', userId);
    if (error) {
      throw new Error(`Failed to clear Spotify affinities: ${error.message}`);
    }
  }
}

export class MemorySpotifyAffinityRepository implements ISpotifyAffinityRepository {
  private readonly store = new Map<string, SpotifyTopArtist[]>();

  async replaceAffinities(
    userId: string,
    artists: SpotifyTopArtist[],
  ): Promise<number> {
    if (!userId || artists.length === 0) return 0;
    this.store.set(
      userId,
      artists.map((a) => ({ ...a })),
    );
    return artists.length;
  }
  async getAffinities(userId: string): Promise<SpotifyTopArtist[]> {
    return (this.store.get(userId) ?? []).map((a) => ({ ...a }));
  }
  async clearAffinities(userId: string): Promise<void> {
    this.store.delete(userId);
  }
}
