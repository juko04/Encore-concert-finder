import { describe, expect, it } from 'vitest';
import {
  MemoryCatalogRepository,
  MemoryUserPreferenceRepository,
} from '@/lib/repositories/memory-repositories';
import { escapeLikePattern, normalizeName } from '@/lib/domain/value-objects';
import type { PreferenceLevel } from '@/lib/domain/user-preference';

describe('Phase 2 PR 4A — User Artist Preferences & Search Safety', () => {
  it('escapes SQL LIKE wildcard characters to ensure literal substring searching', () => {
    expect(escapeLikePattern('Radiohead')).toBe('Radiohead');
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('artist_name')).toBe('artist\\_name');
    expect(escapeLikePattern('back\\slash')).toBe('back\\\\slash');
    expect(escapeLikePattern('100%_pure\\rock')).toBe('100\\%\\_pure\\\\rock');
    expect(escapeLikePattern('')).toBe('');
  });

  it('searches known artists with case-insensitivity, normalization, and bounds', async () => {
    const catalogRepo = new MemoryCatalogRepository();
    await catalogRepo.createArtist({
      name: 'Radiohead',
      normalizedName: normalizeName('Radiohead'),
      imageUrl: 'https://images.example.com/radiohead.jpg',
    });
    await catalogRepo.createArtist({
      name: 'The National',
      normalizedName: normalizeName('The National'),
    });
    await catalogRepo.createArtist({
      name: 'Radiant Children',
      normalizedName: normalizeName('Radiant Children'),
    });

    // Substring match
    const matches = await catalogRepo.searchArtists('radi');
    expect(matches.length).toBe(2);
    expect(matches.map((a) => a.name).sort()).toEqual([
      'Radiant Children',
      'Radiohead',
    ]);

    // Bounded search
    const bounded = await catalogRepo.searchArtists('radi', 1);
    expect(bounded.length).toBe(1);

    // Empty query returns empty array
    const empty = await catalogRepo.searchArtists('   ');
    expect(empty).toEqual([]);
  });

  it('creates and retrieves explicit user preferences', async () => {
    const prefRepo = new MemoryUserPreferenceRepository();
    const userId = 'user-uuid-1';

    const saved = await prefRepo.savePreference({
      userId,
      artistName: 'Radiohead',
      artistId: 'artist-uuid-radiohead',
      preferenceLevel: 'favorite',
    });

    expect(saved.id).toBeDefined();
    expect(saved.userId).toBe(userId);
    expect(saved.artistName).toBe('Radiohead');
    expect(saved.artistId).toBe('artist-uuid-radiohead');
    expect(saved.preferenceLevel).toBe('favorite');

    const list = await prefRepo.getPreferences(userId);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(saved.id);
  });

  it('adds an artist absent from the catalog as uncataloged without creating canonical artists', async () => {
    const catalogRepo = new MemoryCatalogRepository();
    const prefRepo = new MemoryUserPreferenceRepository(catalogRepo);
    const userId = 'user-uuid-1';

    const saved = await prefRepo.savePreference({
      userId,
      artistName: 'Local Garage Band',
      artistId: null,
      preferenceLevel: 'interested',
    });

    expect(saved.artistId).toBeNull();
    expect(saved.artistName).toBe('Local Garage Band');
    expect(saved.preferenceLevel).toBe('interested');

    // Invariant: canonical artists table was NOT mutated by uncataloged user preference
    const inCatalog = await catalogRepo.findArtistByName(
      normalizeName('Local Garage Band'),
    );
    expect(inCatalog).toBeNull();
  });

  it('prevents duplicate preference rows by updating existing preferences when re-saved', async () => {
    const prefRepo = new MemoryUserPreferenceRepository();
    const userId = 'user-uuid-1';

    // First save: favorite
    const initial = await prefRepo.savePreference({
      userId,
      artistName: 'Portishead',
      artistId: 'artist-portishead',
      preferenceLevel: 'favorite',
    });

    // Second save: change to like
    const updated = await prefRepo.savePreference({
      userId,
      artistName: 'Portishead',
      artistId: 'artist-portishead',
      preferenceLevel: 'like',
    });

    expect(updated.id).toBe(initial.id);
    expect(updated.preferenceLevel).toBe('like');

    // User only has 1 preference row
    const userPrefs = await prefRepo.getPreferences(userId);
    expect(userPrefs.length).toBe(1);
    expect(userPrefs[0].preferenceLevel).toBe('like');
  });

  it('upgrades an uncataloged artist preference when canonical artist is linked', async () => {
    const prefRepo = new MemoryUserPreferenceRepository();
    const userId = 'user-uuid-1';

    // 1. User originally added as uncataloged
    const uncataloged = await prefRepo.savePreference({
      userId,
      artistName: 'Khruangbin',
      artistId: null,
      preferenceLevel: 'like',
    });
    expect(uncataloged.artistId).toBeNull();

    // 2. Later, Khruangbin is linked to canonical catalog ID
    const upgraded = await prefRepo.savePreference({
      userId,
      artistName: 'Khruangbin',
      artistId: 'artist-khruangbin-id',
      preferenceLevel: 'favorite',
    });

    expect(upgraded.id).toBe(uncataloged.id);
    expect(upgraded.artistId).toBe('artist-khruangbin-id');
    expect(upgraded.preferenceLevel).toBe('favorite');

    const list = await prefRepo.getPreferences(userId);
    expect(list.length).toBe(1);
  });

  it('preserves preferences when catalog records change or canonical artist is deleted (ON DELETE SET NULL behavior)', async () => {
    const catalogRepo = new MemoryCatalogRepository();
    const prefRepo = new MemoryUserPreferenceRepository(catalogRepo);
    const userId = 'user-uuid-1';
    const canonicalArtistId = 'canonical-artist-123';

    // User favorites a canonical artist
    const pref = await prefRepo.savePreference({
      userId,
      artistName: 'Daft Punk',
      artistId: canonicalArtistId,
      preferenceLevel: 'favorite',
    });

    expect(pref.artistId).toBe(canonicalArtistId);

    // Simulate canonical artist retiring or being deleted from catalog
    prefRepo.simulateCanonicalArtistDeletion(canonicalArtistId);

    // User preference must NOT be deleted!
    const retrieved = await prefRepo.getPreference(userId, pref.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.artistId).toBeNull(); // Gracefully unlinked
    expect(retrieved?.artistName).toBe('Daft Punk'); // Name and preference preserved!
    expect(retrieved?.preferenceLevel).toBe('favorite');
  });

  it('removes a preference successfully', async () => {
    const prefRepo = new MemoryUserPreferenceRepository();
    const userId = 'user-uuid-1';

    const saved = await prefRepo.savePreference({
      userId,
      artistName: 'Massive Attack',
      artistId: 'massive-attack-id',
      preferenceLevel: 'favorite',
    });

    const deleted = await prefRepo.deletePreference(userId, saved.id);
    expect(deleted).toBe(true);

    const afterDelete = await prefRepo.getPreferences(userId);
    expect(afterDelete.length).toBe(0);
  });

  it('isolates user preferences between different users', async () => {
    const prefRepo = new MemoryUserPreferenceRepository();

    await prefRepo.savePreference({
      userId: 'user-a',
      artistName: 'Artist A',
      preferenceLevel: 'favorite',
    });

    await prefRepo.savePreference({
      userId: 'user-b',
      artistName: 'Artist B',
      preferenceLevel: 'like',
    });

    const prefsA = await prefRepo.getPreferences('user-a');
    const prefsB = await prefRepo.getPreferences('user-b');

    expect(prefsA.length).toBe(1);
    expect(prefsA[0].artistName).toBe('Artist A');

    expect(prefsB.length).toBe(1);
    expect(prefsB[0].artistName).toBe('Artist B');

    // User B cannot delete User A's preference
    const unauthorizedDelete = await prefRepo.deletePreference(
      'user-b',
      prefsA[0].id,
    );
    expect(unauthorizedDelete).toBe(false);
  });

  it('validates invalid preference values', async () => {
    const prefRepo = new MemoryUserPreferenceRepository();

    // Empty user ID
    await expect(
      prefRepo.savePreference({
        userId: '',
        artistName: 'Artist',
        preferenceLevel: 'favorite',
      }),
    ).rejects.toThrow('User ID is required');

    // Empty artist name
    await expect(
      prefRepo.savePreference({
        userId: 'user-1',
        artistName: '   ',
        preferenceLevel: 'favorite',
      }),
    ).rejects.toThrow('Artist name must not be empty');

    // Invalid preference level
    await expect(
      prefRepo.savePreference({
        userId: 'user-1',
        artistName: 'Artist',
        preferenceLevel: 'love_it' as unknown as PreferenceLevel,
      }),
    ).rejects.toThrow('Invalid preference level');
  });
});
