import type { Artist } from '@/lib/domain/catalog';
import { normalizeName } from '@/lib/domain/value-objects';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';

export interface ResolveArtistOptions {
  name: string;
  externalIds?: Array<{
    provider: string;
    externalId: string;
    providerUrl?: string | null;
  }>;
}

export interface ResolvedArtistResult {
  artist: Artist;
  isNew: boolean;
  matchMethod: 'external_id' | 'normalized_name' | 'created';
}

export class ArtistResolver {
  async resolve(
    catalogRepo: ICatalogRepository,
    options: ResolveArtistOptions,
  ): Promise<ResolvedArtistResult> {
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
          return {
            artist: matched,
            isNew: false,
            matchMethod: 'external_id',
          };
        }
      }
    }

    // 2. Resolve by normalized artist name
    const normalizedName = normalizeName(rawName);
    const existing = await catalogRepo.findArtistByName(normalizedName);

    if (existing) {
      // Attach any new external IDs to the existing artist
      if (options.externalIds && options.externalIds.length > 0) {
        for (const ext of options.externalIds) {
          try {
            await catalogRepo.addArtistExternalId({
              artistId: existing.id,
              provider: ext.provider,
              externalId: ext.externalId,
              providerUrl: ext.providerUrl,
            });
          } catch {
            // Unique constraint violation or existing ID is expected and ignored
          }
        }
      }

      return {
        artist: existing,
        isNew: false,
        matchMethod: 'normalized_name',
      };
    }

    // 3. Create new canonical artist
    const created = await catalogRepo.createArtist({
      name: rawName,
      normalizedName,
    });

    if (options.externalIds && options.externalIds.length > 0) {
      for (const ext of options.externalIds) {
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
