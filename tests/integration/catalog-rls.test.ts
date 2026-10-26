import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import crypto from 'node:crypto';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';

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
    // Ignore
  }

  return null;
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
    const { error: instantError } = await adminClient!.from('events').insert({
      name: 'Missing Instant',
      normalized_name: 'missing instant',
      event_kind: 'concert',
      status: 'scheduled',
      timezone: 'America/Denver',
      local_start_date: '2026-10-15',
      start_time_precision: 'instant',
      starts_at: null,
      is_multi_day: false,
    });
    expect(instantError).not.toBeNull();
    expect(instantError?.code).toBe('23514');
    expect(instantError?.message).toContain('check_events_instant_starts_at');

    // Constraint 2: date_only precision forbids starts_at
    const { error: dateOnlyError } = await adminClient!.from('events').insert({
      name: 'Invalid Date Only',
      normalized_name: 'invalid date only',
      event_kind: 'concert',
      status: 'scheduled',
      timezone: 'America/Denver',
      local_start_date: '2026-10-15',
      start_time_precision: 'date_only',
      starts_at: '2026-10-15T20:00:00Z',
      is_multi_day: false,
    });
    expect(dateOnlyError).not.toBeNull();
    expect(dateOnlyError?.code).toBe('23514');
    expect(dateOnlyError?.message).toContain(
      'check_events_date_only_no_starts_at',
    );

    // Constraint 3: local_end_date cannot precede local_start_date (row otherwise completely valid)
    const { error: dateOrderError } = await adminClient!.from('events').insert({
      name: 'Backwards Dates',
      normalized_name: 'backwards dates',
      event_kind: 'concert',
      status: 'scheduled',
      timezone: 'America/Denver',
      local_start_date: '2026-10-15',
      local_end_date: '2026-10-14',
      start_time_precision: 'date_only',
      is_multi_day: false,
    });
    expect(dateOrderError).not.toBeNull();
    expect(dateOrderError?.code).toBe('23514');
    expect(dateOrderError?.message).toContain('check_events_local_date_order');

    // Constraint 4: multi_day consistency (row otherwise completely valid)
    const { error: multiDayError } = await adminClient!.from('events').insert({
      name: 'Multi Day Inconsistent',
      normalized_name: 'multi day inconsistent',
      event_kind: 'concert',
      status: 'scheduled',
      timezone: 'America/Denver',
      local_start_date: '2026-10-15',
      local_end_date: '2026-10-15',
      start_time_precision: 'date_only',
      is_multi_day: true,
    });
    expect(multiDayError).not.toBeNull();
    expect(multiDayError?.code).toBe('23514');
    expect(multiDayError?.message).toContain(
      'check_events_multi_day_consistency',
    );

    // Constraint 5: ends_at cannot precede starts_at (row otherwise completely valid)
    const { error: instantOrderError } = await adminClient!
      .from('events')
      .insert({
        name: 'Backwards Instant Order',
        normalized_name: 'backwards instant order',
        event_kind: 'concert',
        status: 'scheduled',
        timezone: 'America/Denver',
        local_start_date: '2026-10-15',
        local_end_date: '2026-10-15',
        start_time_precision: 'instant',
        starts_at: '2026-10-15T21:00:00Z',
        ends_at: '2026-10-15T20:00:00Z',
        is_multi_day: false,
      });
    expect(instantOrderError).not.toBeNull();
    expect(instantOrderError?.code).toBe('23514');
    expect(instantOrderError?.message).toContain('check_events_instant_order');
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
    const { data: event1, error: event1Error } = await adminClient!
      .from('events')
      .insert({
        name: 'Event 1',
        normalized_name: 'event 1',
        event_kind: 'concert',
        status: 'scheduled',
        timezone: 'America/Denver',
        local_start_date: '2026-11-20',
        start_time_precision: 'date_only',
        is_multi_day: false,
      })
      .select('id')
      .single();
    expect(event1Error).toBeNull();
    expect(event1?.id).toBeDefined();

    // Create event 2
    const { data: event2, error: event2Error } = await adminClient!
      .from('events')
      .insert({
        name: 'Event 2',
        normalized_name: 'event 2',
        event_kind: 'concert',
        status: 'scheduled',
        timezone: 'America/Denver',
        local_start_date: '2026-11-20',
        start_time_precision: 'date_only',
        is_multi_day: false,
      })
      .select('id')
      .single();
    expect(event2Error).toBeNull();
    expect(event2?.id).toBeDefined();

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

  it('verifies batched listEvents correctly joins source names, handles multiple/inactive sources, preserves artist/ticket ordering, and supports anon RLS reads', async () => {
    if (!isDbAvailable || !adminClient || !anonClient) return;

    const runSuffix = crypto.randomUUID().slice(0, 8);

    // 1. Create venue
    const { data: venue, error: venueError } = await adminClient
      .from('venues')
      .insert({
        name: `Red Rocks Amphitheatre ${runSuffix}`,
        normalized_name: `red rocks amphitheatre ${runSuffix}`,
        city: 'Morrison',
        region: 'CO',
        timezone: 'America/Denver',
      })
      .select('id')
      .single();
    expect(venueError).toBeNull();
    expect(venue?.id).toBeDefined();

    // 2. Create artists
    const { data: artist1, error: a1Error } = await adminClient
      .from('artists')
      .insert({
        name: `Headliner Band ${runSuffix}`,
        normalized_name: `headliner band ${runSuffix}`,
      })
      .select('id')
      .single();
    expect(a1Error).toBeNull();

    const { data: artist2, error: a2Error } = await adminClient
      .from('artists')
      .insert({
        name: `Support Act ${runSuffix}`,
        normalized_name: `support act ${runSuffix}`,
      })
      .select('id')
      .single();
    expect(a2Error).toBeNull();

    // 3. Create sources
    const { data: sourceA, error: sAError } = await adminClient
      .from('sources')
      .insert({
        slug: `source-alpha-${runSuffix}`,
        name: `Source Alpha ${runSuffix}`,
        source_type: 'ticketing',
        acquisition_method: 'api',
        base_url: 'https://alpha.example.com',
        reliability_score: 0.95,
        active: true,
        parser_version: '1.0.0',
      })
      .select('id')
      .single();
    expect(sAError).toBeNull();

    const { data: sourceB, error: sBError } = await adminClient
      .from('sources')
      .insert({
        slug: `source-beta-${runSuffix}`,
        name: `Source Beta ${runSuffix}`,
        source_type: 'venue',
        acquisition_method: 'api',
        base_url: 'https://beta.example.com',
        reliability_score: 0.9,
        active: true,
        parser_version: '1.0.0',
      })
      .select('id')
      .single();
    expect(sBError).toBeNull();

    // 4. Create Event 1 (complete data)
    const testDate = '2026-11-28';
    const { data: event1, error: ev1Error } = await adminClient
      .from('events')
      .insert({
        name: `Festival Showcase ${runSuffix}`,
        normalized_name: `festival showcase ${runSuffix}`,
        event_kind: 'concert',
        status: 'scheduled',
        venue_id: venue?.id,
        city: 'Morrison',
        region: 'CO',
        timezone: 'America/Denver',
        local_start_date: testDate,
        starts_at: `${testDate}T01:00:00Z`,
        start_time_precision: 'instant',
        is_multi_day: false,
      })
      .select('id')
      .single();
    expect(ev1Error).toBeNull();

    // Link artists in specific sort_order
    await adminClient.from('event_artists').insert([
      {
        event_id: event1?.id,
        artist_id: artist1?.id,
        billing_position: 'headliner',
        sort_order: 1,
      },
      {
        event_id: event1?.id,
        artist_id: artist2?.id,
        billing_position: 'support',
        sort_order: 2,
      },
    ]);

    // Link ticket prices
    await adminClient.from('event_ticket_links').insert({
      event_id: event1?.id,
      url: 'https://tickets.example.com/show',
      normalized_url: 'https://tickets.example.com/show',
      min_price: 35.0,
      max_price: 85.0,
      currency: 'USD',
      inventory_status: 'available',
    });

    // Link sources: multiple current sources + one inactive source
    await adminClient.from('event_sources').insert([
      {
        event_id: event1?.id,
        source_id: sourceA?.id,
        source_url: 'https://alpha.example.com/events/1',
        confidence: 0.95,
        is_current: true,
      },
      {
        event_id: event1?.id,
        source_id: sourceB?.id,
        source_url: 'https://beta.example.com/events/1',
        confidence: 0.9,
        is_current: true,
      },
      {
        event_id: event1?.id,
        source_id: sourceA?.id,
        source_url: 'https://alpha.example.com/events/historical-1',
        confidence: 0.5,
        is_current: false, // Inactive / historical relationship
      },
    ]);

    // 5. Create Event 2 (missing venue, ticket links, sources)
    const { data: event2, error: ev2Error } = await adminClient
      .from('events')
      .insert({
        name: `Orphaned Show ${runSuffix}`,
        normalized_name: `orphaned show ${runSuffix}`,
        event_kind: 'concert',
        status: 'scheduled',
        venue_id: null, // Missing venue
        city: null,
        region: null,
        timezone: 'America/Denver',
        local_start_date: testDate,
        start_time_precision: 'date_only',
        is_multi_day: false,
      })
      .select('id')
      .single();
    expect(ev2Error).toBeNull();

    // 6. Test batched listEvents via adminClient (server-side catalog repository queries with source joins)
    const catalogRepo = new SupabaseCatalogRepository(adminClient);
    const results = await catalogRepo.listEvents({
      fromDate: testDate,
      toDate: testDate,
    });

    // Verify Event 1 associations
    const ev1Summary = results.find((e) => e.id === event1?.id);
    expect(ev1Summary).toBeDefined();
    expect(ev1Summary?.venueName).toBe(`Red Rocks Amphitheatre ${runSuffix}`);
    expect(ev1Summary?.city).toBe('Morrison');
    expect(ev1Summary?.region).toBe('CO');

    // Artists: verify ordered sequence and billing positions
    expect(ev1Summary?.artists).toHaveLength(2);
    expect(ev1Summary?.artists?.[0].name).toBe(`Headliner Band ${runSuffix}`);
    expect(ev1Summary?.artists?.[0].billingPosition).toBe('headliner');
    expect(ev1Summary?.artists?.[1].name).toBe(`Support Act ${runSuffix}`);
    expect(ev1Summary?.artists?.[1].billingPosition).toBe('support');

    // Ticket links: pricing aggregation
    expect(ev1Summary?.minPrice).toBe(35.0);
    expect(ev1Summary?.maxPrice).toBe(85.0);
    expect(ev1Summary?.currency).toBe('USD');

    // Sources: verify correct joins, multiple current sources, and exclusion of inactive
    expect(ev1Summary?.sources).toBeDefined();
    expect(ev1Summary?.sources).toHaveLength(2);
    const sourceNames = ev1Summary?.sources?.map((s) => s.name) ?? [];
    expect(sourceNames).toContain(`Source Alpha ${runSuffix}`);
    expect(sourceNames).toContain(`Source Beta ${runSuffix}`);
    expect(
      ev1Summary?.sources?.some(
        (s) => s.sourceUrl === 'https://alpha.example.com/events/historical-1',
      ),
    ).toBe(false);

    // Verify Event 2 fallback handling
    const ev2Summary = results.find((e) => e.id === event2?.id);
    expect(ev2Summary).toBeDefined();
    expect(ev2Summary?.venueName).toBe('Venue TBA');
    expect(ev2Summary?.artists).toEqual([]);
    expect(ev2Summary?.minPrice).toBeNull();
    expect(ev2Summary?.maxPrice).toBeNull();
    expect(ev2Summary?.sources).toEqual([]);

    // 7. Verify public anon RLS read permissions on catalog tables and views
    const { data: anonEventData, error: anonEventError } = await anonClient
      .from('events')
      .select('id, name')
      .eq('id', event1?.id)
      .single();
    expect(anonEventError).toBeNull();
    expect(anonEventData?.name).toBe(`Festival Showcase ${runSuffix}`);

    const { data: anonArtistData, error: anonArtistError } = await anonClient
      .from('event_artists')
      .select('event_id, artist_id, billing_position')
      .eq('event_id', event1?.id);
    expect(anonArtistError).toBeNull();
    expect(anonArtistData).toHaveLength(2);

    const { data: anonTicketData, error: anonTicketError } = await anonClient
      .from('event_ticket_links')
      .select('event_id, min_price, max_price')
      .eq('event_id', event1?.id);
    expect(anonTicketError).toBeNull();
    expect(anonTicketData).toHaveLength(1);

    const { data: anonSourceData, error: anonSourceError } = await anonClient
      .from('public_sources')
      .select('id, name, slug')
      .eq('id', sourceA?.id)
      .single();
    expect(anonSourceError).toBeNull();
    expect(anonSourceData?.name).toBe(`Source Alpha ${runSuffix}`);

    // Direct access to event_sources is denied to anonClient under RLS
    const { data: anonEventSources, error: anonEventSourcesError } =
      await anonClient
        .from('event_sources')
        .select('id')
        .eq('event_id', event1?.id);
    expect(
      anonEventSourcesError || anonEventSources?.length === 0,
    ).toBeTruthy();
  });

  it('validates production preferred-artist query completeness exceeding API row limit (>1000 event_artists rows)', async () => {
    if (!isDbAvailable || !adminClient) {
      if (process.env.CI) {
        throw new Error(
          'Local Supabase must be online for high-volume preferred-artist integration test.',
        );
      }
      return;
    }

    // 1. Seed dedicated high-volume artist and venue
    const testSuffix = `vol_${Date.now()}`;
    const { data: artist, error: aErr } = await adminClient
      .from('artists')
      .insert({
        name: `High Volume Artist ${testSuffix}`,
        normalized_name: `high volume artist ${testSuffix}`,
      })
      .select('id')
      .single();
    expect(aErr).toBeNull();
    const artistId = artist!.id;

    const { data: venue, error: vErr } = await adminClient
      .from('venues')
      .insert({
        name: `High Volume Arena ${testSuffix}`,
        normalized_name: `high volume arena ${testSuffix}`,
        city: 'Denver',
        region: 'CO',
        country_code: 'US',
        lat: 39.75,
        lng: -104.99,
        timezone: 'America/Denver',
      })
      .select('id')
      .single();
    expect(vErr).toBeNull();
    const venueId = venue!.id;

    // 2. Generate 1,020 events (exceeds PostgREST default max-rows limit of 1,000)
    // Invariant: The EARLIEST event is inserted LAST in the database.
    // If the repository performed an unpaginated subquery on event_artists, PostgREST's 1,000-row limit
    // would truncate the last 20 rows and miss the earliest event entirely.
    const TOTAL_EVENTS = 1020;
    const eventRows: Array<{
      id: string;
      name: string;
      normalized_name: string;
      event_kind: 'concert';
      status: 'scheduled';
      venue_id: string;
      city: string;
      region: string;
      country_code: string;
      timezone: string;
      local_start_date: string;
      starts_at: string;
      start_time_precision: 'instant';
      is_multi_day: boolean;
    }> = [];

    // Events 0 to 1018: far future dates (2028-01-01 through 2028-12-31)
    for (let i = 0; i < TOTAL_EVENTS - 1; i++) {
      const dayOffset = 500 + i;
      const d = new Date(Date.now() + dayOffset * 86400000)
        .toISOString()
        .split('T')[0];
      eventRows.push({
        id: crypto.randomUUID(),
        name: `Future Tour Date ${i} ${testSuffix}`,
        normalized_name: `future tour date ${i} ${testSuffix}`,
        event_kind: 'concert',
        status: 'scheduled',
        venue_id: venueId,
        city: 'Denver',
        region: 'CO',
        country_code: 'US',
        timezone: 'America/Denver',
        local_start_date: d,
        starts_at: `${d}T20:00:00-07:00`,
        start_time_precision: 'instant',
        is_multi_day: false,
      });
    }

    // Event 1019 (inserted LAST): Earliest date (tomorrow)
    const earliestDate = new Date(Date.now() + 86400000)
      .toISOString()
      .split('T')[0];
    const earliestEventId = crypto.randomUUID();
    eventRows.push({
      id: earliestEventId,
      name: `Earliest Tour Date (Inserted Last) ${testSuffix}`,
      normalized_name: `earliest tour date (inserted last) ${testSuffix}`,
      event_kind: 'concert',
      status: 'scheduled',
      venue_id: venueId,
      city: 'Denver',
      region: 'CO',
      country_code: 'US',
      timezone: 'America/Denver',
      local_start_date: earliestDate,
      starts_at: `${earliestDate}T20:00:00-07:00`,
      start_time_precision: 'instant',
      is_multi_day: false,
    });

    // Insert events in batches of 400
    const BATCH_SIZE = 400;
    for (let i = 0; i < eventRows.length; i += BATCH_SIZE) {
      const batch = eventRows.slice(i, i + BATCH_SIZE);
      const { error: insErr } = await adminClient.from('events').insert(batch);
      expect(insErr).toBeNull();
    }

    // Insert corresponding event_artists rows in batches of 400
    const eaRows = eventRows.map((e) => ({
      event_id: e.id,
      artist_id: artistId,
      billing_position: 'headliner' as const,
      sort_order: 1,
    }));
    for (let i = 0; i < eaRows.length; i += BATCH_SIZE) {
      const batch = eaRows.slice(i, i + BATCH_SIZE);
      const { error: eaErr } = await adminClient
        .from('event_artists')
        .insert(batch);
      expect(eaErr).toBeNull();
    }

    // 3. Query listEvents via SupabaseCatalogRepository using artistIds filter and limit 10
    const catalogRepo = new SupabaseCatalogRepository(adminClient);
    const listedEvents = await catalogRepo.listEvents({
      artistIds: [artistId],
      limit: 10,
      fromDate: earliestDate,
    });

    // Invariant verification:
    // 1. Returns bounded 10 events
    expect(listedEvents).toHaveLength(10);
    // 2. The FIRST event MUST be the earliest event (which was inserted last in the database)
    expect(listedEvents[0].id).toBe(earliestEventId);
    expect(listedEvents[0].title).toBe(
      `Earliest Tour Date (Inserted Last) ${testSuffix}`,
    );
    expect(listedEvents[0].localStartDate).toBe(earliestDate);

    // 3. Clean up all seeded entities to maintain database cleanliness
    await adminClient.from('artists').delete().eq('id', artistId);
    await adminClient.from('venues').delete().eq('id', venueId);
  }, 45000);
});
