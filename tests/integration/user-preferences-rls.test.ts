import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface LocalCredentials {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

function resolveSupabaseCredentials(): LocalCredentials | null {
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
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
        url: parsed.API_URL,
        anonKey: parsed.ANON_KEY,
        serviceRoleKey: parsed.SERVICE_ROLE_KEY,
      };
    }
  } catch {
    // Supabase CLI status not available
  }

  const defaultUrl = 'http://127.0.0.1:54321';
  const defaultAnonKey =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE2MTQ1NTIwMDAsImV4cCI6MTk3MDEwODAwMH0.09X-XbQhJ191y_bS09YmKjX8X8x8_bS09YmKjX8X8x8';
  const defaultServiceRoleKey =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTYxNDU1MjAwMCwiZXhwIjoxOTcwMTA4MDAwfQ.09X-XbQhJ191y_bS09YmKjX8X8x8_bS09YmKjX8X8x8';

  return {
    url: defaultUrl,
    anonKey: defaultAnonKey,
    serviceRoleKey: defaultServiceRoleKey,
  };
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

    // Ensure migration is applied in test environment if needed
    try {
      const migrationSql = fs.readFileSync(
        path.join(
          process.cwd(),
          'supabase/migrations/20261014000000_create_user_artist_preferences.sql',
        ),
        'utf-8',
      );
      // Execute via pg / rpc if available, or assume applied by supabase db reset
      try {
        await adminClient.rpc('execute_sql', { sql: migrationSql });
      } catch {
        // Ignored if RPC is not available
      }
    } catch {
      // Ignored if file or RPC is not enabled
    }

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
});
