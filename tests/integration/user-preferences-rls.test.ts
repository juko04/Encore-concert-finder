import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';

interface LocalCredentials {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

function resolveSupabaseCredentials(): LocalCredentials | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && anonKey && serviceRoleKey) {
    return {
      url,
      anonKey,
      serviceRoleKey,
    };
  }

  try {
    const rawOutput = execSync('npx supabase status -o json', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(rawOutput) as {
      API_URL?: string;
      ANON_KEY?: string;
      SERVICE_ROLE_KEY?: string;
    };

    if (parsed.API_URL && parsed.ANON_KEY && parsed.SERVICE_ROLE_KEY) {
      return {
        url: url || parsed.API_URL,
        anonKey: anonKey || parsed.ANON_KEY,
        serviceRoleKey: serviceRoleKey || parsed.SERVICE_ROLE_KEY,
      };
    }
  } catch {
    // Supabase CLI status not available
  }

  return null;
}

describe('Row Level Security (RLS) on public.user_artist_preferences', () => {
  const credentials = resolveSupabaseCredentials();

  let adminClient: SupabaseClient | null = null;
  let clientA: SupabaseClient | null = null;
  let clientB: SupabaseClient | null = null;
  let anonClient: SupabaseClient | null = null;

  let userAId: string | null = null;
  let userBId: string | null = null;
  let canonicalArtistId: string | null = null;
  let isDbAvailable = false;

  beforeAll(async () => {
    if (!credentials) {
      if (process.env.CI) {
        throw new Error('Supabase credentials could not be resolved in CI.');
      }
      return;
    }

    assertSafeDatabaseTarget(
      credentials.url,
      false,
      'User preferences integration test suite',
    );

    try {
      const response = await fetch(`${credentials.url}/auth/v1/health`, {
        headers: { apikey: credentials.anonKey },
      });
      if (response.ok) {
        isDbAvailable = true;
      }
    } catch {
      isDbAvailable = false;
    }

    if (!isDbAvailable) {
      if (process.env.CI) {
        throw new Error(
          `Local Supabase stack is not responding at ${credentials.url} in CI. Database validation is required on pull requests.`,
        );
      }
      console.warn(
        `Local Supabase is not running at ${credentials.url}. Skipping user preferences RLS integration tests locally.`,
      );
      return;
    }

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    anonClient = createClient(credentials.url, credentials.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();
    const emailA = `test_pref_a_${timestamp}@encore.test`;
    const emailB = `test_pref_b_${timestamp}@encore.test`;
    const password = 'Password123!Safe';

    // Create User A
    const { data: createdA, error: errA } =
      await adminClient.auth.admin.createUser({
        email: emailA,
        password,
        email_confirm: true,
      });
    if (errA || !createdA.user) {
      throw new Error(`Failed to create test user A: ${errA?.message}`);
    }
    userAId = createdA.user.id;

    // Create User B
    const { data: createdB, error: errB } =
      await adminClient.auth.admin.createUser({
        email: emailB,
        password,
        email_confirm: true,
      });
    if (errB || !createdB.user) {
      throw new Error(`Failed to create test user B: ${errB?.message}`);
    }
    userBId = createdB.user.id;

    // Authenticate Client A
    clientA = createClient(credentials.url, credentials.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErrA } = await clientA.auth.signInWithPassword({
      email: emailA,
      password,
    });
    if (signInErrA) {
      throw new Error(`Failed to sign in User A: ${signInErrA.message}`);
    }

    // Authenticate Client B
    clientB = createClient(credentials.url, credentials.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErrB } = await clientB.auth.signInWithPassword({
      email: emailB,
      password,
    });
    if (signInErrB) {
      throw new Error(`Failed to sign in User B: ${signInErrB.message}`);
    }

    // Create a canonical artist for testing
    canonicalArtistId = crypto.randomUUID();
    const { error: artistErr } = await adminClient.from('artists').insert({
      id: canonicalArtistId,
      name: `Test Artist ${timestamp}`,
      normalized_name: `test artist ${timestamp}`,
    });
    if (artistErr) {
      throw new Error(`Failed to create test artist: ${artistErr.message}`);
    }
  });

  afterAll(async () => {
    if (!adminClient) return;

    if (canonicalArtistId) {
      await adminClient.from('artists').delete().eq('id', canonicalArtistId);
    }
    if (userAId) {
      await adminClient
        .from('user_artist_preferences')
        .delete()
        .eq('user_id', userAId);
      await adminClient.auth.admin.deleteUser(userAId);
    }
    if (userBId) {
      await adminClient
        .from('user_artist_preferences')
        .delete()
        .eq('user_id', userBId);
      await adminClient.auth.admin.deleteUser(userBId);
    }
  });

  it('enforces destination guard safety against non-local and spoofed database hosts', () => {
    expect(() =>
      assertSafeDatabaseTarget(
        'https://evil-local.com',
        false,
        'Integration destination test',
      ),
    ).toThrow(
      /Target database .* is not a verified local or development instance/,
    );
    expect(() =>
      assertSafeDatabaseTarget(
        'https://attacker.dev',
        false,
        'Integration destination test',
      ),
    ).toThrow(
      /Target database .* is not a verified local or development instance/,
    );
    expect(() =>
      assertSafeDatabaseTarget(
        'https://project-ref.supabase.co',
        false,
        'Integration destination test',
      ),
    ).toThrow(
      /Target database .* is not a verified local or development instance/,
    );
  });

  it('allows an authenticated user to insert, read, and update their own preference', async () => {
    if (!isDbAvailable || !clientA || !userAId || !canonicalArtistId) return;

    // 1. Insert
    const { data: inserted, error: insertError } = await clientA
      .from('user_artist_preferences')
      .insert({
        user_id: userAId,
        artist_id: canonicalArtistId,
        artist_name: 'Test Artist',
        normalized_artist_name: 'test artist',
        preference_level: 'favorite',
      })
      .select()
      .single();

    expect(insertError).toBeNull();
    expect(inserted).not.toBeNull();
    expect(inserted.preference_level).toBe('favorite');

    // 2. Select
    const { data: selected, error: selectError } = await clientA
      .from('user_artist_preferences')
      .select('*')
      .eq('user_id', userAId);

    expect(selectError).toBeNull();
    expect(selected?.length).toBe(1);

    // 3. Update
    const { data: updated, error: updateError } = await clientA
      .from('user_artist_preferences')
      .update({ preference_level: 'like' })
      .eq('id', inserted.id)
      .select()
      .single();

    expect(updateError).toBeNull();
    expect(updated?.preference_level).toBe('like');
  });

  it('prevents User B from reading, updating, or deleting User A preferences (RLS Isolation)', async () => {
    if (!isDbAvailable || !clientB || !userAId) return;

    // User B tries to select User A preferences -> RLS returns 0 rows
    const { data: readAttempt, error: readError } = await clientB
      .from('user_artist_preferences')
      .select('*')
      .eq('user_id', userAId);

    expect(readError).toBeNull();
    expect(readAttempt).toEqual([]);

    // User B tries to update User A preferences -> RLS filters out rows (0 rows modified)
    const { data: updateAttempt } = await clientB
      .from('user_artist_preferences')
      .update({ preference_level: 'dislike' })
      .eq('user_id', userAId)
      .select();

    expect(updateAttempt).toEqual([]);

    // User B tries to delete User A preferences -> RLS filters out rows (0 rows deleted)
    const { data: deleteAttempt } = await clientB
      .from('user_artist_preferences')
      .delete()
      .eq('user_id', userAId)
      .select();

    expect(deleteAttempt).toEqual([]);
  });

  it('blocks unauthenticated anonymous requests from inserting preferences', async () => {
    if (!isDbAvailable || !anonClient || !userAId) return;

    const { error: insertError } = await anonClient
      .from('user_artist_preferences')
      .insert({
        user_id: userAId,
        artist_name: 'Hacker Artist',
        normalized_artist_name: 'hacker artist',
        preference_level: 'favorite',
      });

    expect(insertError).not.toBeNull();
  });

  it('preserves user preference when canonical artist is deleted (ON DELETE SET NULL)', async () => {
    if (!isDbAvailable || !clientA || !adminClient || !userAId) return;

    // Create a temporary canonical artist to delete
    const tempArtistId = crypto.randomUUID();
    await adminClient.from('artists').insert({
      id: tempArtistId,
      name: 'Temporary Band',
      normalized_name: 'temporary band',
    });

    // User A adds preference for this temporary artist
    const { data: inserted, error: insErr } = await clientA
      .from('user_artist_preferences')
      .insert({
        user_id: userAId,
        artist_id: tempArtistId,
        artist_name: 'Temporary Band',
        normalized_artist_name: 'temporary band',
        preference_level: 'favorite',
      })
      .select()
      .single();

    expect(insErr).toBeNull();
    expect(inserted.artist_id).toBe(tempArtistId);

    // Delete canonical artist from catalog via adminClient
    const { error: delErr } = await adminClient
      .from('artists')
      .delete()
      .eq('id', tempArtistId);
    expect(delErr).toBeNull();

    // Verify preference is preserved with artist_id = null and original name intact!
    const { data: preserved, error: fetchErr } = await clientA
      .from('user_artist_preferences')
      .select('*')
      .eq('id', inserted.id)
      .single();

    expect(fetchErr).toBeNull();
    expect(preserved).not.toBeNull();
    expect(preserved.artist_id).toBeNull(); // ON DELETE SET NULL worked
    expect(preserved.artist_name).toBe('Temporary Band'); // Name preserved
    expect(preserved.preference_level).toBe('favorite'); // Preference preserved
  });

  it('prevents uniqueness collision when canonical artist is deleted and user already has an uncataloged preference with the same normalized name', async () => {
    if (!isDbAvailable || !clientA || !adminClient || !userAId) return;

    const timestamp = Date.now();
    const artistName = `Ghost Band ${timestamp}`;
    const normalizedName = `ghost band ${timestamp}`;

    // 1. User A adds an uncataloged preference for "Ghost Band"
    const { data: uncatalogedPref, error: uncatErr } = await clientA
      .from('user_artist_preferences')
      .insert({
        user_id: userAId,
        artist_id: null,
        archived_artist_id: null,
        artist_name: artistName,
        normalized_artist_name: normalizedName,
        preference_level: 'interested',
      })
      .select()
      .single();

    expect(uncatErr).toBeNull();
    expect(uncatalogedPref).not.toBeNull();
    expect(uncatalogedPref.artist_id).toBeNull();

    // 2. A canonical artist with the exact same name is added to the catalog
    const ghostArtistId = crypto.randomUUID();
    const { error: artErr } = await adminClient.from('artists').insert({
      id: ghostArtistId,
      name: artistName,
      normalized_name: normalizedName,
    });
    expect(artErr).toBeNull();

    // 3. User A also adds a canonical preference for this artist
    const { data: canonicalPref, error: canErr } = await clientA
      .from('user_artist_preferences')
      .insert({
        user_id: userAId,
        artist_id: ghostArtistId,
        archived_artist_id: null,
        artist_name: artistName,
        normalized_artist_name: normalizedName,
        preference_level: 'favorite',
      })
      .select()
      .single();

    expect(canErr).toBeNull();
    expect(canonicalPref).not.toBeNull();
    expect(canonicalPref.artist_id).toBe(ghostArtistId);

    // 4. Now delete the canonical artist from catalog
    // The trigger sets archived_artist_id = ghostArtistId and artist_id = null
    // preventing any uniqueness collision with uncatalogedPref
    const { error: delErr } = await adminClient
      .from('artists')
      .delete()
      .eq('id', ghostArtistId);

    expect(delErr).toBeNull();

    // 5. Invariant: Both preferences survive independently without collision or deletion
    const { data: userPrefs, error: fetchErr } = await clientA
      .from('user_artist_preferences')
      .select('*')
      .eq('user_id', userAId)
      .eq('normalized_artist_name', normalizedName);

    expect(fetchErr).toBeNull();
    expect(userPrefs?.length).toBe(2);

    const survivingUncataloged = userPrefs?.find(
      (p) => p.id === uncatalogedPref.id,
    );
    const survivingArchived = userPrefs?.find((p) => p.id === canonicalPref.id);

    expect(survivingUncataloged).toBeDefined();
    expect(survivingUncataloged?.artist_id).toBeNull();
    expect(survivingUncataloged?.archived_artist_id).toBeNull();
    expect(survivingUncataloged?.preference_level).toBe('interested');

    expect(survivingArchived).toBeDefined();
    expect(survivingArchived?.artist_id).toBeNull();
    expect(survivingArchived?.archived_artist_id).toBe(ghostArtistId);
    expect(survivingArchived?.preference_level).toBe('favorite');
  });

  it('updates archived preference and uncataloged preference independently when they share the same artist name', async () => {
    if (!isDbAvailable || !clientA || !adminClient || !userAId) return;

    const timestamp = Date.now();
    const artistName = `Shared Name Artist ${timestamp}`;
    const normalizedName = `shared name artist ${timestamp}`;
    const repo = new SupabaseUserPreferenceRepository(clientA);

    // 1. Add uncataloged preference
    const uncatPref = await repo.savePreference({
      userId: userAId,
      artistName,
      preferenceLevel: 'interested',
    });

    // 2. Add canonical artist and canonical preference
    const canonicalId = crypto.randomUUID();
    const { error: artErr } = await adminClient.from('artists').insert({
      id: canonicalId,
      name: artistName,
      normalized_name: normalizedName,
    });
    expect(artErr).toBeNull();

    const canPref = await repo.savePreference({
      userId: userAId,
      artistId: canonicalId,
      artistName,
      preferenceLevel: 'like',
    });

    // 3. Delete canonical artist so the canonical preference becomes archived
    const { error: delErr } = await adminClient
      .from('artists')
      .delete()
      .eq('id', canonicalId);
    expect(delErr).toBeNull();

    // Verify both exist with same name
    const listBefore = await repo.getPreferences(userAId);
    const uncatBefore = listBefore.find((p) => p.id === uncatPref.id);
    const archBefore = listBefore.find((p) => p.id === canPref.id);
    expect(uncatBefore).toBeDefined();
    expect(archBefore).toBeDefined();
    expect(uncatBefore?.artistName).toBe(artistName);
    expect(archBefore?.artistName).toBe(artistName);
    expect(archBefore?.archivedArtistId).toBe(canonicalId);
    expect(archBefore?.artistId).toBeNull();
    expect(uncatBefore?.preferenceLevel).toBe('interested');
    expect(archBefore?.preferenceLevel).toBe('like');

    // 4. Update uncataloged preference via updatePreferenceLevel by ID
    const updatedUncat = await repo.updatePreferenceLevel(
      userAId,
      uncatPref.id,
      'favorite',
    );
    expect(updatedUncat.preferenceLevel).toBe('favorite');

    // Invariant: Archived preference must remain unchanged ('like')
    const listAfterFirst = await repo.getPreferences(userAId);
    const uncatCheck1 = listAfterFirst.find((p) => p.id === uncatPref.id);
    const archCheck1 = listAfterFirst.find((p) => p.id === canPref.id);
    expect(uncatCheck1?.preferenceLevel).toBe('favorite');
    expect(archCheck1?.preferenceLevel).toBe('like');

    // 5. Update archived preference via updatePreferenceLevel by ID
    const updatedArch = await repo.updatePreferenceLevel(
      userAId,
      canPref.id,
      'dislike',
    );
    expect(updatedArch.preferenceLevel).toBe('dislike');

    // Invariant: Uncataloged preference must remain unchanged ('favorite')
    const listAfterSecond = await repo.getPreferences(userAId);
    const uncatCheck2 = listAfterSecond.find((p) => p.id === uncatPref.id);
    const archCheck2 = listAfterSecond.find((p) => p.id === canPref.id);
    expect(uncatCheck2?.preferenceLevel).toBe('favorite');
    expect(archCheck2?.preferenceLevel).toBe('dislike');

    // Clean up preferences
    await repo.deletePreference(userAId, uncatPref.id);
    await repo.deletePreference(userAId, canPref.id);
  });

  it('executes full authenticated user lifecycle: sign in, create, verify, update, delete, sign out', async () => {
    if (!isDbAvailable || !adminClient || !credentials) return;

    const timestamp = Date.now();
    const lifecycleEmail = `lifecycle_${timestamp}@encore.test`;
    const lifecyclePassword = 'Password123!Secure';

    // 1. Create dedicated user for lifecycle test
    const { data: created, error: createErr } =
      await adminClient.auth.admin.createUser({
        email: lifecycleEmail,
        password: lifecyclePassword,
        email_confirm: true,
      });
    expect(createErr).toBeNull();
    const lifecycleUserId = created.user!.id;

    try {
      // 2. Sign in as user
      const userSessionClient = createClient(
        credentials.url,
        credentials.anonKey,
        {
          auth: { autoRefreshToken: false, persistSession: false },
        },
      );
      const { data: authData, error: signInErr } =
        await userSessionClient.auth.signInWithPassword({
          email: lifecycleEmail,
          password: lifecyclePassword,
        });
      expect(signInErr).toBeNull();
      expect(authData.session).not.toBeNull();

      // 3. Add preference
      const { data: addedPref, error: addErr } = await userSessionClient
        .from('user_artist_preferences')
        .insert({
          user_id: lifecycleUserId,
          artist_name: 'Lifecycle Artist',
          normalized_artist_name: 'lifecycle artist',
          preference_level: 'interested',
        })
        .select()
        .single();
      expect(addErr).toBeNull();
      expect(addedPref.preference_level).toBe('interested');

      // 4. Verify persistence on new read
      const { data: readList, error: readErr } = await userSessionClient
        .from('user_artist_preferences')
        .select('*')
        .eq('user_id', lifecycleUserId);
      expect(readErr).toBeNull();
      expect(readList?.length).toBe(1);
      expect(readList?.[0].id).toBe(addedPref.id);

      // 5. Update preference
      const { data: updatedPref, error: updateErr } = await userSessionClient
        .from('user_artist_preferences')
        .update({ preference_level: 'favorite' })
        .eq('id', addedPref.id)
        .select()
        .single();
      expect(updateErr).toBeNull();
      expect(updatedPref.preference_level).toBe('favorite');

      // 6. Remove preference
      const { error: deleteErr } = await userSessionClient
        .from('user_artist_preferences')
        .delete()
        .eq('id', addedPref.id);
      expect(deleteErr).toBeNull();

      // Verify deletion
      const { data: emptyList, error: emptyErr } = await userSessionClient
        .from('user_artist_preferences')
        .select('*')
        .eq('user_id', lifecycleUserId);
      expect(emptyErr).toBeNull();
      expect(emptyList?.length).toBe(0);

      // 7. Sign out
      await userSessionClient.auth.signOut();

      // 8. Verify preferences are inaccessible without authentication
      const { error: unauthErr } = await userSessionClient
        .from('user_artist_preferences')
        .insert({
          user_id: lifecycleUserId,
          artist_name: 'Unauth Artist',
          normalized_artist_name: 'unauth artist',
          preference_level: 'interested',
        });
      expect(unauthErr).not.toBeNull();
    } finally {
      await adminClient.auth.admin.deleteUser(lifecycleUserId);
    }
  });
});
