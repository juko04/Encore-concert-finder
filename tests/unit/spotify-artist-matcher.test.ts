import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeName } from '@/lib/domain/value-objects';
import {
  clearSpotifyArtistResolutionCache,
  getSpotifyArtistResolutionCacheSize,
  matchSpotifyArtist,
  matchSpotifyArtists,
  SpotifyArtistMatcher,
  type SpotifyArtistCandidate,
} from '@/lib/entity-resolution/spotify-artist-matcher';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';

describe('SpotifyArtistMatcher', () => {
  let catalogRepo: MemoryCatalogRepository;
  let matcher: SpotifyArtistMatcher;

  beforeEach(() => {
    catalogRepo = new MemoryCatalogRepository();
    matcher = new SpotifyArtistMatcher(catalogRepo);
    clearSpotifyArtistResolutionCache();
  });

  describe('Boundary Condition 1: Exact Spotify ID Match', () => {
    it('matches an artist with an existing verified Spotify external ID via Step 1', async () => {
      const canonical = await catalogRepo.createArtist({
        name: 'Radiohead',
        normalizedName: normalizeName('Radiohead'),
      });
      await catalogRepo.addArtistExternalId({
        artistId: canonical.id,
        provider: 'spotify',
        externalId: 'spotify_rh_001',
        providerUrl: 'https://open.spotify.com/artist/spotify_rh_001',
      });

      const candidate: SpotifyArtistCandidate = {
        id: 'spotify_rh_001',
        name: 'Radiohead UK Tour', // Even if name variant differs, external ID is authoritative
        spotifyUrl: 'https://open.spotify.com/artist/spotify_rh_001',
      };

      const result = await matcher.matchArtist(candidate);

      expect(result.status).toBe('matched');
      if (result.status === 'matched') {
        expect(result.artistId).toBe(canonical.id);
        expect(result.artistName).toBe('Radiohead');
        expect(result.matchMethod).toBe('exact_external_id');
        expect(result.wasEnriched).toBe(false);
        expect(result.spotifyId).toBe('spotify_rh_001');
      }
    });
  });

  describe('Boundary Condition 2: Name Match Enrichment', () => {
    it('matches an existing clean canonical artist by name and safely enriches external ID', async () => {
      const canonical = await catalogRepo.createArtist({
        name: 'Phoebe Bridgers',
        normalizedName: normalizeName('Phoebe Bridgers'),
      });

      // Initially no external IDs
      const initialExtIds = await catalogRepo.findArtistExternalIds(
        canonical.id,
      );
      expect(initialExtIds).toHaveLength(0);

      const candidate: SpotifyArtistCandidate = {
        id: 'spotify_pb_002',
        name: 'Phoebe Bridgers',
        spotifyUrl: 'https://open.spotify.com/artist/spotify_pb_002',
      };

      const result = await matcher.matchArtist(candidate);

      expect(result.status).toBe('matched');
      if (result.status === 'matched') {
        expect(result.artistId).toBe(canonical.id);
        expect(result.artistName).toBe('Phoebe Bridgers');
        expect(result.matchMethod).toBe('verified_canonical_name');
        expect(result.wasEnriched).toBe(true);
      }

      // Verify DB was enriched
      const enrichedExtIds = await catalogRepo.findArtistExternalIds(
        canonical.id,
      );
      expect(enrichedExtIds).toHaveLength(1);
      expect(enrichedExtIds[0]).toMatchObject({
        artistId: canonical.id,
        provider: 'spotify',
        externalId: 'spotify_pb_002',
      });
    });
  });

  describe('Boundary Condition 3: Read-Only Match (allowEnrichment: false)', () => {
    it('matches by name but does not mutate catalog when allowEnrichment is false', async () => {
      const canonical = await catalogRepo.createArtist({
        name: 'Bon Iver',
        normalizedName: normalizeName('Bon Iver'),
      });

      const candidate: SpotifyArtistCandidate = {
        id: 'spotify_bi_003',
        name: 'Bon Iver',
      };

      const result = await matcher.matchArtist(candidate, {
        allowEnrichment: false,
      });

      expect(result.status).toBe('matched');
      if (result.status === 'matched') {
        expect(result.artistId).toBe(canonical.id);
        expect(result.matchMethod).toBe('verified_canonical_name');
        expect(result.wasEnriched).toBe(false);
      }

      // Catalog must remain clean
      const extIds = await catalogRepo.findArtistExternalIds(canonical.id);
      expect(extIds).toHaveLength(0);
    });
  });

  describe('Boundary Condition 4: Multi-Artist Same-Name Collision -> Ambiguous', () => {
    it('marks collision as ambiguous when multiple canonical artists share the normalized name', async () => {
      const artistA = await catalogRepo.createArtist({
        name: 'Ghost',
        normalizedName: normalizeName('Ghost'),
      });
      const artistB = await catalogRepo.createArtist({
        name: 'Ghost (UK)',
        normalizedName: normalizeName('Ghost'),
      });

      const candidate: SpotifyArtistCandidate = {
        id: 'spotify_ghost_004',
        name: 'Ghost',
      };

      const result = await matcher.matchArtist(candidate);

      expect(result.status).toBe('ambiguous');
      if (result.status === 'ambiguous') {
        expect(result.reason).toBe('multiple_canonical_artists_with_same_name');
        expect(result.candidateArtistIds).toContain(artistA.id);
        expect(result.candidateArtistIds).toContain(artistB.id);
      }

      // Neither artist should receive the Spotify external ID
      const extA = await catalogRepo.findArtistExternalIds(artistA.id);
      const extB = await catalogRepo.findArtistExternalIds(artistB.id);
      expect(extA).toHaveLength(0);
      expect(extB).toHaveLength(0);
    });
  });

  describe('Boundary Condition 5: Conflicting Spotify ID on Canonical Artist -> Ambiguous', () => {
    it('marks collision as ambiguous when candidate matches name but canonical artist already has a different Spotify ID', async () => {
      const canonical = await catalogRepo.createArtist({
        name: 'Alvvays',
        normalizedName: normalizeName('Alvvays'),
      });
      await catalogRepo.addArtistExternalId({
        artistId: canonical.id,
        provider: 'spotify',
        externalId: 'spotify_alvvays_VERIFIED',
      });

      // Incoming candidate with different Spotify ID
      const candidate: SpotifyArtistCandidate = {
        id: 'spotify_alvvays_DIFFERENT',
        name: 'Alvvays',
      };

      const result = await matcher.matchArtist(candidate);

      expect(result.status).toBe('ambiguous');
      if (result.status === 'ambiguous') {
        expect(result.reason).toBe('conflicting_spotify_external_id');
        expect(result.candidateArtistIds).toEqual([canonical.id]);
      }

      // Original external ID must be intact and not overwritten
      const extIds = await catalogRepo.findArtistExternalIds(canonical.id);
      expect(extIds).toHaveLength(1);
      expect(extIds[0].externalId).toBe('spotify_alvvays_VERIFIED');
    });
  });

  describe('Boundary Condition 6: Unmatched Spotify Artists', () => {
    it('returns unmatched when artist name is not found in the catalog', async () => {
      const candidate: SpotifyArtistCandidate = {
        id: 'spotify_unknown_006',
        name: 'Totally Obscure Underground Act',
      };

      const result = await matcher.matchArtist(candidate);

      expect(result.status).toBe('unmatched');
      if (result.status === 'unmatched') {
        expect(result.reason).toBe('not_found_in_catalog');
        expect(result.spotifyId).toBe('spotify_unknown_006');
      }
    });

    it('returns unmatched for empty or invalid names', async () => {
      const resultEmptyName = await matcher.matchArtist({
        id: 'spotify_empty_name',
        name: '   ',
      });
      expect(resultEmptyName.status).toBe('unmatched');

      const resultEmptyId = await matcher.matchArtist({
        id: '',
        name: 'Some Artist',
      });
      expect(resultEmptyId.status).toBe('unmatched');
    });
  });

  describe('Boundary Condition 7: Idempotency', () => {
    it('repeated matching with same data produces identical results without error or duplicate records', async () => {
      // 1. Exact ID artist
      const exactArtist = await catalogRepo.createArtist({
        name: 'Arctic Monkeys',
        normalizedName: normalizeName('Arctic Monkeys'),
      });
      await catalogRepo.addArtistExternalId({
        artistId: exactArtist.id,
        provider: 'spotify',
        externalId: 'sp_am_1',
      });

      // 2. Name match candidate
      const nameArtist = await catalogRepo.createArtist({
        name: 'Fontaines D.C.',
        normalizedName: normalizeName('Fontaines D.C.'),
      });

      // 3. Ambiguous (conflicting)
      const conflictArtist = await catalogRepo.createArtist({
        name: 'Wet Leg',
        normalizedName: normalizeName('Wet Leg'),
      });
      await catalogRepo.addArtistExternalId({
        artistId: conflictArtist.id,
        provider: 'spotify',
        externalId: 'sp_wetleg_existing',
      });

      const batch: SpotifyArtistCandidate[] = [
        { id: 'sp_am_1', name: 'Arctic Monkeys' },
        { id: 'sp_fontaines_2', name: 'Fontaines D.C.' },
        { id: 'sp_wetleg_conflict', name: 'Wet Leg' },
        { id: 'sp_unmatched_4', name: 'Nonexistent Band' },
      ];

      // Run 1: Enriches Fontaines D.C.
      const report1 = await matcher.matchBatch(batch);
      expect(report1.summary.matchedCount).toBe(2);
      expect(report1.summary.enrichedCount).toBe(1);
      expect(report1.summary.ambiguousCount).toBe(1);
      expect(report1.summary.unmatchedCount).toBe(1);

      // Run 2: Repeated matching without cache
      const report2 = await matcher.matchBatch(batch, { useCache: false });

      // Entities resolved must be identical
      expect(report2.matched.map((m) => m.artistId)).toEqual(
        report1.matched.map((m) => m.artistId),
      );
      expect(report2.unmatched.map((u) => u.spotifyId)).toEqual(
        report1.unmatched.map((u) => u.spotifyId),
      );
      expect(report2.ambiguous.map((a) => a.spotifyId)).toEqual(
        report1.ambiguous.map((a) => a.spotifyId),
      );
      expect(report2.summary.matchedCount).toBe(report1.summary.matchedCount);
      expect(report2.summary.unmatchedCount).toBe(
        report1.summary.unmatchedCount,
      );
      expect(report2.summary.ambiguousCount).toBe(
        report1.summary.ambiguousCount,
      );

      // Verify no duplicate external IDs were created in DB
      const fontainesExt = await catalogRepo.findArtistExternalIds(
        nameArtist.id,
      );
      expect(fontainesExt).toHaveLength(1);
      expect(fontainesExt[0].externalId).toBe('sp_fontaines_2');
    });
  });

  describe('Boundary Condition 8: Batch Resolution with Summary Metrics', () => {
    it('correctly aggregates batch reports and summary metrics', async () => {
      // 1. Exact ID
      const a1 = await catalogRepo.createArtist({
        name: 'The Cure',
        normalizedName: normalizeName('The Cure'),
      });
      await catalogRepo.addArtistExternalId({
        artistId: a1.id,
        provider: 'spotify',
        externalId: 'sp_cure',
      });

      // 2. Name match (clean -> to enrich)
      const a2 = await catalogRepo.createArtist({
        name: 'Depeche Mode',
        normalizedName: normalizeName('Depeche Mode'),
      });

      // 3. Multi-artist collision
      await catalogRepo.createArtist({
        name: 'Oasis (Original)',
        normalizedName: normalizeName('Oasis'),
      });
      await catalogRepo.createArtist({
        name: 'Oasis (Tribute)',
        normalizedName: normalizeName('Oasis'),
      });

      // 4. Conflicting Spotify ID
      const a4 = await catalogRepo.createArtist({
        name: 'New Order',
        normalizedName: normalizeName('New Order'),
      });
      await catalogRepo.addArtistExternalId({
        artistId: a4.id,
        provider: 'spotify',
        externalId: 'sp_neworder_true',
      });

      const batch: SpotifyArtistCandidate[] = [
        { id: 'sp_cure', name: 'The Cure' },
        { id: 'sp_depeche', name: 'Depeche Mode' },
        { id: 'sp_oasis', name: 'Oasis' },
        { id: 'sp_neworder_fake', name: 'New Order' },
        { id: 'sp_unknown', name: 'Unknown Band' },
      ];

      const report = await matcher.matchBatch(batch);

      expect(report.summary).toEqual({
        total: 5,
        matchedCount: 2,
        unmatchedCount: 1,
        ambiguousCount: 2,
        enrichedCount: 1,
      });

      expect(report.matched).toHaveLength(2);
      expect(
        report.matched.find((m) => m.spotifyId === 'sp_cure')?.artistId,
      ).toBe(a1.id);
      expect(
        report.matched.find((m) => m.spotifyId === 'sp_depeche')?.artistId,
      ).toBe(a2.id);
      expect(report.unmatched).toHaveLength(1);
      expect(report.ambiguous).toHaveLength(2);
    });

    it('handles empty batch gracefully', async () => {
      const report = await matcher.matchBatch([]);
      expect(report.summary).toEqual({
        total: 0,
        matchedCount: 0,
        unmatchedCount: 0,
        ambiguousCount: 0,
        enrichedCount: 0,
      });
      expect(report.matched).toHaveLength(0);
      expect(report.unmatched).toHaveLength(0);
      expect(report.ambiguous).toHaveLength(0);
    });
  });

  describe('In-Memory Resolution Cache', () => {
    it('caches resolutions and avoids repeated queries when useCache is enabled', async () => {
      const artist = await catalogRepo.createArtist({
        name: 'Arcade Fire',
        normalizedName: normalizeName('Arcade Fire'),
      });

      const candidate: SpotifyArtistCandidate = {
        id: 'sp_arcade_fire',
        name: 'Arcade Fire',
      };

      expect(getSpotifyArtistResolutionCacheSize()).toBe(0);

      // First call with useCache: true
      const report1 = await matcher.matchBatch([candidate], { useCache: true });
      expect(report1.summary.matchedCount).toBe(1);
      expect(report1.summary.enrichedCount).toBe(1);
      expect(getSpotifyArtistResolutionCacheSize()).toBe(1);

      // Second call from cache: wasEnriched is false on cache hit
      const report2 = await matcher.matchBatch([candidate], { useCache: true });
      expect(report2.summary.matchedCount).toBe(1);
      expect(report2.matched[0].artistId).toBe(artist.id);
      expect(report2.matched[0].wasEnriched).toBe(false);

      // Selective cache clearing
      clearSpotifyArtistResolutionCache('sp_arcade_fire');
      expect(getSpotifyArtistResolutionCacheSize()).toBe(0);
    });

    it('clears entire resolution cache with clearSpotifyArtistResolutionCache()', async () => {
      await matcher.matchBatch(
        [
          { id: 'sp_c1', name: 'Nonexistent 1' },
          { id: 'sp_c2', name: 'Nonexistent 2' },
        ],
        { useCache: true },
      );
      expect(getSpotifyArtistResolutionCacheSize()).toBe(2);

      clearSpotifyArtistResolutionCache();
      expect(getSpotifyArtistResolutionCacheSize()).toBe(0);
    });
  });

  describe('Standalone Helper Functions & Call Signatures', () => {
    it('matchSpotifyArtist works directly with repository argument', async () => {
      const canonical = await catalogRepo.createArtist({
        name: 'Tame Impala',
        normalizedName: normalizeName('Tame Impala'),
      });

      const result = await matchSpotifyArtist(
        { id: 'sp_tame', name: 'Tame Impala' },
        catalogRepo,
      );

      expect(result.status).toBe('matched');
      if (result.status === 'matched') {
        expect(result.artistId).toBe(canonical.id);
      }
    });

    it('matchSpotifyArtists batch works directly with repository argument', async () => {
      const report = await matchSpotifyArtists(
        [{ id: 'sp_test', name: 'Nonexistent' }],
        catalogRepo,
      );
      expect(report.summary.unmatchedCount).toBe(1);
    });

    it('works when repo is passed to matchBatch rather than constructor', async () => {
      const emptyMatcher = new SpotifyArtistMatcher();
      const canonical = await catalogRepo.createArtist({
        name: 'Sigur Rós',
        normalizedName: normalizeName('Sigur Rós'),
      });

      const report = await emptyMatcher.matchBatch(
        [{ id: 'sp_sigur', name: 'Sigur Rós' }],
        catalogRepo,
      );

      expect(report.summary.matchedCount).toBe(1);
      expect(report.matched[0].artistId).toBe(canonical.id);
    });
  });
});
