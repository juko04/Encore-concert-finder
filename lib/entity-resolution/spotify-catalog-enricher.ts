/**
 * Spotify Catalog Entity Resolution & Enrichment Service
 *
 * Implements strict conservative corroboration for canonical Encore artists
 * adhering to Invariant 5 (Conservative Entity Resolution) and Invariant 6 (Safe Database Target):
 *
 * - Priority 1: Check existing artist_external_ids for provider = 'spotify'.
 *   If already present, skip idempotently without making API requests.
 * - Priority 2: For canonical artists in active events:
 *   - Query Spotify Web API: GET /v1/search?q={name}&type=artist&limit=5
 *   - Filter exact name matches: item.name.toLowerCase() === canonicalArtist.name.toLowerCase()
 *   - If exactly 1 item matches:
 *     - Corroborated match!
 *     - Write to public.artist_external_ids (artist_id, provider: 'spotify', external_id, provider_url).
 *     - If artists.image_url is null and Spotify has images, update image_url.
 *   - If > 1 items share exact name (e.g. "Paul Wall", "Satsang", "Stick Figure"):
 *     - Ambiguous collision! Record as ambiguous; NEVER auto-merge or insert.
 *   - If 0 match:
 *     - Record as unmatched.
 *
 * Enforces destination guard (assertSafeDatabaseTarget), rate limit spacing (100ms),
 * and resilient error handling with backoff.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';

export const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_SEARCH_ENDPOINT = 'https://api.spotify.com/v1/search';
export const SPOTIFY_ARTISTS_ENDPOINT = 'https://api.spotify.com/v1/artists';
export const SPOTIFY_ID_REGEX = /^[0-9A-Za-z]{22}$/;

export type EnrichmentStatus =
  'already_linked' | 'enriched' | 'ambiguous' | 'unmatched';

export type MappingAuditStatus =
  | 'corroborated'
  | 'name_mismatch'
  | 'invalid_format'
  | 'placeholder_detected'
  | 'unverified'
  | 'conflicting'
  | 'ambiguous'
  | 'repaired';

export interface ArtistMappingAuditRow {
  mappingId: string;
  artistId: string;
  encoreArtistName: string;
  spotifyId: string;
  providerUrl?: string | null;
  isValidFormat: boolean;
  isSyntheticPlaceholder: boolean;
  status: MappingAuditStatus;
  spotifyArtistName?: string | null;
  details?: string;
  repairedToSpotifyId?: string | null;
}

export interface SpotifyMappingAuditSummary {
  totalAudited: number;
  validFormatCount: number;
  invalidFormatCount: number;
  corroboratedCount: number;
  nameMismatchCount: number;
  unverifiedCount: number;
  conflictingCount: number;
  ambiguousCount: number;
  placeholdersDetectedCount: number;
  placeholdersRepairedCount: number;
}

export interface SpotifyMappingAuditReport {
  summary: SpotifyMappingAuditSummary;
  rows: ArtistMappingAuditRow[];
}

export interface SpotifyArtistSearchResult {
  id: string;
  name: string;
  external_urls?: {
    spotify?: string;
  };
  images?: Array<{
    url: string;
    height?: number;
    width?: number;
  }>;
  genres?: string[];
}

export interface SpotifyArtistCandidateMatch {
  id: string;
  name: string;
  url?: string;
  images?: Array<{ url: string; height?: number; width?: number }>;
  genres?: string[];
}

export interface ArtistEnrichmentResult {
  artistId: string;
  artistName: string;
  status: EnrichmentStatus;
  spotifyId?: string;
  spotifyUrl?: string;
  imageUrl?: string | null;
  imageUpdated: boolean;
  ambiguousCandidates?: SpotifyArtistCandidateMatch[];
  reason?: string;
  apiRequestsUsed: number;
}

export interface SpotifyCatalogEnrichmentSummary {
  totalProcessed: number;
  enrichedCount: number;
  ambiguousCount: number;
  unmatchedCount: number;
  alreadyLinkedCount: number;
  apiRequestsUsed: number;
  imagesUpdatedCount: number;
}

export interface SpotifyCatalogEnrichmentReport {
  results: ArtistEnrichmentResult[];
  summary: SpotifyCatalogEnrichmentSummary;
}

export interface SpotifyCatalogEnricherOptions {
  supabase?: SupabaseClient;
  supabaseUrl?: string;
  serviceRoleKey?: string;
  clientId?: string;
  clientSecret?: string;
  allowProductionWrite?: boolean;
  rateLimitDelayMs?: number;
  dryRun?: boolean;
  fetchFn?: typeof fetch;
}

export interface HeadlinerArtistRecord {
  id: string;
  name: string;
  imageUrl: string | null;
  eventCount: number;
}

export class SpotifyCatalogEnricher {
  private supabase: SupabaseClient;
  private supabaseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private allowProductionWrite: boolean;
  private rateLimitDelayMs: number;
  private dryRun: boolean;
  private fetchFn: typeof fetch;

  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;
  private lastRequestTimestamp = 0;
  private apiRequestsUsed = 0;

  constructor(options?: SpotifyCatalogEnricherOptions) {
    this.supabaseUrl =
      options?.supabaseUrl ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      'http://127.0.0.1:54321';
    this.allowProductionWrite = options?.allowProductionWrite ?? false;
    this.rateLimitDelayMs = options?.rateLimitDelayMs ?? 100;
    this.dryRun = options?.dryRun ?? false;
    this.fetchFn = options?.fetchFn ?? fetch.bind(globalThis);

    // Enforce Invariant 6: Destination Safety Guard
    assertSafeDatabaseTarget(
      this.supabaseUrl,
      this.allowProductionWrite,
      'SpotifyCatalogEnricher',
    );

    if (options?.supabase) {
      this.supabase = options.supabase;
    } else if (options?.serviceRoleKey) {
      this.supabase = createClient(this.supabaseUrl, options.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    } else {
      this.supabase = createAdminClient();
    }

    this.clientId = options?.clientId ?? process.env.SPOTIFY_CLIENT_ID ?? '';
    this.clientSecret =
      options?.clientSecret ?? process.env.SPOTIFY_CLIENT_SECRET ?? '';
  }

  public getApiRequestsUsed(): number {
    return this.apiRequestsUsed;
  }

  public resetApiRequestsUsed(): void {
    this.apiRequestsUsed = 0;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTimestamp;
    if (elapsed < this.rateLimitDelayMs) {
      await this.sleep(this.rateLimitDelayMs - elapsed);
    }
    this.lastRequestTimestamp = Date.now();
  }

  /**
   * Obtains a Spotify Client Credentials token from Spotify Accounts API.
   * Caches token in memory until 60 seconds before expiration.
   */
  public async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required for Spotify catalog enrichment.',
      );
    }

    const basicAuth = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString('base64');

    const res = await this.fetchFn(SPOTIFY_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(
        `Failed to obtain Spotify access token (HTTP ${res.status}): ${errorBody}`,
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };

    this.cachedToken = data.access_token;
    // Buffer expiration by 60 seconds
    this.tokenExpiresAt = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
    return this.cachedToken;
  }

  /**
   * Queries Spotify Search API for artists matching the given name (limit 5).
   * Enforces 100ms rate limiting and handles 429 rate limit backoff.
   */
  public async searchSpotifyArtists(
    name: string,
  ): Promise<SpotifyArtistSearchResult[]> {
    await this.enforceRateLimit();
    const token = await this.getAccessToken();

    const url = `${SPOTIFY_SEARCH_ENDPOINT}?q=${encodeURIComponent(name)}&type=artist&limit=5`;

    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      this.apiRequestsUsed++;

      try {
        const res = await this.fetchFn(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });

        if (res.status === 429) {
          const retryHeader = res.headers.get('Retry-After');
          const waitSec = retryHeader ? parseInt(retryHeader, 10) : 2;
          if (waitSec > 10) {
            return [];
          }
          await this.sleep((isNaN(waitSec) ? 2 : waitSec) * 1000);
          continue;
        }

        if (res.status === 401 && attempts === 1) {
          // Token expired, clear cache and retry once
          this.cachedToken = null;
          const freshToken = await this.getAccessToken();
          const retryRes = await this.fetchFn(url, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${freshToken}`,
              Accept: 'application/json',
            },
          });
          if (retryRes.ok) {
            const data = (await retryRes.json()) as {
              artists?: { items?: SpotifyArtistSearchResult[] };
            };
            return data.artists?.items ?? [];
          }
        }

        if (!res.ok) {
          const body = await res.text();
          throw new Error(
            `Spotify search failed (HTTP ${res.status}): ${body}`,
          );
        }

        const data = (await res.json()) as {
          artists?: { items?: SpotifyArtistSearchResult[] };
        };

        return data.artists?.items ?? [];
      } catch (err: unknown) {
        if (attempts >= 3) {
          throw err;
        }
        await this.sleep(200 * attempts);
      }
    }

    return [];
  }

  /**
   * Fetches a single artist by Spotify ID from GET /v1/artists/{id}.
   * Handles rate limiting, token refresh on 401, and 429 retry-after.
   * Returns null if Spotify returns 404.
   */
  public async getArtistById(
    spotifyId: string,
  ): Promise<SpotifyArtistSearchResult | null> {
    await this.enforceRateLimit();
    const token = await this.getAccessToken();

    const url = `${SPOTIFY_ARTISTS_ENDPOINT}/${encodeURIComponent(spotifyId)}`;

    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      this.apiRequestsUsed++;

      try {
        const res = await this.fetchFn(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });

        if (res.status === 404) {
          return null;
        }

        if (res.status === 429) {
          const retryHeader = res.headers.get('Retry-After');
          const waitSec = retryHeader ? parseInt(retryHeader, 10) : 2;
          if (waitSec > 10) {
            return null;
          }
          await this.sleep((isNaN(waitSec) ? 2 : waitSec) * 1000);
          continue;
        }

        if (res.status === 401 && attempts === 1) {
          this.cachedToken = null;
          const freshToken = await this.getAccessToken();
          const retryRes = await this.fetchFn(url, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${freshToken}`,
              Accept: 'application/json',
            },
          });
          if (retryRes.status === 404) return null;
          if (retryRes.ok) {
            return (await retryRes.json()) as SpotifyArtistSearchResult;
          }
        }

        if (!res.ok) {
          const body = await res.text();
          throw new Error(
            `Spotify get artist failed (HTTP ${res.status}): ${body}`,
          );
        }

        return (await res.json()) as SpotifyArtistSearchResult;
      } catch (err: unknown) {
        if (attempts >= 3) {
          throw err;
        }
        await this.sleep(200 * attempts);
      }
    }

    return null;
  }

  /**
   * Fetches multiple Spotify artists by their Spotify IDs.
   * Batches in chunks of up to 50 IDs per request.
   * Queries GET /v1/artists?ids=...
   * If the batch endpoint returns 403 (Spotify Developer Mode restriction) or fails,
   * seamlessly falls back to individual getArtistById calls.
   */
  public async getArtistsByIds(
    spotifyIds: string[],
  ): Promise<Map<string, SpotifyArtistSearchResult | null>> {
    const results = new Map<string, SpotifyArtistSearchResult | null>();
    if (spotifyIds.length === 0) return results;

    const uniqueIds = Array.from(new Set(spotifyIds));
    const batchSize = 50;

    for (let i = 0; i < uniqueIds.length; i += batchSize) {
      const chunk = uniqueIds.slice(i, i + batchSize);
      await this.enforceRateLimit();
      const token = await this.getAccessToken();

      const url = `${SPOTIFY_ARTISTS_ENDPOINT}?ids=${encodeURIComponent(chunk.join(','))}`;

      let batchSucceeded = false;
      this.apiRequestsUsed++;

      try {
        const res = await this.fetchFn(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });

        if (res.ok) {
          const data = (await res.json()) as {
            artists?: Array<SpotifyArtistSearchResult | null>;
          };
          if (data.artists && Array.isArray(data.artists)) {
            for (let j = 0; j < chunk.length; j++) {
              const artistItem = data.artists[j] ?? null;
              results.set(chunk[j], artistItem);
            }
            batchSucceeded = true;
          }
        }
      } catch {
        // Fall back to individual requests
      }

      // If batch endpoint failed (e.g. 403 or network issue), fall back to individual getArtistById
      if (!batchSucceeded) {
        for (const id of chunk) {
          const artist = await this.getArtistById(id);
          results.set(id, artist);
        }
      }
    }

    return results;
  }

  /**
   * Enriches a single canonical Encore artist following strict conservative corroboration:
   * 1. Priority 1: Check existing artist_external_ids (skip idempotently if spotify ID exists).
   * 2. Priority 2: Query Spotify Web API.
   *    - 1 exact match: Corroborated! Write external ID and enrich image_url if null.
   *    - >1 exact match: Ambiguous collision! Never insert.
   *    - 0 match: Unmatched.
   */
  public async enrichArtist(artist: {
    id: string;
    name: string;
    imageUrl?: string | null;
  }): Promise<ArtistEnrichmentResult> {
    const trimmedName = artist.name?.trim() ?? '';
    if (!trimmedName) {
      return {
        artistId: artist.id,
        artistName: artist.name,
        status: 'unmatched',
        reason: 'Artist name is empty or invalid',
        imageUpdated: false,
        apiRequestsUsed: 0,
      };
    }

    // Priority 1: Check existing artist_external_ids for provider = 'spotify'
    const { data: existingExt, error: extCheckError } = await this.supabase
      .from('artist_external_ids')
      .select('external_id, provider_url')
      .eq('artist_id', artist.id)
      .eq('provider', 'spotify')
      .maybeSingle();

    if (extCheckError) {
      throw new Error(
        `Failed to check existing artist_external_ids for artist ${artist.id}: ${extCheckError.message}`,
      );
    }

    if (existingExt) {
      return {
        artistId: artist.id,
        artistName: artist.name,
        status: 'already_linked',
        spotifyId: existingExt.external_id,
        spotifyUrl: existingExt.provider_url ?? undefined,
        imageUrl: artist.imageUrl ?? null,
        imageUpdated: false,
        reason:
          'Artist already linked to Spotify external ID (idempotent skip)',
        apiRequestsUsed: 0,
      };
    }

    // Priority 2: Query Spotify Web API
    let searchResults: SpotifyArtistSearchResult[];
    try {
      searchResults = await this.searchSpotifyArtists(trimmedName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        artistId: artist.id,
        artistName: artist.name,
        status: 'unmatched',
        reason: `Spotify API search error: ${msg}`,
        imageUpdated: false,
        apiRequestsUsed: 1,
      };
    }

    // Exact name matches: item.name.toLowerCase() === canonicalArtist.name.toLowerCase()
    const targetLower = trimmedName.toLowerCase();
    const exactMatches = searchResults.filter(
      (item) => item.name?.trim().toLowerCase() === targetLower,
    );

    // Case 2b: Ambiguous collision (> 1 exact matches)
    if (exactMatches.length > 1) {
      const candidates: SpotifyArtistCandidateMatch[] = exactMatches.map(
        (item) => ({
          id: item.id,
          name: item.name,
          url:
            item.external_urls?.spotify ??
            `https://open.spotify.com/artist/${item.id}`,
          images: item.images,
        }),
      );

      return {
        artistId: artist.id,
        artistName: artist.name,
        status: 'ambiguous',
        ambiguousCandidates: candidates,
        reason: `Ambiguous collision: ${exactMatches.length} Spotify artists share exact name "${artist.name}"`,
        imageUpdated: false,
        apiRequestsUsed: 1,
      };
    }

    // Case 2c: Unmatched (0 exact matches)
    if (exactMatches.length === 0) {
      return {
        artistId: artist.id,
        artistName: artist.name,
        status: 'unmatched',
        reason: `No Spotify artists returned matching exact name "${artist.name}" (${searchResults.length} non-exact candidates found)`,
        imageUpdated: false,
        apiRequestsUsed: 1,
      };
    }

    // Case 2a: Exactly 1 exact match -> Corroborated!
    const matched = exactMatches[0];
    const spotifyId = matched.id;
    const providerUrl =
      matched.external_urls?.spotify ??
      `https://open.spotify.com/artist/${spotifyId}`;

    // Verify external ID is not already claimed by a different artist
    const { data: conflictingExt, error: conflictErr } = await this.supabase
      .from('artist_external_ids')
      .select('artist_id')
      .eq('provider', 'spotify')
      .eq('external_id', spotifyId)
      .maybeSingle();

    if (conflictErr) {
      throw new Error(
        `Failed to verify external ID uniqueness for ${spotifyId}: ${conflictErr.message}`,
      );
    }

    if (conflictingExt && conflictingExt.artist_id !== artist.id) {
      return {
        artistId: artist.id,
        artistName: artist.name,
        status: 'ambiguous',
        ambiguousCandidates: [
          {
            id: matched.id,
            name: matched.name,
            url: providerUrl,
            images: matched.images,
          },
        ],
        reason: `Spotify ID ${spotifyId} is already associated with canonical artist ${conflictingExt.artist_id}`,
        imageUpdated: false,
        apiRequestsUsed: 1,
      };
    }

    let imageUpdated = false;
    let finalImageUrl = artist.imageUrl ?? null;

    if (!this.dryRun) {
      // 1. Insert into public.artist_external_ids
      const { error: insertErr } = await this.supabase
        .from('artist_external_ids')
        .insert({
          artist_id: artist.id,
          provider: 'spotify',
          external_id: spotifyId,
          provider_url: providerUrl,
        });

      if (insertErr) {
        if (insertErr.code === '23505') {
          // Unique constraint violation (concurrent write or collision)
          return {
            artistId: artist.id,
            artistName: artist.name,
            status: 'ambiguous',
            reason: `Unique constraint collision inserting Spotify external ID ${spotifyId}: ${insertErr.message}`,
            imageUpdated: false,
            apiRequestsUsed: 1,
          };
        }
        throw new Error(
          `Failed to insert artist_external_id for ${artist.id}: ${insertErr.message}`,
        );
      }

      // 2. If artists.image_url is null and Spotify has images, update image_url
      let currentImageUrl = artist.imageUrl;
      if (currentImageUrl === undefined) {
        const { data: aRow } = await this.supabase
          .from('artists')
          .select('image_url')
          .eq('id', artist.id)
          .maybeSingle();
        currentImageUrl = aRow?.image_url ?? null;
      }

      if (
        !currentImageUrl &&
        matched.images &&
        matched.images.length > 0 &&
        matched.images[0].url
      ) {
        const spotifyImageUrl = matched.images[0].url;
        const { error: updateErr } = await this.supabase
          .from('artists')
          .update({
            image_url: spotifyImageUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('id', artist.id);

        if (!updateErr) {
          imageUpdated = true;
          finalImageUrl = spotifyImageUrl;
        }
      }

      // 3. Store Spotify genres (fill/refresh only with real non-empty data; tolerate the
      //    column not existing yet if the migration has not been applied)
      await this.storeArtistGenres(artist.id, matched.genres);
    } else {
      // In dry-run mode, simulate image update check
      if (
        !artist.imageUrl &&
        matched.images &&
        matched.images.length > 0 &&
        matched.images[0].url
      ) {
        imageUpdated = true;
        finalImageUrl = matched.images[0].url;
      }
    }

    return {
      artistId: artist.id,
      artistName: artist.name,
      status: 'enriched',
      spotifyId,
      spotifyUrl: providerUrl,
      imageUrl: finalImageUrl,
      imageUpdated,
      apiRequestsUsed: 1,
    };
  }

  /**
   * Persists Spotify artist-object genres for a canonical artist.
   * - Never writes an empty list over existing genres; never invents genres.
   * - Records provenance (genres_source, genres_updated_at).
   * - Returns false (without throwing) if the genres column does not exist yet.
   */
  public async storeArtistGenres(
    artistId: string,
    genres: string[] | undefined | null,
    options?: { onlyIfMissing?: boolean },
  ): Promise<boolean> {
    const clean = Array.from(
      new Set(
        (genres ?? [])
          .filter((g): g is string => typeof g === 'string')
          .map((g) => g.trim().toLowerCase())
          .filter(Boolean),
      ),
    );
    if (clean.length === 0 || this.dryRun) return false;
    const now = new Date().toISOString();
    let query = this.supabase
      .from('artists')
      .update({
        genres: clean,
        genres_source: 'spotify',
        genres_updated_at: now,
        updated_at: now,
      })
      .eq('id', artistId);
    // Backfill mode: only ever fill an artist that still has NO genres (guards against races
    // and against overwriting genres stored since the candidate list was read).
    if (options?.onlyIfMissing) query = query.eq('genres', '{}');
    const { data: updatedRows, error } = await query.select('id');
    if (error) {
      // 42703 = undefined_column (migration not applied) / PGRST204 = column not in schema cache
      if (error.code === '42703' || error.code === 'PGRST204') return false;
      console.warn(
        `[spotify-enricher] Failed to store genres for ${artistId}: ${error.message}`,
      );
      return false;
    }
    if (options?.onlyIfMissing) return (updatedRows ?? []).length > 0;
    return true;
  }

  /**
   * Backfills genres for canonical artists that already have a Spotify external ID but no genres.
   * Uses the batch artists endpoint (falls back per-artist). Returns counts.
   */
  public async backfillGenres(options?: { limit?: number }): Promise<{
    candidates: number;
    updated: number;
    /** Dry-run only: how many artists WOULD be updated (nothing is written). */
    wouldUpdate: number;
    skippedNoGenres: number;
  }> {
    const limit = options?.limit ?? 500;
    type Row = {
      artist_id: string;
      external_id: string;
      artists?:
        | { genres?: string[] | null }
        | Array<{ genres?: string[] | null }>
        | null;
    };
    // Page through the Spotify mappings until `limit` genre-less artists are found, so artists
    // that already have genres cannot starve the ones that still need them.
    const PAGE = 1000;
    const rows: Row[] = [];
    for (let offset = 0; rows.length < limit; offset += PAGE) {
      const { data, error } = await this.supabase
        .from('artist_external_ids')
        .select('artist_id, external_id, artists(id, genres)')
        .eq('provider', 'spotify')
        .order('artist_id', { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) {
        throw new Error(
          `Failed to load Spotify-mapped artists: ${error.message}`,
        );
      }
      const page = (data ?? []) as unknown as Row[];
      for (const r of page) {
        const a = Array.isArray(r.artists) ? r.artists[0] : r.artists;
        if (!a?.genres || a.genres.length === 0) rows.push(r);
        if (rows.length >= limit) break;
      }
      if (page.length < PAGE) break;
    }

    let updated = 0;
    let wouldUpdate = 0;
    let skippedNoGenres = 0;
    for (let i = 0; i < rows.length; i += 50) {
      const chunk = rows.slice(i, i + 50);
      const spotifyMap = await this.getArtistsByIds(
        chunk.map((r) => r.external_id),
      );
      for (const r of chunk) {
        const sa = spotifyMap.get(r.external_id);
        if (!sa?.genres || sa.genres.length === 0) {
          skippedNoGenres++;
          continue;
        }
        if (this.dryRun) {
          wouldUpdate++;
          continue;
        }
        if (
          await this.storeArtistGenres(r.artist_id, sa.genres, {
            onlyIfMissing: true,
          })
        ) {
          updated++;
        }
      }
    }
    return { candidates: rows.length, updated, wouldUpdate, skippedNoGenres };
  }

  /**
   * Queries canonical headliners from events in local Supabase.
   * Can be filtered by region and status.
   */
  public async getHeadlinersToEnrich(options?: {
    region?: string;
    status?: string;
    limit?: number;
  }): Promise<HeadlinerArtistRecord[]> {
    let query = this.supabase
      .from('event_artists')
      .select(
        `
        artist_id,
        billing_position,
        artists!inner(id, name, image_url),
        events!inner(id, region, status)
      `,
      )
      .eq('billing_position', 'headliner');

    if (options?.region) {
      query = query.eq('events.region', options.region);
    }
    if (options?.status) {
      query = query.eq('events.status', options.status);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to query event headliners: ${error.message}`);
    }

    const artistMap = new Map<string, HeadlinerArtistRecord>();
    for (const row of data || []) {
      const a = (
        row as unknown as {
          artists: { id: string; name: string; image_url: string | null };
        }
      ).artists;
      if (!a || !a.id) continue;

      const existing = artistMap.get(a.id);
      if (existing) {
        existing.eventCount++;
      } else {
        artistMap.set(a.id, {
          id: a.id,
          name: a.name,
          imageUrl: a.image_url,
          eventCount: 1,
        });
      }
    }

    let records = Array.from(artistMap.values());
    if (options?.limit && options.limit > 0) {
      records = records.slice(0, options.limit);
    }

    return records;
  }

  /**
   * Enriches a batch of canonical artists.
   */
  public async enrichArtists(
    artists: Array<{ id: string; name: string; imageUrl?: string | null }>,
    onProgress?: (
      result: ArtistEnrichmentResult,
      index: number,
      total: number,
    ) => void,
  ): Promise<SpotifyCatalogEnrichmentReport> {
    const results: ArtistEnrichmentResult[] = [];
    let enrichedCount = 0;
    let ambiguousCount = 0;
    let unmatchedCount = 0;
    let alreadyLinkedCount = 0;
    let imagesUpdatedCount = 0;

    const total = artists.length;

    for (let i = 0; i < total; i++) {
      const artist = artists[i];
      const res = await this.enrichArtist(artist);
      results.push(res);

      if (res.status === 'enriched') enrichedCount++;
      else if (res.status === 'ambiguous') ambiguousCount++;
      else if (res.status === 'unmatched') unmatchedCount++;
      else if (res.status === 'already_linked') alreadyLinkedCount++;

      if (res.imageUpdated) imagesUpdatedCount++;

      if (onProgress) {
        onProgress(res, i + 1, total);
      }
    }

    return {
      results,
      summary: {
        totalProcessed: results.length,
        enrichedCount,
        ambiguousCount,
        unmatchedCount,
        alreadyLinkedCount,
        apiRequestsUsed: this.apiRequestsUsed,
        imagesUpdatedCount,
      },
    };
  }

  /**
   * High-level method to discover and enrich canonical headliners from events.
   */
  public async enrichHeadliners(
    options?: {
      region?: string;
      status?: string;
      limit?: number;
    },
    onProgress?: (
      result: ArtistEnrichmentResult,
      index: number,
      total: number,
    ) => void,
  ): Promise<SpotifyCatalogEnrichmentReport> {
    const headliners = await this.getHeadlinersToEnrich(options);
    return this.enrichArtists(headliners, onProgress);
  }

  /**
   * Idempotently ensures canonical artist exists in public.artists
   * and is linked to the verified Spotify ID in public.artist_external_ids.
   */
  public async ensureArtistWithSpotifyId(params: {
    name: string;
    spotifyId: string;
    imageUrl?: string | null;
  }): Promise<{
    artistId: string;
    createdArtist: boolean;
    linkedExternalId: boolean;
  }> {
    const trimmedName = params.name.trim();
    const normalizedName = trimmedName.toLowerCase();
    const providerUrl = `https://open.spotify.com/artist/${params.spotifyId}`;

    // 1. Check if artist exists
    const { data: existingArtist, error: findErr } = await this.supabase
      .from('artists')
      .select('id, name, image_url')
      .eq('normalized_name', normalizedName)
      .maybeSingle();

    if (findErr) {
      throw new Error(
        `Failed to find artist by name "${trimmedName}": ${findErr.message}`,
      );
    }

    let artistId = existingArtist?.id;
    let createdArtist = false;

    if (!artistId) {
      if (!this.dryRun) {
        const { data: newArtist, error: createErr } = await this.supabase
          .from('artists')
          .insert({
            name: trimmedName,
            normalized_name: normalizedName,
            image_url: params.imageUrl ?? null,
          })
          .select('id')
          .single();

        if (createErr) {
          throw new Error(
            `Failed to create artist "${trimmedName}": ${createErr.message}`,
          );
        }
        artistId = newArtist.id;
        createdArtist = true;
      } else {
        artistId = 'dry-run-artist-id';
        createdArtist = true;
      }
    } else if (
      existingArtist &&
      !existingArtist.image_url &&
      params.imageUrl &&
      !this.dryRun
    ) {
      await this.supabase
        .from('artists')
        .update({
          image_url: params.imageUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', artistId);
    }

    // 2. Check artist_external_ids
    let linkedExternalId = false;
    const { data: existingExt, error: extErr } = await this.supabase
      .from('artist_external_ids')
      .select('id, external_id')
      .eq('artist_id', artistId)
      .eq('provider', 'spotify')
      .maybeSingle();

    if (extErr) {
      throw new Error(
        `Failed to check artist_external_ids for artist ${artistId}: ${extErr.message}`,
      );
    }

    if (!existingExt) {
      if (!this.dryRun) {
        const { error: insertExtErr } = await this.supabase
          .from('artist_external_ids')
          .insert({
            artist_id: artistId,
            provider: 'spotify',
            external_id: params.spotifyId,
            provider_url: providerUrl,
          });

        if (insertExtErr) {
          throw new Error(
            `Failed to insert artist_external_ids for artist ${artistId}: ${insertExtErr.message}`,
          );
        }
      }
      linkedExternalId = true;
    } else if (existingExt.external_id !== params.spotifyId) {
      if (!this.dryRun) {
        const { error: updateExtErr } = await this.supabase
          .from('artist_external_ids')
          .update({
            external_id: params.spotifyId,
            provider_url: providerUrl,
          })
          .eq('id', existingExt.id);

        if (updateExtErr) {
          throw new Error(
            `Failed to update artist_external_ids for artist ${artistId}: ${updateExtErr.message}`,
          );
        }
      }
      linkedExternalId = true;
    }

    return {
      artistId: artistId!,
      createdArtist,
      linkedExternalId,
    };
  }

  /**
   * Idempotently ensures canonical artist John Summit exists in artists
   * with verified Spotify ID 7kNqXtgeIwFtelmRjWv205.
   */
  public async ensureJohnSummit(): Promise<{
    artistId: string;
    createdArtist: boolean;
    linkedExternalId: boolean;
  }> {
    return this.ensureArtistWithSpotifyId({
      name: 'John Summit',
      spotifyId: '7kNqXtgeIwFtelmRjWv205',
      imageUrl:
        'https://i.scdn.co/image/ab6761610000e5eb20662b32f3dbabad755dfb53',
    });
  }

  /**
   * Exhaustively audits all Spotify mappings in public.artist_external_ids.
   * Adheres to Invariant 5 (Conservative Entity Resolution) and Invariant 6 (Safe Database Target).
   */
  public async auditSpotifyMappings(options?: {
    repair?: boolean;
    ensureJohnSummit?: boolean;
    onProgress?: (processed: number, total: number) => void;
  }): Promise<SpotifyMappingAuditReport> {
    if (options?.ensureJohnSummit) {
      await this.ensureJohnSummit();
    }

    // Query all existing Spotify mappings with associated canonical artist
    const { data: rawMappings, error } = await this.supabase
      .from('artist_external_ids')
      .select(
        'id, artist_id, external_id, provider_url, artists(id, name, normalized_name, image_url)',
      )
      .eq('provider', 'spotify')
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(
        `Failed to query artist_external_ids for audit: ${error.message}`,
      );
    }

    const mappings = (rawMappings || []).map((r) => {
      const a = r as unknown as {
        id: string;
        artist_id: string;
        external_id: string;
        provider_url?: string | null;
        artists: {
          id: string;
          name: string;
          normalized_name: string;
          image_url: string | null;
        } | null;
      };
      return {
        mappingId: a.id,
        artistId: a.artist_id,
        externalId: a.external_id,
        providerUrl: a.provider_url ?? null,
        artistName:
          (Array.isArray(a.artists) ? a.artists[0]?.name : a.artists?.name) ||
          'UNKNOWN_ORPHAN_ARTIST',
        artistImageUrl:
          (Array.isArray(a.artists)
            ? a.artists[0]?.image_url
            : a.artists?.image_url) ?? null,
      };
    });

    const total = mappings.length;
    const summary: SpotifyMappingAuditSummary = {
      totalAudited: total,
      validFormatCount: 0,
      invalidFormatCount: 0,
      corroboratedCount: 0,
      nameMismatchCount: 0,
      unverifiedCount: 0,
      conflictingCount: 0,
      ambiguousCount: 0,
      placeholdersDetectedCount: 0,
      placeholdersRepairedCount: 0,
    };

    // 1. Conflict detection (duplicate external_ids across different artists)
    const extToArtists = new Map<string, string[]>();
    for (const m of mappings) {
      const list = extToArtists.get(m.externalId) || [];
      list.push(m.artistId);
      extToArtists.set(m.externalId, list);
    }

    // 2. Format validation & synthetic placeholder classification
    const validIdsToQuery: string[] = [];
    const intermediateRows: Array<{
      mapping: (typeof mappings)[0];
      isValidFormat: boolean;
      isPlaceholder: boolean;
      isConflicting: boolean;
    }> = [];

    for (const m of mappings) {
      const isValid = SPOTIFY_ID_REGEX.test(m.externalId);
      const isPlaceholder =
        !isValid ||
        m.externalId.startsWith('spotify_') ||
        m.externalId.includes('_real') ||
        m.externalId.includes('_test') ||
        m.externalId.includes('placeholder');

      const isConflicting = (extToArtists.get(m.externalId)?.length ?? 0) > 1;

      if (isValid) {
        summary.validFormatCount++;
        if (!isConflicting) {
          validIdsToQuery.push(m.externalId);
        }
      } else {
        summary.invalidFormatCount++;
      }

      if (isPlaceholder) {
        summary.placeholdersDetectedCount++;
      }

      if (isConflicting) {
        summary.conflictingCount++;
      }

      intermediateRows.push({
        mapping: m,
        isValidFormat: isValid,
        isPlaceholder,
        isConflicting,
      });
    }

    // 3. Batch query Spotify Web API for valid external IDs
    const spotifyArtistMap = await this.getArtistsByIds(validIdsToQuery);

    const rows: ArtistMappingAuditRow[] = [];

    // 4. Corroborate each mapping against Spotify API
    for (let i = 0; i < intermediateRows.length; i++) {
      const item = intermediateRows[i];
      const m = item.mapping;
      let status: MappingAuditStatus = 'unverified';
      let spotName: string | null = null;
      let details: string | undefined;
      let repairedToSpotifyId: string | null = null;

      if (item.isConflicting) {
        status = 'conflicting';
        details = `Duplicate Spotify ID ${m.externalId} claimed by multiple artists`;
      } else if (item.isPlaceholder) {
        status = 'placeholder_detected';
        details = `Synthetic placeholder or invalid format detected: "${m.externalId}"`;
      } else if (!item.isValidFormat) {
        status = 'invalid_format';
        details = `Non-standard Spotify ID format (length ${m.externalId.length})`;
      } else {
        let spotArtist = spotifyArtistMap.get(m.externalId);
        if (!spotArtist) {
          // If batch or GET /v1/artists/{id} returned null (e.g. due to 429 rate limit or 404),
          // attempt corroboration via searchSpotifyArtists
          try {
            const candidates = await this.searchSpotifyArtists(m.artistName);
            const matched = candidates.find((c) => c.id === m.externalId);
            if (matched) {
              spotArtist = matched;
            }
          } catch {
            // Keep spotArtist as null
          }
        }

        if (!spotArtist) {
          status = 'unverified';
          details = 'Spotify Web API returned 404 or null for this ID';
          summary.unverifiedCount++;
        } else {
          spotName = spotArtist?.name || null;
          const encoreLower = (m.artistName || '').trim().toLowerCase();
          const spotLower = (spotArtist?.name || '').trim().toLowerCase();

          if (encoreLower === spotLower) {
            status = 'corroborated';
            details = 'Exact 1:1 name corroboration verified';
            summary.corroboratedCount++;
          } else {
            status = 'name_mismatch';
            details = `Name mismatch: Encore "${m.artistName}" vs Spotify "${spotArtist.name}"`;
            summary.nameMismatchCount++;
          }
        }
      }

      // 5. Repair logic if requested and placeholder/invalid detected
      if (
        options?.repair &&
        (status === 'placeholder_detected' ||
          status === 'invalid_format' ||
          status === 'unverified')
      ) {
        try {
          const searchResults = await this.searchSpotifyArtists(m.artistName);
          const encoreLower = m.artistName.trim().toLowerCase();
          const exactMatches = searchResults.filter(
            (c) => c.name?.trim().toLowerCase() === encoreLower,
          );

          if (exactMatches.length === 1) {
            const repairedId = exactMatches[0].id;
            const repairedUrl =
              exactMatches[0].external_urls?.spotify ??
              `https://open.spotify.com/artist/${repairedId}`;

            const existingClaim = extToArtists.get(repairedId);
            if (!existingClaim || existingClaim.includes(m.artistId)) {
              if (!this.dryRun) {
                await this.supabase
                  .from('artist_external_ids')
                  .update({
                    external_id: repairedId,
                    provider_url: repairedUrl,
                  })
                  .eq('id', m.mappingId);

                if (
                  !m.artistImageUrl &&
                  exactMatches[0].images &&
                  exactMatches[0].images.length > 0 &&
                  exactMatches[0].images[0].url
                ) {
                  await this.supabase
                    .from('artists')
                    .update({
                      image_url: exactMatches[0].images[0].url,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', m.artistId);
                }
              }

              status = 'repaired';
              repairedToSpotifyId = repairedId;
              spotName = exactMatches[0].name;
              details = `Repaired placeholder "${m.externalId}" to verified Spotify ID "${repairedId}"`;
              summary.placeholdersRepairedCount++;
              summary.corroboratedCount++;
            } else {
              status = 'ambiguous';
              details = `Cannot repair: Spotify ID ${repairedId} already claimed by another artist`;
              summary.ambiguousCount++;
            }
          } else if (exactMatches.length > 1) {
            status = 'ambiguous';
            details = `Cannot auto-repair: ${exactMatches.length} Spotify artists share name "${m.artistName}"`;
            summary.ambiguousCount++;
          }
        } catch (repairErr) {
          details = `Repair attempt failed: ${repairErr instanceof Error ? repairErr.message : String(repairErr)}`;
        }
      }

      rows.push({
        mappingId: m.mappingId,
        artistId: m.artistId,
        encoreArtistName: m.artistName,
        spotifyId: m.externalId,
        providerUrl: m.providerUrl,
        isValidFormat: item.isValidFormat,
        isSyntheticPlaceholder: item.isPlaceholder,
        status,
        spotifyArtistName: spotName,
        details,
        repairedToSpotifyId,
      });

      if (options?.onProgress) {
        options.onProgress(i + 1, intermediateRows.length);
      }
    }

    return {
      summary,
      rows,
    };
  }
}
