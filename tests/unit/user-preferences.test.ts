import { describe, expect, it } from 'vitest';
import {
  MemoryCatalogRepository,
  MemoryUserPreferenceRepository,
} from '@/lib/repositories/memory-repositories';
import { escapeLikePattern, normalizeName } from '@/lib/domain/value-objects';
import { sanitizeRedirectPath } from '@/lib/auth/redirect';
import {
  ConflictingArtistIdentityError,
  InvalidCatalogArtistError,
  type PreferenceLevel,
  type UserArtistPreference,
} from '@/lib/domain/user-preference';

describe('Authentication Redirect Sanitization', () => {
  it('allows valid internal relative paths', () => {
    expect(sanitizeRedirectPath('/profile/taste')).toBe('/profile/taste');
    expect(sanitizeRedirectPath('/taste')).toBe('/taste');
    expect(sanitizeRedirectPath('/discover?genre=electronic#top')).toBe(
      '/discover?genre=electronic#top',
    );
    expect(sanitizeRedirectPath('/events/123')).toBe('/events/123');
  });

  it('rejects external URLs, protocol-relative paths, and schemes, defaulting to fallback', () => {
    expect(sanitizeRedirectPath('https://evil.com')).toBe('/profile/taste');
    expect(sanitizeRedirectPath('http://attacker.com/steal')).toBe(
      '/profile/taste',
    );
    expect(sanitizeRedirectPath('//evil.com')).toBe('/profile/taste');
    expect(sanitizeRedirectPath('///evil.com')).toBe('/profile/taste');
    expect(sanitizeRedirectPath('/\\evil.com')).toBe('/profile/taste');
    expect(sanitizeRedirectPath('javascript:alert(1)')).toBe('/profile/taste');
    expect(sanitizeRedirectPath('/javascript:alert(1)')).toBe('/profile/taste');
    expect(
      sanitizeRedirectPath('data:text/html,<script>alert(1)</script>'),
    ).toBe('/profile/taste');
  });

  it('rejects backslashes, control characters, and whitespace anomalies', () => {
    expect(sanitizeRedirectPath('\\evil.com')).toBe('/profile/taste');
    expect(sanitizeRedirectPath('/foo\\bar')).toBe('/profile/taste');
    expect(sanitizeRedirectPath('/foo\nbar')).toBe('/profile/taste');
    expect(sanitizeRedirectPath('/foo\u0000bar')).toBe('/profile/taste');
    expect(sanitizeRedirectPath('relative/path/without/leading/slash')).toBe(
      '/profile/taste',
    );
    expect(sanitizeRedirectPath('')).toBe('/profile/taste');
    expect(sanitizeRedirectPath(null)).toBe('/profile/taste');
    expect(sanitizeRedirectPath(undefined)).toBe('/profile/taste');
  });

  it('honors custom fallback when provided', () => {
    expect(sanitizeRedirectPath('https://evil.com', '/discover')).toBe(
      '/discover',
    );
  });
});

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

  it('does not silently link or upgrade uncataloged artist preferences by name alone', async () => {
    const catalogRepo = new MemoryCatalogRepository();
    const prefRepo = new MemoryUserPreferenceRepository(catalogRepo);
    const userId = 'user-uuid-1';

    // 1. User originally added as uncataloged
    const uncataloged = await prefRepo.savePreference({
      userId,
      artistName: 'Khruangbin',
      artistId: null,
      preferenceLevel: 'like',
    });
    expect(uncataloged.artistId).toBeNull();

    // 2. Later, canonical artist exists in catalog
    const canonical = await catalogRepo.createArtist({
      name: 'Khruangbin',
      normalizedName: normalizeName('Khruangbin'),
    });

    // 3. User adds canonical artist explicitly
    const canonicalPref = await prefRepo.savePreference({
      userId,
      artistName: 'Khruangbin',
      artistId: canonical.id,
      preferenceLevel: 'favorite',
    });

    // Invariant: Uncataloged preference remains uncataloged and separate;
    // it is NOT silently upgraded or overwritten!
    expect(canonicalPref.id).not.toBe(uncataloged.id);
    expect(canonicalPref.artistId).toBe(canonical.id);
    expect(canonicalPref.preferenceLevel).toBe('favorite');

    const list = await prefRepo.getPreferences(userId);
    expect(list.length).toBe(2);
    expect(
      list.some((p) => p.id === uncataloged.id && p.artistId === null),
    ).toBe(true);
    expect(
      list.some(
        (p) => p.id === canonicalPref.id && p.artistId === canonical.id,
      ),
    ).toBe(true);
  });

  it('validates canonical artist existence against catalog when artistId is provided', async () => {
    const catalogRepo = new MemoryCatalogRepository();
    const prefRepo = new MemoryUserPreferenceRepository(catalogRepo);
    const userId = 'user-uuid-1';

    await expect(
      prefRepo.savePreference({
        userId,
        artistName: 'Nonexistent Band',
        artistId: 'fake-catalog-uuid',
        preferenceLevel: 'like',
      }),
    ).rejects.toThrow(InvalidCatalogArtistError);
  });

  it('preserves preferences when catalog records change or canonical artist is deleted (ON DELETE SET NULL behavior)', async () => {
    const catalogRepo = new MemoryCatalogRepository();
    const prefRepo = new MemoryUserPreferenceRepository(catalogRepo);
    const userId = 'user-uuid-1';

    const canonicalArtist = await catalogRepo.createArtist({
      name: 'Daft Punk',
      normalizedName: normalizeName('Daft Punk'),
    });

    // User favorites a canonical artist
    const pref = await prefRepo.savePreference({
      userId,
      artistName: 'Daft Punk',
      artistId: canonicalArtist.id,
      preferenceLevel: 'favorite',
    });

    expect(pref.artistId).toBe(canonicalArtist.id);

    // Simulate canonical artist retiring or being deleted from catalog
    prefRepo.simulateCanonicalArtistDeletion(canonicalArtist.id);

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

  it('updates archived vs free-text preferences with the same artist name independently by preference ID', async () => {
    const prefRepo = new MemoryUserPreferenceRepository();
    const userId = 'user-archived-test';
    const artistName = 'Collision Band';

    // 1. Add free-text (uncataloged) preference
    const freeTextPref = await prefRepo.savePreference({
      userId,
      artistName,
      artistId: null,
      preferenceLevel: 'interested',
    });
    expect(freeTextPref.artistId).toBeNull();
    expect(freeTextPref.archivedArtistId).toBeNull();

    // 2. Add an archived preference directly into repo state (simulating a deleted canonical artist)
    const archivedId = 'archived-pref-uuid';
    const originalArtistId = 'canonical-artist-uuid';
    const now = new Date().toISOString();
    const archivedPref: UserArtistPreference = {
      id: archivedId,
      userId,
      artistId: null,
      archivedArtistId: originalArtistId,
      artistName,
      normalizedArtistName: normalizeName(artistName),
      preferenceLevel: 'favorite',
      createdAt: now,
      updatedAt: now,
    };
    (
      prefRepo as unknown as {
        preferences: Map<string, UserArtistPreference>;
      }
    ).preferences.set(archivedId, archivedPref);

    // Both preferences exist for user with exact same artist name
    const all = await prefRepo.getPreferences(userId);
    expect(all.length).toBe(2);

    // 3. Update archived preference level to 'like' using updatePreferenceLevel
    const updatedArchived = await prefRepo.updatePreferenceLevel(
      userId,
      archivedId,
      'like',
    );
    expect(updatedArchived.id).toBe(archivedId);
    expect(updatedArchived.preferenceLevel).toBe('like');

    // Invariant: Free-text preference remains completely unchanged!
    const freeTextAfter = await prefRepo.getPreference(userId, freeTextPref.id);
    expect(freeTextAfter?.preferenceLevel).toBe('interested');

    // 4. Update free-text preference level to 'dislike' using updatePreferenceLevel
    const updatedFreeText = await prefRepo.updatePreferenceLevel(
      userId,
      freeTextPref.id,
      'dislike',
    );
    expect(updatedFreeText.id).toBe(freeTextPref.id);
    expect(updatedFreeText.preferenceLevel).toBe('dislike');

    // Invariant: Archived preference remains completely unchanged!
    const archivedAfter = await prefRepo.getPreference(userId, archivedId);
    expect(archivedAfter?.preferenceLevel).toBe('like');
  });

  describe('Spotify Identity Preservation and Validation', () => {
    it('preserves existing spotify_artist_id when catalog search preference update omits provider ID', async () => {
      const catalogRepo = new MemoryCatalogRepository();
      const prefRepo = new MemoryUserPreferenceRepository(catalogRepo);
      const userId = 'user-spotify-preserve-test';

      const canonical = await catalogRepo.createArtist({
        name: 'Portishead',
        normalizedName: normalizeName('Portishead'),
      });

      catalogRepo.artistExternalIds.set('ext-portishead', {
        id: 'ext-portishead',
        artistId: canonical.id,
        provider: 'spotify',
        externalId: 'spot-portishead-123',
      });

      // 1. User initially confirms artist via Spotify recommendation
      const initialPref = await prefRepo.savePreference({
        userId,
        artistName: 'Portishead',
        spotifyArtistId: 'spot-portishead-123',
        preferenceLevel: 'favorite',
      });

      expect(initialPref.artistId).toBe(canonical.id);
      expect(initialPref.spotifyArtistId).toBe('spot-portishead-123');

      // 2. Later, user updates preference level via ordinary catalog search (providing artistId without spotifyArtistId)
      const updatedPref = await prefRepo.savePreference({
        userId,
        artistId: canonical.id,
        artistName: 'Portishead',
        preferenceLevel: 'like',
      });

      // Invariant: Exact preference is updated and spotify_artist_id is preserved!
      expect(updatedPref.id).toBe(initialPref.id);
      expect(updatedPref.preferenceLevel).toBe('like');
      expect(updatedPref.spotifyArtistId).toBe('spot-portishead-123');

      const reloaded = await prefRepo.getPreference(userId, initialPref.id);
      expect(reloaded?.spotifyArtistId).toBe('spot-portishead-123');
    });

    it('rejects contradictory canonical and Spotify identities with ConflictingArtistIdentityError', async () => {
      const catalogRepo = new MemoryCatalogRepository();
      const prefRepo = new MemoryUserPreferenceRepository(catalogRepo);
      const userId = 'user-conflict-test';

      const artistA = await catalogRepo.createArtist({
        name: 'Artist A',
        normalizedName: normalizeName('Artist A'),
      });
      const artistB = await catalogRepo.createArtist({
        name: 'Artist B',
        normalizedName: normalizeName('Artist B'),
      });

      catalogRepo.artistExternalIds.set('ext-a', {
        id: 'ext-a',
        artistId: artistA.id,
        provider: 'spotify',
        externalId: 'spot-a-111',
      });
      catalogRepo.artistExternalIds.set('ext-b', {
        id: 'ext-b',
        artistId: artistB.id,
        provider: 'spotify',
        externalId: 'spot-b-222',
      });

      // Client attempts to supply artist A's canonical ID with artist B's Spotify ID
      await expect(
        prefRepo.savePreference({
          userId,
          artistId: artistA.id,
          artistName: 'Artist A',
          spotifyArtistId: 'spot-b-222',
          preferenceLevel: 'favorite',
        }),
      ).rejects.toThrow(ConflictingArtistIdentityError);
    });

    it('rejects arbitrary unverified Spotify ID provided with canonical artist ID', async () => {
      const catalogRepo = new MemoryCatalogRepository();
      const prefRepo = new MemoryUserPreferenceRepository(catalogRepo);
      const userId = 'user-unverified-test';

      const artistC = await catalogRepo.createArtist({
        name: 'Artist C',
        normalizedName: normalizeName('Artist C'),
      });

      // Artist C has no external IDs mapped
      await expect(
        prefRepo.savePreference({
          userId,
          artistId: artistC.id,
          artistName: 'Artist C',
          spotifyArtistId: 'spot-arbitrary-unverified',
          preferenceLevel: 'like',
        }),
      ).rejects.toThrow(ConflictingArtistIdentityError);
    });

    it('keeps two distinct same-name Spotify artists independent without collision', async () => {
      const catalogRepo = new MemoryCatalogRepository();
      const prefRepo = new MemoryUserPreferenceRepository(catalogRepo);
      const userId = 'user-same-name-test';

      // 1. Add first artist 'Aurora' (Norway)
      const pref1 = await prefRepo.savePreference({
        userId,
        artistName: 'Aurora',
        spotifyArtistId: 'spot-aurora-no',
        preferenceLevel: 'favorite',
      });

      // 2. Add second artist 'Aurora' (USA)
      const pref2 = await prefRepo.savePreference({
        userId,
        artistName: 'Aurora',
        spotifyArtistId: 'spot-aurora-us',
        preferenceLevel: 'interested',
      });

      // Invariant: Two separate records exist with distinct IDs
      expect(pref1.id).not.toBe(pref2.id);
      expect(pref1.spotifyArtistId).toBe('spot-aurora-no');
      expect(pref2.spotifyArtistId).toBe('spot-aurora-us');

      // 3. Updating pref1 leaves pref2 unchanged
      const updated1 = await prefRepo.updatePreferenceLevel(
        userId,
        pref1.id,
        'like',
      );
      expect(updated1.preferenceLevel).toBe('like');

      const reloaded2 = await prefRepo.getPreference(userId, pref2.id);
      expect(reloaded2?.preferenceLevel).toBe('interested');
      expect(reloaded2?.spotifyArtistId).toBe('spot-aurora-us');

      const all = await prefRepo.getPreferences(userId);
      expect(all.length).toBe(2);
    });
  });
});
