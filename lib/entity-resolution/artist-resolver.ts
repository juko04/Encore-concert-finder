/**
 * Artist Entity Resolution
 * Resolves candidate artist references to canonical Artist records.
 * A normalized name is treated as a match aid, never a universal identity key.
 */

import type { Artist } from '@/lib/domain/catalog';
import { normalizeName } from '@/lib/domain/value-objects';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';

export interface ResolveArtistOptions {
  name: string;
  disambiguatedArtistId?: string;
  externalIds?: Array<{
    provider: string;
    externalId: string;
    providerUrl?: string | null;
  }>;
}

export interface ArtistPreparationResult {
  status: 'matched' | 'to_create' | 'ambiguous';
  artistId?: string;
  artist?: Artist;
  artistToCreate?: {
    id: string;
    name: string;
    normalizedName: string;
    externalIds?: Array<{
      provider: string;
      externalId: string;
      providerUrl?: string | null;
    }>;
  };
  reasons: string[];
}

export interface ResolvedArtistResult {
  artist: Artist;
  isNew: boolean;
  matchMethod: 'external_id' | 'normalized_name' | 'created';
}

export class ArtistResolver {
  /**
   * Resolves an artist or prepares an atomic creation specification without writing to the database.
   */
  async resolveOrPrepare(
    catalogRepo: ICatalogRepository,
    options: ResolveArtistOptions,
  ): Promise<ArtistPreparationResult> {
    const rawName = options.name?.trim();
    if (!rawName) {
      throw new Error('Artist name must be a non-empty string');
    }

    // 0. Contextual disambiguation signal (e.g. artist already linked to this existing event)
    if (options.disambiguatedArtistId) {
      const existing = await catalogRepo.findArtistsByName(
        normalizeName(rawName),
      );
      const matched = existing.find(
        (a) => a.id === options.disambiguatedArtistId,
      );
      if (matched) {
        return {
          status: 'matched',
          artistId: matched.id,
          artist: matched,
          reasons: ['existing_canonical_event_artist_match'],
        };
      }
    }

    // 1. Resolve by stable external identifier first (highest confidence)
    if (options.externalIds && options.externalIds.length > 0) {
      for (const ext of options.externalIds) {
        const matched = await catalogRepo.findArtistByExternalId(
          ext.provider,
          ext.externalId,
        );
        if (matched) {
          return {
            status: 'matched',
            artistId: matched.id,
            artist: matched,
            reasons: ['exact_external_id_match'],
          };
        }
      }
    }

    // 2. Query all existing artists matching the normalized name
    const normalizedName = normalizeName(rawName);
    const existingArtists = await catalogRepo.findArtistsByName(normalizedName);

    if (existingArtists.length > 1) {
      // Multiple artists share this name; without a matching external ID, this is ambiguous!
      return {
        status: 'ambiguous',
        reasons: ['multiple_artists_with_same_name_requires_external_id'],
      };
    }

    if (existingArtists.length === 1) {
      const candidateArtist = existingArtists[0];

      // Check for conflicting external IDs (e.g. both have Spotify IDs, but values differ)
      if (options.externalIds && options.externalIds.length > 0) {
        const existingExtIds = await catalogRepo.findArtistExternalIds(
          candidateArtist.id,
        );

        const hasConflict = options.externalIds.some((incomingExt) => {
          const conflicting = existingExtIds.find(
            (e) =>
              e.provider === incomingExt.provider &&
              e.externalId !== incomingExt.externalId,
          );
          return Boolean(conflicting);
        });

        if (hasConflict) {
          // Confirmed distinct artist who happens to share the same name!
          const newArtistId = crypto.randomUUID();
          return {
            status: 'to_create',
            artistId: newArtistId,
            artistToCreate: {
              id: newArtistId,
              name: rawName,
              normalizedName,
              externalIds: options.externalIds,
            },
            reasons: ['conflicting_external_id_distinct_artist'],
          };
        }
      }

      // Disallow name-only matching against existing artist without external ID or disambiguation signal
      return {
        status: 'ambiguous',
        reasons: [
          'name_only_match_against_existing_artist_requires_external_id_disambiguation',
        ],
      };
    }

    // 3. New artist to create
    const newArtistId = crypto.randomUUID();
    return {
      status: 'to_create',
      artistId: newArtistId,
      artistToCreate: {
        id: newArtistId,
        name: rawName,
        normalizedName,
        externalIds: options.externalIds,
      },
      reasons: ['new_artist'],
    };
  }

  /**
   * Standalone resolution method that creates the artist immediately if not existing.
   */
  async resolve(
    catalogRepo: ICatalogRepository,
    options: ResolveArtistOptions,
  ): Promise<ResolvedArtistResult> {
    const outcome = await this.resolveOrPrepare(catalogRepo, options);

    if (outcome.status === 'ambiguous') {
      throw new Error(
        `Ambiguous artist identity: multiple artists found named "${options.name}". Strong external ID evidence required.`,
      );
    }

    if (outcome.status === 'matched' && outcome.artist) {
      // Attach any non-conflicting external IDs if needed
      if (options.externalIds && options.externalIds.length > 0) {
        for (const ext of options.externalIds) {
          try {
            await catalogRepo.addArtistExternalId({
              artistId: outcome.artist.id,
              provider: ext.provider,
              externalId: ext.externalId,
              providerUrl: ext.providerUrl,
            });
          } catch {
            // Ignore duplicate constraint
          }
        }
      }

      return {
        artist: outcome.artist,
        isNew: false,
        matchMethod: outcome.reasons.includes('exact_external_id_match')
          ? 'external_id'
          : 'normalized_name',
      };
    }

    // Create artist standalone
    const toCreate = outcome.artistToCreate!;
    const created = await catalogRepo.createArtist({
      name: toCreate.name,
      normalizedName: toCreate.normalizedName,
    });

    if (toCreate.externalIds && toCreate.externalIds.length > 0) {
      for (const ext of toCreate.externalIds) {
        try {
          await catalogRepo.addArtistExternalId({
            artistId: created.id,
            provider: ext.provider,
            externalId: ext.externalId,
            providerUrl: ext.providerUrl,
          });
        } catch {
          // Ignore unique conflicts
        }
      }
    }

    return {
      artist: created,
      isNew: true,
      matchMethod: 'created',
    };
  }
}
