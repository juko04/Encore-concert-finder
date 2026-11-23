/**
 * Spotify Artist Entity Resolution Matcher
 *
 * Resolves Spotify artist profiles against canonical catalog artists following
 * Encore's non-negotiable Invariant 5 (Conservative Entity Resolution):
 * - External IDs take strict precedence.
 * - Never silently merge ambiguous artists.
 * - Verified name matching enriches external IDs only when safe and clean.
 */

import type { Artist } from '@/lib/domain/catalog';
import { normalizeName } from '@/lib/domain/value-objects';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';

export type SpotifyArtistMatchMethod =
  'exact_external_id' | 'verified_canonical_name';

export type SpotifyArtistUnmatchedReason = 'not_found_in_catalog';

export type SpotifyArtistAmbiguousReason =
  | 'multiple_canonical_artists_with_same_name'
  | 'conflicting_spotify_external_id';

export interface SpotifyArtistCandidate {
  id: string; // Spotify artist ID
  name: string;
  spotifyUrl?: string | null;
  [key: string]: unknown;
}

export interface MatchedSpotifyArtist {
  status: 'matched';
  spotifyId: string;
  spotifyArtist: SpotifyArtistCandidate;
  artistId: string;
  artistName: string;
  matchMethod: SpotifyArtistMatchMethod;
  wasEnriched: boolean;
  artist?: Artist;
}

export interface UnmatchedSpotifyArtist {
  status: 'unmatched';
  spotifyId: string;
  spotifyArtist: SpotifyArtistCandidate;
  reason: SpotifyArtistUnmatchedReason;
}

export interface AmbiguousSpotifyArtist {
  status: 'ambiguous';
  spotifyId: string;
  spotifyArtist: SpotifyArtistCandidate;
  reason: SpotifyArtistAmbiguousReason;
  candidateArtistIds?: string[];
}

export type SpotifyArtistMatchResult =
  MatchedSpotifyArtist | UnmatchedSpotifyArtist | AmbiguousSpotifyArtist;

export interface SpotifyArtistBatchSummary {
  total: number;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
  enrichedCount: number;
}

export interface SpotifyArtistBatchReport {
  matched: MatchedSpotifyArtist[];
  unmatched: UnmatchedSpotifyArtist[];
  ambiguous: AmbiguousSpotifyArtist[];
  results: SpotifyArtistMatchResult[];
  summary: SpotifyArtistBatchSummary;
}

export interface SpotifyArtistMatchOptions {
  /**
   * If true (default), automatically writes verified Spotify external ID
   * to canonical artist records when resolved cleanly by name.
   */
  allowEnrichment?: boolean;

  /**
   * If true, consults and updates the in-memory resolution cache
   * to avoid repeated DB lookups for the same session.
   */
  useCache?: boolean;
}

// ---------------------------------------------------------------------------
// In-Memory Resolution Cache
// ---------------------------------------------------------------------------

interface CachedResolution {
  result: SpotifyArtistMatchResult;
  timestamp: number;
}

const resolutionCache = new Map<string, CachedResolution>();
const RESOLUTION_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function clearSpotifyArtistResolutionCache(spotifyId?: string): void {
  if (spotifyId) {
    resolutionCache.delete(spotifyId);
  } else {
    resolutionCache.clear();
  }
}

export function getSpotifyArtistResolutionCacheSize(): number {
  return resolutionCache.size;
}

export function _setSpotifyArtistResolutionCacheForTesting(
  spotifyId: string,
  result: SpotifyArtistMatchResult,
): void {
  resolutionCache.set(spotifyId, {
    result,
    timestamp: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Matcher Implementation
// ---------------------------------------------------------------------------

const BATCH_CHUNK_SIZE = 50;

export class SpotifyArtistMatcher {
  private defaultCatalogRepo?: ICatalogRepository;
  private defaultOptions: SpotifyArtistMatchOptions;

  constructor(
    catalogRepo?: ICatalogRepository,
    defaultOptions?: SpotifyArtistMatchOptions,
  ) {
    this.defaultCatalogRepo = catalogRepo;
    this.defaultOptions = {
      allowEnrichment: true,
      useCache: false,
      ...defaultOptions,
    };
  }

  /**
   * Resolves a single Spotify artist candidate.
   */
  async matchArtist(
    artist: SpotifyArtistCandidate,
    repoOrOptions?: ICatalogRepository | SpotifyArtistMatchOptions,
    maybeOptions?: SpotifyArtistMatchOptions,
  ): Promise<SpotifyArtistMatchResult> {
    const { repo, options } = this.resolveArgs(repoOrOptions, maybeOptions);
    const report = await this.matchBatch([artist], repo, options);
    return (
      report.results[0] ?? {
        status: 'unmatched',
        spotifyId: artist?.id ?? '',
        spotifyArtist: artist,
        reason: 'not_found_in_catalog',
      }
    );
  }

  /**
   * Resolves a batch of Spotify artist candidates using conservative resolution.
   * Step 1: Exact external ID match via findArtistIdsByExternalIds.
   * Step 2: Exact normalized name query for remaining artists with conflict inspection.
   */
  async matchBatch(
    artists: SpotifyArtistCandidate[],
    repoOrOptions?: ICatalogRepository | SpotifyArtistMatchOptions,
    maybeOptions?: SpotifyArtistMatchOptions,
  ): Promise<SpotifyArtistBatchReport> {
    const { repo, options } = this.resolveArgs(repoOrOptions, maybeOptions);
    const allowEnrichment = options.allowEnrichment !== false;
    const useCache = Boolean(options.useCache);

    const matched: MatchedSpotifyArtist[] = [];
    const unmatched: UnmatchedSpotifyArtist[] = [];
    const ambiguous: AmbiguousSpotifyArtist[] = [];
    const results: SpotifyArtistMatchResult[] = [];

    if (!Array.isArray(artists) || artists.length === 0) {
      return {
        matched,
        unmatched,
        ambiguous,
        results,
        summary: {
          total: 0,
          matchedCount: 0,
          unmatchedCount: 0,
          ambiguousCount: 0,
          enrichedCount: 0,
        },
      };
    }

    const artistsToProcess: SpotifyArtistCandidate[] = [];

    // Optional Session Cache Check
    for (const artist of artists) {
      if (!artist || typeof artist.id !== 'string' || !artist.id.trim()) {
        const unres: UnmatchedSpotifyArtist = {
          status: 'unmatched',
          spotifyId: artist?.id ?? '',
          spotifyArtist: artist,
          reason: 'not_found_in_catalog',
        };
        unmatched.push(unres);
        results.push(unres);
        continue;
      }

      const spotifyId = artist.id.trim();

      if (useCache) {
        const cached = resolutionCache.get(spotifyId);
        if (cached && Date.now() - cached.timestamp < RESOLUTION_CACHE_TTL_MS) {
          const cachedResult = cached.result;
          if (cachedResult.status === 'matched') {
            const hit: MatchedSpotifyArtist = {
              ...cachedResult,
              spotifyArtist: artist,
              wasEnriched: false,
            };
            matched.push(hit);
            results.push(hit);
          } else if (cachedResult.status === 'ambiguous') {
            const hit: AmbiguousSpotifyArtist = {
              ...cachedResult,
              spotifyArtist: artist,
            };
            ambiguous.push(hit);
            results.push(hit);
          } else {
            const hit: UnmatchedSpotifyArtist = {
              ...cachedResult,
              spotifyArtist: artist,
            };
            unmatched.push(hit);
            results.push(hit);
          }
          continue;
        }
      }

      artistsToProcess.push(artist);
    }

    if (artistsToProcess.length === 0) {
      return {
        matched,
        unmatched,
        ambiguous,
        results,
        summary: {
          total: results.length,
          matchedCount: matched.length,
          unmatchedCount: unmatched.length,
          ambiguousCount: ambiguous.length,
          enrichedCount: matched.filter((m) => m.wasEnriched).length,
        },
      };
    }

    // Step 1: Batch check existing verified Spotify external IDs
    const spotifyIds = artistsToProcess.map((a) => a.id.trim());
    const externalIdMap = new Map<string, string>();

    for (let i = 0; i < spotifyIds.length; i += BATCH_CHUNK_SIZE) {
      const chunk = spotifyIds.slice(i, i + BATCH_CHUNK_SIZE);
      const chunkMap = await repo.findArtistIdsByExternalIds('spotify', chunk);
      for (const [extId, artistId] of chunkMap.entries()) {
        externalIdMap.set(extId, artistId);
      }
    }

    const remainingArtists: SpotifyArtistCandidate[] = [];

    for (const artist of artistsToProcess) {
      const spotifyId = artist.id.trim();
      const existingArtistId = externalIdMap.get(spotifyId);

      if (existingArtistId) {
        const canonical = await repo.getArtistById(existingArtistId);
        const matchRes: MatchedSpotifyArtist = {
          status: 'matched',
          spotifyId,
          spotifyArtist: artist,
          artistId: existingArtistId,
          artistName: canonical?.name ?? artist.name,
          matchMethod: 'exact_external_id',
          wasEnriched: false,
          artist: canonical ?? undefined,
        };

        matched.push(matchRes);
        results.push(matchRes);

        if (useCache) {
          resolutionCache.set(spotifyId, {
            result: matchRes,
            timestamp: Date.now(),
          });
        }
      } else {
        remainingArtists.push(artist);
      }
    }

    // Step 2: For unmatched artists, query canonical artists by exact normalized name
    for (const artist of remainingArtists) {
      const spotifyId = artist.id.trim();
      const rawName = artist.name?.trim();

      if (!rawName) {
        const unres: UnmatchedSpotifyArtist = {
          status: 'unmatched',
          spotifyId,
          spotifyArtist: artist,
          reason: 'not_found_in_catalog',
        };
        unmatched.push(unres);
        results.push(unres);
        if (useCache) {
          resolutionCache.set(spotifyId, {
            result: unres,
            timestamp: Date.now(),
          });
        }
        continue;
      }

      const normalized = normalizeName(rawName);
      if (!normalized) {
        const unres: UnmatchedSpotifyArtist = {
          status: 'unmatched',
          spotifyId,
          spotifyArtist: artist,
          reason: 'not_found_in_catalog',
        };
        unmatched.push(unres);
        results.push(unres);
        if (useCache) {
          resolutionCache.set(spotifyId, {
            result: unres,
            timestamp: Date.now(),
          });
        }
        continue;
      }

      const candidates = await repo.findArtistsByName(normalized);

      // Branch 1: 0 found in catalog
      if (candidates.length === 0) {
        const unres: UnmatchedSpotifyArtist = {
          status: 'unmatched',
          spotifyId,
          spotifyArtist: artist,
          reason: 'not_found_in_catalog',
        };
        unmatched.push(unres);
        results.push(unres);
        if (useCache) {
          resolutionCache.set(spotifyId, {
            result: unres,
            timestamp: Date.now(),
          });
        }
        continue;
      }

      // Branch 2: > 1 found with same normalized name -> ambiguous
      if (candidates.length > 1) {
        const ambRes: AmbiguousSpotifyArtist = {
          status: 'ambiguous',
          spotifyId,
          spotifyArtist: artist,
          reason: 'multiple_canonical_artists_with_same_name',
          candidateArtistIds: candidates.map((c) => c.id),
        };
        ambiguous.push(ambRes);
        results.push(ambRes);
        if (useCache) {
          resolutionCache.set(spotifyId, {
            result: ambRes,
            timestamp: Date.now(),
          });
        }
        continue;
      }

      // Branch 3: Exactly 1 candidate found
      const candidate = candidates[0];
      const existingExtIds = await repo.findArtistExternalIds(candidate.id);
      const existingSpotifyExt = existingExtIds.find(
        (e) => e.provider === 'spotify',
      );

      // Subcase 3a: Conflicting Spotify external ID
      if (existingSpotifyExt && existingSpotifyExt.externalId !== spotifyId) {
        const ambRes: AmbiguousSpotifyArtist = {
          status: 'ambiguous',
          spotifyId,
          spotifyArtist: artist,
          reason: 'conflicting_spotify_external_id',
          candidateArtistIds: [candidate.id],
        };
        ambiguous.push(ambRes);
        results.push(ambRes);
        if (useCache) {
          resolutionCache.set(spotifyId, {
            result: ambRes,
            timestamp: Date.now(),
          });
        }
        continue;
      }

      // Subcase 3b: Already has this exact Spotify ID attached
      if (existingSpotifyExt && existingSpotifyExt.externalId === spotifyId) {
        const matchRes: MatchedSpotifyArtist = {
          status: 'matched',
          spotifyId,
          spotifyArtist: artist,
          artistId: candidate.id,
          artistName: candidate.name,
          matchMethod: 'exact_external_id',
          wasEnriched: false,
          artist: candidate,
        };
        matched.push(matchRes);
        results.push(matchRes);
        if (useCache) {
          resolutionCache.set(spotifyId, {
            result: matchRes,
            timestamp: Date.now(),
          });
        }
        continue;
      }

      // Subcase 3c: Clean candidate without Spotify ID
      let wasEnriched = false;

      if (allowEnrichment) {
        try {
          const providerUrl =
            artist.spotifyUrl ?? `https://open.spotify.com/artist/${spotifyId}`;

          await repo.addArtistExternalId({
            artistId: candidate.id,
            provider: 'spotify',
            externalId: spotifyId,
            providerUrl,
          });
          wasEnriched = true;
        } catch {
          // Verify if concurrently enriched with the same external ID
          const currentExtIds = await repo.findArtistExternalIds(candidate.id);
          const currentSpotify = currentExtIds.find(
            (e) => e.provider === 'spotify',
          );
          if (currentSpotify && currentSpotify.externalId !== spotifyId) {
            const ambRes: AmbiguousSpotifyArtist = {
              status: 'ambiguous',
              spotifyId,
              spotifyArtist: artist,
              reason: 'conflicting_spotify_external_id',
              candidateArtistIds: [candidate.id],
            };
            ambiguous.push(ambRes);
            results.push(ambRes);
            if (useCache) {
              resolutionCache.set(spotifyId, {
                result: ambRes,
                timestamp: Date.now(),
              });
            }
            continue;
          }
        }
      }

      const matchRes: MatchedSpotifyArtist = {
        status: 'matched',
        spotifyId,
        spotifyArtist: artist,
        artistId: candidate.id,
        artistName: candidate.name,
        matchMethod: 'verified_canonical_name',
        wasEnriched,
        artist: candidate,
      };

      matched.push(matchRes);
      results.push(matchRes);

      if (useCache) {
        resolutionCache.set(spotifyId, {
          result: matchRes,
          timestamp: Date.now(),
        });
      }
    }

    return {
      matched,
      unmatched,
      ambiguous,
      results,
      summary: {
        total: results.length,
        matchedCount: matched.length,
        unmatchedCount: unmatched.length,
        ambiguousCount: ambiguous.length,
        enrichedCount: matched.filter((m) => m.wasEnriched).length,
      },
    };
  }

  private resolveArgs(
    repoOrOptions?: ICatalogRepository | SpotifyArtistMatchOptions,
    maybeOptions?: SpotifyArtistMatchOptions,
  ): { repo: ICatalogRepository; options: SpotifyArtistMatchOptions } {
    let repo = this.defaultCatalogRepo;
    let options: SpotifyArtistMatchOptions = { ...this.defaultOptions };

    if (repoOrOptions) {
      if (
        'findArtistByExternalId' in repoOrOptions ||
        'findArtistsByName' in repoOrOptions
      ) {
        repo = repoOrOptions as ICatalogRepository;
        if (maybeOptions) {
          options = { ...options, ...maybeOptions };
        }
      } else {
        options = {
          ...options,
          ...(repoOrOptions as SpotifyArtistMatchOptions),
        };
      }
    }

    if (!repo) {
      throw new Error(
        'Catalog repository is required for SpotifyArtistMatcher. Pass it to the constructor or method.',
      );
    }

    return { repo, options };
  }
}

// ---------------------------------------------------------------------------
// Standalone Functional Helpers
// ---------------------------------------------------------------------------

export async function matchSpotifyArtist(
  artist: SpotifyArtistCandidate,
  catalogRepo: ICatalogRepository,
  options?: SpotifyArtistMatchOptions,
): Promise<SpotifyArtistMatchResult> {
  const matcher = new SpotifyArtistMatcher(catalogRepo, options);
  return matcher.matchArtist(artist);
}

export async function matchSpotifyArtists(
  artists: SpotifyArtistCandidate[],
  catalogRepo: ICatalogRepository,
  options?: SpotifyArtistMatchOptions,
): Promise<SpotifyArtistBatchReport> {
  const matcher = new SpotifyArtistMatcher(catalogRepo, options);
  return matcher.matchBatch(artists);
}
