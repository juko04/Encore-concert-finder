import type { Artist } from '@/lib/domain/catalog';
import { normalizeName } from '@/lib/domain/value-objects';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';

export interface ResolveArtistInput {
  name: string;
  externalId?: {
    provider: string;
    externalId: string;
    providerUrl?: string;
  };
}

export class ArtistResolver {
  async resolve(
    catalogRepo: ICatalogRepository,
    input: ResolveArtistInput,
  ): Promise<Artist> {
    const rawName = input.name.trim();
    const normalized = normalizeName(rawName);

    // 1. Check external provider ID if available
    if (input.externalId) {
      const existingByExt = await catalogRepo.findArtistByExternalId(
        input.externalId.provider,
        input.externalId.externalId,
      );
      if (existingByExt) {
        return existingByExt;
      }
    }

    // 2. Check normalized name
    const existingByName = await catalogRepo.findArtistByName(normalized);
    if (existingByName) {
      if (input.externalId) {
        await catalogRepo.addArtistExternalId({
          artistId: existingByName.id,
          provider: input.externalId.provider,
          externalId: input.externalId.externalId,
          providerUrl: input.externalId.providerUrl ?? null,
        });
      }
      return existingByName;
    }

    // 3. Create new canonical artist
    const created = await catalogRepo.createArtist({
      name: rawName,
      normalizedName: normalized,
      imageUrl: null,
    });

    if (input.externalId) {
      await catalogRepo.addArtistExternalId({
        artistId: created.id,
        provider: input.externalId.provider,
        externalId: input.externalId.externalId,
        providerUrl: input.externalId.providerUrl ?? null,
      });
    }

    return created;
  }
}
