import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';

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
    // Supabase CLI status could not be read
  }

  // Standard Supabase local development defaults from config.toml
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

describe('Row Level Security (RLS) on public.profiles', () => {
  const credentials = resolveSupabaseCredentials();

  let adminClient: SupabaseClient | null = null;
  let clientA: SupabaseClient | null = null;
  let clientB: SupabaseClient | null = null;

  let userAId: string | null = null;
  let userBId: string | null = null;
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
        `Local Supabase is not running at ${credentials.url}. Skipping RLS integration tests locally (Docker runtime required).`,
      );
      return;
    }

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();
    const emailA = `test_user_a_${timestamp}@encore.test`;
    const emailB = `test_user_b_${timestamp}@encore.test`;
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
  });

  afterAll(async () => {
    if (adminClient && isDbAvailable) {
      if (userAId) {
        await adminClient.auth.admin.deleteUser(userAId);
      }
      if (userBId) {
        await adminClient.auth.admin.deleteUser(userBId);
      }
    }
  });

  it('allows authenticated user A to insert own profile', async () => {
    if (!isDbAvailable) {
      return;
    }

    const { data, error } = await clientA!
      .from('profiles')
      .insert({
        id: userAId!,
        max_normal_ticket_price: 85.0,
        default_radius_miles: 30,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBe(userAId);
    expect(Number(data?.max_normal_ticket_price)).toBe(85.0);
  });

  it('allows authenticated user A to read own profile', async () => {
    if (!isDbAvailable) {
      return;
    }

    const { data, error } = await clientA!
      .from('profiles')
      .select('*')
      .eq('id', userAId!)
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBe(userAId);
    expect(Number(data?.max_normal_ticket_price)).toBe(85.0);
  });

  it('allows authenticated user A to update own profile', async () => {
    if (!isDbAvailable) {
      return;
    }

    const { data, error } = await clientA!
      .from('profiles')
      .update({
        max_normal_ticket_price: 120.0,
      })
      .eq('id', userAId!)
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBe(userAId);
    expect(Number(data?.max_normal_ticket_price)).toBe(120.0);
  });

  it('prevents authenticated user B from reading user A profile', async () => {
    if (!isDbAvailable) {
      return;
    }

    const { data, error } = await clientB!
      .from('profiles')
      .select('*')
      .eq('id', userAId!);

    expect(error).toBeNull();
    // Under RLS SELECT policy, queries targeting other users return an empty result set
    expect(data).toHaveLength(0);
  });

  it('prevents authenticated user B from updating user A profile', async () => {
    if (!isDbAvailable) {
      return;
    }

    const { data, error } = await clientB!
      .from('profiles')
      .update({ max_normal_ticket_price: 999.0 })
      .eq('id', userAId!)
      .select();

    expect(error).toBeNull();
    // Under RLS UPDATE policy, 0 rows are updated
    expect(data).toHaveLength(0);

    // Verify User A's data was not modified
    const { data: verifyData } = await clientA!
      .from('profiles')
      .select('max_normal_ticket_price')
      .eq('id', userAId!)
      .single();
    expect(Number(verifyData?.max_normal_ticket_price)).toBe(120.0);
  });

  it('prevents authenticated user B from inserting a profile with user A id', async () => {
    if (!isDbAvailable) {
      return;
    }

    const { error } = await clientB!.from('profiles').insert({
      id: userAId!,
      max_normal_ticket_price: 50.0,
    });

    // Under RLS INSERT with check (auth.uid() = id), the insert must fail
    expect(error).not.toBeNull();
  });

  it('prevents anonymous unauthenticated access to profiles', async () => {
    if (!isDbAvailable) {
      return;
    }

    const anonClient = createClient(credentials!.url, credentials!.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: readData } = await anonClient.from('profiles').select('*');
    expect(readData).toHaveLength(0);

    const { error: insertError } = await anonClient.from('profiles').insert({
      id: userAId!,
      max_normal_ticket_price: 10.0,
    });
    expect(insertError).not.toBeNull();
  });
});
