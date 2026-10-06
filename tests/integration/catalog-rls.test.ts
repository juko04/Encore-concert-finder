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
      start_time_precision: 'date_only',
    });
    expect(insertEventError).not.toBeNull();
    expect(insertEventError?.code).toBe('42501');
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

  it('proves apply_canonicalization RPC execution is restricted strictly to service_role', async () => {
    if (!isDbAvailable || !anonClient || !adminClient) return;

    // 1. Anonymous client cannot execute apply_canonicalization
    const { error: anonRpcError } = await anonClient.rpc(
      'apply_canonicalization',
      { payload: {} },
    );
    expect(anonRpcError).not.toBeNull();
    // PostgreSQL error code 42501 is insufficient_privilege / permission denied
    expect(anonRpcError?.code).toBe('42501');

    // 2. Normal authenticated user cannot execute apply_canonicalization
    const testEmail = `auth_test_${Date.now()}@example.com`;
    const { data: userData, error: createError } =
      await adminClient.auth.admin.createUser({
        email: testEmail,
        password: 'TestPassword123!',
        email_confirm: true,
      });

    if (!createError && userData.user) {
      const { data: sessionData } = await anonClient.auth.signInWithPassword({
        email: testEmail,
        password: 'TestPassword123!',
      });

      if (sessionData.session) {
        const authedUserClient = createClient(
          credentials!.url,
          credentials!.anonKey,
          {
            global: {
              headers: {
                Authorization: `Bearer ${sessionData.session.access_token}`,
              },
            },
            auth: { autoRefreshToken: false, persistSession: false },
          },
        );

        const { error: userRpcError } = await authedUserClient.rpc(
          'apply_canonicalization',
          { payload: {} },
        );
        expect(userRpcError).not.toBeNull();
        expect(userRpcError?.code).toBe('42501');
      }

      await adminClient.auth.admin.deleteUser(userData.user.id);
    }
  });

  it('executes canonicalization atomically and rolls back venue and artist on failure (Finding 2)', async () => {
    if (!isDbAvailable || !adminClient) return;

    const sourceId = 'a0000000-0000-0000-0000-000000000001';
    const timestamp = Date.now();

    // 1. Successful atomic execution with venue and artists
    const { data: rawData } = await adminClient
      .from('raw_ingests')
      .insert({
        source_id: sourceId,
        source_url: 'https://example.com/atomic_success',
        acquisition_method: 'api',
        content_hash: `hash_success_${timestamp}`,
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
        source_url: 'https://example.com/atomic_success',
        title: `Atomic Concert Success ${timestamp}`,
        venue_name: 'Test Venue Success',
        timezone: 'America/Denver',
        local_start_date: '2026-11-20',
      })
      .select('id')
      .single();

    const validPayload = {
      venueToCreate: {
        name: `Success Venue ${timestamp}`,
        normalized_name: `success venue ${timestamp}`,
        city: 'Denver',
        region: 'CO',
        timezone: 'America/Denver',
      },
      event: {
        name: `Atomic Concert Success ${timestamp}`,
        normalized_name: `atomic concert success ${timestamp}`,
        event_kind: 'concert',
        status: 'scheduled',
        timezone: 'America/Denver',
        local_start_date: '2026-11-20',
        starts_at: '2026-11-21T03:00:00Z',
        start_time_precision: 'instant',
      },
      artists: [
        {
          name: `Success Artist ${timestamp}`,
          normalized_name: `success artist ${timestamp}`,
          billing_position: 'headliner',
          sort_order: 0,
        },
      ],
      source: {
        source_id: sourceId,
        candidate_id: candData?.id,
        raw_ingest_id: rawIngestId,
        source_url: 'https://example.com/atomic_success',
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

    // 2. Failure rollback test: pass an invalid candidate ID in resolution
    // causing a foreign key violation; ensure neither venue nor artist are persisted!
    const rollbackSuffix = `fail_${Date.now()}`;
    const failedPayload = {
      venueToCreate: {
        name: `Rollback Venue ${rollbackSuffix}`,
        normalized_name: `rollback venue ${rollbackSuffix}`,
        city: 'Denver',
        region: 'CO',
        timezone: 'America/Denver',
      },
      artists: [
        {
          name: `Rollback Artist ${rollbackSuffix}`,
          normalized_name: `rollback artist ${rollbackSuffix}`,
          billing_position: 'headliner',
          sort_order: 0,
        },
      ],
      event: {
        name: `Rollback Event ${rollbackSuffix}`,
        normalized_name: `rollback event ${rollbackSuffix}`,
        timezone: 'America/Denver',
        local_start_date: '2026-11-21',
        starts_at: '2026-11-22T03:00:00Z',
        start_time_precision: 'instant',
      },
      resolution: {
        event_candidate_id: '00000000-0000-0000-0000-000000000000', // invalid candidate FK
        status: 'created',
        confidence: 0.9,
      },
    };

    const { error: failedError } = await adminClient.rpc(
      'apply_canonicalization',
      { payload: failedPayload },
    );

    expect(failedError).not.toBeNull();

    // Verify atomic rollback of event, venue, and artist
    const { data: orphanedEvent } = await adminClient
      .from('events')
      .select('id')
      .eq('normalized_name', `rollback event ${rollbackSuffix}`);
    expect(orphanedEvent?.length).toBe(0);

    const { data: orphanedVenue } = await adminClient
      .from('venues')
      .select('id')
      .eq('normalized_name', `rollback venue ${rollbackSuffix}`);
    expect(orphanedVenue?.length).toBe(0);

    const { data: orphanedArtist } = await adminClient
      .from('artists')
      .select('id')
      .eq('normalized_name', `rollback artist ${rollbackSuffix}`);
    expect(orphanedArtist?.length).toBe(0);
  });

  it('enforces temporal database check constraints', async () => {
    if (!isDbAvailable || !adminClient) return;

    // Constraint 1: instant precision requires starts_at
    const { error: instantError } = await adminClient.from('events').insert({
      name: 'Missing Instant',
      normalized_name: 'missing instant',
      start_time_precision: 'instant',
      starts_at: null,
      timezone: 'America/Denver',
      local_start_date: '2026-10-15',
    });
    expect(instantError).not.toBeNull();

    // Constraint 2: date_only precision forbids starts_at
    const { error: dateOnlyError } = await adminClient.from('events').insert({
      name: 'Invalid Date Only',
      normalized_name: 'invalid date only',
      start_time_precision: 'date_only',
      starts_at: '2026-10-15T20:00:00Z',
      timezone: 'America/Denver',
      local_start_date: '2026-10-15',
    });
    expect(dateOnlyError).not.toBeNull();

    // Constraint 3: local_end_date cannot precede local_start_date
    const { error: dateOrderError } = await adminClient.from('events').insert({
      name: 'Backwards Dates',
      normalized_name: 'backwards dates',
      timezone: 'America/Denver',
      local_start_date: '2026-10-15',
      local_end_date: '2026-10-14',
    });
    expect(dateOrderError).not.toBeNull();

    // Constraint 4: multi_day consistency
    const { error: multiDayError } = await adminClient.from('events').insert({
      name: 'Multi Day Inconsistent',
      normalized_name: 'multi day inconsistent',
      timezone: 'America/Denver',
      local_start_date: '2026-10-15',
      local_end_date: '2026-10-15',
      is_multi_day: true,
    });
    expect(multiDayError).not.toBeNull();
  });

  it('enforces compound foreign key integrity across candidate and raw ingest sources', async () => {
    if (!isDbAvailable || !adminClient) return;

    const sourceA = 'a0000000-0000-0000-0000-000000000001';
    const sourceB = 'b0000000-0000-0000-0000-000000000002';

    // Insert raw ingest for source A
    const { data: rawA } = await adminClient
      .from('raw_ingests')
      .insert({
        source_id: sourceA,
        source_url: 'https://example.com/source_a',
        acquisition_method: 'api',
        content_hash: `hash_fk_${Date.now()}`,
      })
      .select('id')
      .single();

    // Attempting to create candidate under source B with raw_ingest of source A must fail!
    const { error: crossSourceError } = await adminClient
      .from('event_candidates')
      .insert({
        source_id: sourceB, // mismatch with raw ingest's source_id
        raw_ingest_id: rawA?.id,
        source_type: 'venue',
        acquisition_method: 'api',
        source_url: 'https://example.com/source_b',
        title: 'Cross Source Candidate',
        venue_name: 'Test Venue',
        timezone: 'America/Denver',
        local_start_date: '2026-11-20',
      });

    expect(crossSourceError).not.toBeNull();
    // 23503 is foreign_key_violation in PostgreSQL
    expect(crossSourceError?.code).toBe('23503');
  });

  it('proves seeded operational tables remain completely hidden from anon users', async () => {
    if (!isDbAvailable || !adminClient || !anonClient) return;

    // Verify admin can see populated operational tables
    const { data: adminCandidates } = await adminClient
      .from('event_candidates')
      .select('id')
      .limit(5);
    expect(adminCandidates && adminCandidates.length > 0).toBeTruthy();

    // Query same table with anonClient: must return 0 rows (RLS blocks read)
    const { data: anonCandidates, error: anonError } = await anonClient
      .from('event_candidates')
      .select('id');
    expect(anonError || anonCandidates?.length === 0).toBeTruthy();
  });

  it('rejects mapping the same upstream (source_id, source_event_id) to multiple canonical events (Invariant 4)', async () => {
    if (!isDbAvailable || !adminClient) return;

    const sourceId = 'a0000000-0000-0000-0000-000000000001';
    const upstreamId = `tm_unique_test_${Date.now()}`;

    // Create event 1
    const { data: event1 } = await adminClient
      .from('events')
      .insert({
        name: 'Event 1',
        normalized_name: 'event 1',
        timezone: 'America/Denver',
        local_start_date: '2026-11-20',
        start_time_precision: 'date_only',
      })
      .select('id')
      .single();

    // Create event 2
    const { data: event2 } = await adminClient
      .from('events')
      .insert({
        name: 'Event 2',
        normalized_name: 'event 2',
        timezone: 'America/Denver',
        local_start_date: '2026-11-20',
        start_time_precision: 'date_only',
      })
      .select('id')
      .single();

    // Insert source link for event 1
    const { error: link1Error } = await adminClient
      .from('event_sources')
      .insert({
        event_id: event1?.id,
        source_id: sourceId,
        source_event_id: upstreamId,
        source_url: 'https://example.com/e1',
      });
    expect(link1Error).toBeNull();

    // Attempt to insert duplicate source link with SAME source_id and source_event_id to event 2
    const { error: duplicateLinkError } = await adminClient
      .from('event_sources')
      .insert({
        event_id: event2?.id,
        source_id: sourceId,
        source_event_id: upstreamId,
        source_url: 'https://example.com/e2',
      });

    expect(duplicateLinkError).not.toBeNull();
    // 23505 is unique_violation in PostgreSQL
    expect(duplicateLinkError?.code).toBe('23505');
  });
});
