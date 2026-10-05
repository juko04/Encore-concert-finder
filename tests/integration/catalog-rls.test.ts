import { beforeAll, describe, expect, it } from 'vitest';
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
    // Ignore
  }

  return {
    url: 'http://127.0.0.1:54321',
    anonKey:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE2MTQ1NTIwMDAsImV4cCI6MTk3MDEwODAwMH0.09X-XbQhJ191y_bS09YmKjX8X8x8_bS09YmKjX8X8x8',
    serviceRoleKey:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTYxNDU1MjAwMCwiZXhwIjoxOTcwMTA4MDAwfQ.09X-XbQhJ191y_bS09YmKjX8X8x8_bS09YmKjX8X8x8',
  };
}

describe('Catalog RLS, Security & Canonicalization Atomicity', () => {
  const credentials = resolveSupabaseCredentials();

  let adminClient: SupabaseClient | null = null;
  let anonClient: SupabaseClient | null = null;
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
        `Local Supabase is not running at ${credentials.url}. Skipping integration tests locally.`,
      );
      return;
    }

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    anonClient = createClient(credentials.url, credentials.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  it('allows public read on catalog tables but denies writes to anon', async () => {
    if (!isDbAvailable || !anonClient) return;

    // Read artists
    const { error: readArtistsError } = await anonClient
      .from('artists')
      .select('id')
      .limit(1);
    expect(readArtistsError).toBeNull();

    // Read events
    const { error: readEventsError } = await anonClient
      .from('events')
      .select('id')
      .limit(1);
    expect(readEventsError).toBeNull();

    // Deny insert on events to anon
    const { error: insertEventError } = await anonClient.from('events').insert({
      name: 'Unauthorized Show',
      normalized_name: 'unauthorized show',
      timezone: 'America/Denver',
      local_start_date: '2026-10-15',
    });
    expect(insertEventError).not.toBeNull();
  });

  it('restricts direct access to sources table and allows access via public_sources view (Finding 10)', async () => {
    if (!isDbAvailable || !anonClient) return;

    // Direct access to sources table is denied to anon
    const { data: sourcesData, error: sourcesError } = await anonClient
      .from('sources')
      .select('*')
      .limit(1);
    // Either an RLS error occurs or 0 rows are returned due to default deny
    expect(sourcesError || sourcesData?.length === 0).toBeTruthy();

    // Access via safe view public_sources succeeds
    const { error: viewError } = await anonClient
      .from('public_sources')
      .select('id, name, slug')
      .limit(1);
    expect(viewError).toBeNull();
  });

  it('denies anon access to operational and provenance tables (Finding 1 & 10)', async () => {
    if (!isDbAvailable || !anonClient) return;

    const operationalTables = [
      'raw_ingests',
      'event_candidates',
      'event_sources',
      'event_field_evidence',
      'candidate_resolutions',
    ];

    for (const table of operationalTables) {
      const { data, error } = await anonClient.from(table).select('*').limit(1);
      expect(error || data?.length === 0).toBeTruthy();
    }
  });

  it('executes canonicalization atomically and rolls back on failure (Finding 2)', async () => {
    if (!isDbAvailable || !adminClient) return;

    // 1. Successful atomic execution
    const candidateId = `cand_atomic_${Date.now()}`;
    const venueId = 'a0000000-0000-0000-0000-000000000001'; // or create test venue
    const sourceId = 'a0000000-0000-0000-0000-000000000001';

    // Insert dummy raw ingest and candidate
    const { data: rawData } = await adminClient
      .from('raw_ingests')
      .insert({
        source_id: sourceId,
        source_url: 'https://example.com/atomic',
        acquisition_method: 'api',
        content_hash: `hash_${Date.now()}`,
      })
      .select('id')
      .single();

    const rawIngestId = rawData?.id;

    const { data: candData } = await adminClient
      .from('event_candidates')
      .insert({
        source_id: sourceId,
        raw_ingest_id: rawIngestId,
        source_type: 'venue',
        acquisition_method: 'api',
        source_url: 'https://example.com/atomic',
        title: 'Atomic Concert Test',
        venue_name: 'Test Venue',
        timezone: 'America/Denver',
        local_start_date: '2026-11-20',
      })
      .select('id')
      .single();

    const validPayload = {
      event: {
        name: 'Atomic Concert Test',
        normalized_name: 'atomic concert test',
        event_kind: 'concert',
        status: 'scheduled',
        timezone: 'America/Denver',
        local_start_date: '2026-11-20',
      },
      source: {
        source_id: sourceId,
        candidate_id: candData?.id,
        raw_ingest_id: rawIngestId,
        source_url: 'https://example.com/atomic',
      },
      resolution: {
        event_candidate_id: candData?.id,
        status: 'created',
        confidence: 0.9,
        reasons: ['test_atomic_success'],
      },
    };

    const { data: successData, error: successError } = await adminClient.rpc(
      'apply_canonicalization',
      { payload: validPayload },
    );

    expect(successError).toBeNull();
    expect(successData?.eventId).toBeDefined();

    // 2. Failure rollback test: pass an invalid payload that causes a foreign key constraint violation
    const invalidCandidateId = '00000000-0000-0000-0000-000000000000'; // non-existent candidate ID
    const failedPayload = {
      event: {
        name: 'Should Not Be Persisted',
        normalized_name: 'should not be persisted',
        timezone: 'America/Denver',
        local_start_date: '2026-11-21',
      },
      resolution: {
        event_candidate_id: invalidCandidateId, // will fail FK constraint on candidate_resolutions
        status: 'created',
        confidence: 0.9,
      },
    };

    const { error: failedError } = await adminClient.rpc(
      'apply_canonicalization',
      { payload: failedPayload },
    );

    // RPC must fail due to foreign key violation
    expect(failedError).not.toBeNull();

    // Verify that NO event with 'should not be persisted' was created
    const { data: orphanedEvent } = await adminClient
      .from('events')
      .select('id')
      .eq('normalized_name', 'should not be persisted');

    expect(orphanedEvent?.length).toBe(0);
  });
});
