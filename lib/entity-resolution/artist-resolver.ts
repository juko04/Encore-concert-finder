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
  externalIdsToEnrich?: Array<{
    provider: string;
    externalId: string;
    providerUrl?: string | null;
  }>;
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

    // 1. Resolve by stable external identifier first (highest confidence)
    if (options.externalIds && options.externalIds.length > 0) {
      for (const ext of options.externalIds) {
        const matched = await catalogRepo.findArtistByExternalId(
          ext.provider,
          ext.externalId,
        );
        if (matched) {
          // If a contextual event artist was provided, verify it does not conflict
          if (
            options.disambiguatedArtistId &&
            matched.id !== options.disambiguatedArtistId
          ) {
            // Strong external ID points to Artist B, conflicting with contextual Artist A!
            return {
              status: 'ambiguous',
              reasons: ['conflicting_external_id_contextual_mismatch'],
            };
          }

          const enrichment = await this.evaluateExternalIdEnrichment(
            catalogRepo,
            matched.id,
            options.externalIds,
          );

          if (enrichment.conflictReason) {
            return {
              status: 'ambiguous',
              reasons: [enrichment.conflictReason],
            };
          }

          return {
            status: 'matched',
            artistId: matched.id,
            artist: matched,
            externalIdsToEnrich: enrichment.externalIdsToEnrich,
            reasons: ['exact_external_id_match'],
          };
        }
      }
    }

    // 2. Contextual disambiguation signal (only when it does not conflict with strong external-ID evidence)
    if (options.disambiguatedArtistId) {
      const existing = await catalogRepo.findArtistsByName(
        normalizeName(rawName),
      );
      const matched = existing.find(
        (a) => a.id === options.disambiguatedArtistId,
      );
      if (matched) {
        // If incoming candidate provided strong external IDs, verify they don't conflict with matched artist's external IDs
        if (options.externalIds && options.externalIds.length > 0) {
          const matchedExtIds = await catalogRepo.findArtistExternalIds(
            matched.id,
          );
          const hasConflict = options.externalIds.some((incomingExt) =>
            matchedExtIds.some(
              (e) =>
                e.provider === incomingExt.provider &&
                e.externalId !== incomingExt.externalId,
            ),
          );
          if (hasConflict) {
            return {
              status: 'ambiguous',
              reasons: ['conflicting_external_id_contextual_mismatch'],
            };
          }
        }

        const enrichment = await this.evaluateExternalIdEnrichment(
          catalogRepo,
          matched.id,
          options.externalIds,
        );

        if (enrichment.conflictReason) {
          return {
            status: 'ambiguous',
            reasons: [enrichment.conflictReason],
          };
        }

        return {
          status: 'matched',
          artistId: matched.id,
          artist: matched,
          externalIdsToEnrich: enrichment.externalIdsToEnrich,
          reasons: ['existing_canonical_event_artist_match'],
        };
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

  /**
   * Evaluates incoming external IDs against an already matched canonical artist.
   * Ensures non-conflicting IDs can be enriched, while detecting collisions or contradictory identities.
   */
  private async evaluateExternalIdEnrichment(
    catalogRepo: ICatalogRepository,
    matchedArtistId: string,
    incomingExternalIds?: Array<{
      provider: string;
      externalId: string;
      providerUrl?: string | null;
    }>,
  ): Promise<{
    externalIdsToEnrich?: Array<{
      provider: string;
      externalId: string;
      providerUrl?: string | null;
    }>;
    conflictReason?: string;
  }> {
    if (!incomingExternalIds || incomingExternalIds.length === 0) {
      return {};
    }

    const matchedExtIds =
      await catalogRepo.findArtistExternalIds(matchedArtistId);
    const toEnrich: Array<{
      provider: string;
      externalId: string;
      providerUrl?: string | null;
    }> = [];

    for (const incoming of incomingExternalIds) {
      const existingForProvider = matchedExtIds.find(
        (e) => e.provider === incoming.provider,
      );

      if (existingForProvider) {
        if (existingForProvider.externalId !== incoming.externalId) {
          return {
            conflictReason: 'conflicting_external_id_for_matched_artist',
          };
        }
        // Identical external ID already attached -> idempotent skip
        continue;
      }

      // Verify that no OTHER canonical artist already owns this incoming external ID
      const otherArtist = await catalogRepo.findArtistByExternalId(
        incoming.provider,
        incoming.externalId,
      );
      if (otherArtist && otherArtist.id !== matchedArtistId) {
        return {
          conflictReason:
            'external_id_already_associated_with_different_artist',
        };
      }

      toEnrich.push(incoming);
    }

    return {
      externalIdsToEnrich: toEnrich.length > 0 ? toEnrich : undefined,
    };
  }
}
