import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { SupabaseSourceRepository } from '@/lib/repositories/source-repository';
import { SupabaseRawIngestRepository } from '@/lib/repositories/raw-ingest-repository';
import { SupabaseEventCandidateRepository } from '@/lib/repositories/event-candidate-repository';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { ensureTicketmasterSource } from '@/lib/sources/ticketmaster/source-registry';
import { runTicketmasterIngestion } from '@/lib/sources/ticketmaster/ingestion-pipeline';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import type { CanonicalizationPayload } from '@/lib/repositories/interfaces';

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

describe('Supabase Integration: Ticketmaster Ingestion & Canonicalization', () => {
  const credentials = resolveSupabaseCredentials();

  let adminClient: SupabaseClient | null = null;
  let isDbAvailable = false;

  let sourceRepo: SupabaseSourceRepository;
  let rawIngestRepo: SupabaseRawIngestRepository;
  let candidateRepo: SupabaseEventCandidateRepository;
  let catalogRepo: SupabaseCatalogRepository;

  function ensureDbAvailable(): boolean {
    if (!isDbAvailable || !adminClient) {
      if (process.env.CI) {
        throw new Error(
          `Local Supabase stack is not responding at ${credentials?.url ?? 'unknown'} in CI. Database validation is required on pull requests.`,
        );
      }
      return false;
    }
    return true;
  }

  beforeAll(async () => {
    if (!credentials) {
      if (process.env.CI) {
        throw new Error('Supabase credentials could not be resolved in CI.');
      }
      return;
    }

    // Verify database target passes strict destination safety guard
    assertSafeDatabaseTarget(
      credentials.url,
      false,
      'Ticketmaster integration test suite',
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
        `Local Supabase is not running at ${credentials.url}. Skipping Ticketmaster integration tests locally.`,
      );
      return;
    }

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    sourceRepo = new SupabaseSourceRepository(adminClient);
    rawIngestRepo = new SupabaseRawIngestRepository(adminClient);
    candidateRepo = new SupabaseEventCandidateRepository(adminClient);
    catalogRepo = new SupabaseCatalogRepository(adminClient);
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

  it('runs deterministic fixture ingestion through PostgreSQL stored procedure and verifies canonical events', async () => {
    if (!ensureDbAvailable()) return;

    const source = await ensureTicketmasterSource(sourceRepo);
    expect(source.slug).toBe('ticketmaster-discovery');

    const result = await runTicketmasterIngestion({
      useFixture: true,
      persist: true,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
    });

    expect(result.rawIngestsPersisted).toBeGreaterThan(0);
    expect(result.candidatesPersisted).toBeGreaterThan(0);
    expect(result.canonicalEventsCreated).toBeGreaterThan(0);

    // Verify canonical events are listed in catalog
    const events = await catalogRepo.listEvents({ limit: 10 });
    expect(events.length).toBeGreaterThan(0);
  });

  it('verifies idempotent replay through PostgreSQL stored procedure produces zero duplicate events and stable evidence/resolution counts', async () => {
    if (!ensureDbAvailable()) return;

    const eventsBefore = await catalogRepo.listEvents({ limit: 50 });
    const resolutionsBefore = await catalogRepo.countResolutions();
    const evidenceBefore = await catalogRepo.countFieldEvidence();

    const replayRun = await runTicketmasterIngestion({
      useFixture: true,
      persist: true,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
    });

    // Replay must match existing canonical events rather than creating duplicates
    expect(replayRun.rawIngestsPersisted).toBe(0);
    expect(replayRun.rawIngestsReused).toBeGreaterThan(0);
    expect(replayRun.candidatesReused).toBeGreaterThan(0);
    expect(replayRun.canonicalEventsCreated).toBe(0);
    expect(replayRun.canonicalEventsMatched).toBeGreaterThan(0);

    const eventsAfter = await catalogRepo.listEvents({ limit: 50 });
    expect(eventsAfter.length).toBe(eventsBefore.length);

    // Verify candidate resolutions and field evidence row counts did NOT inflate on replay
    const resolutionsAfter = await catalogRepo.countResolutions();
    const evidenceAfter = await catalogRepo.countFieldEvidence();
    expect(resolutionsAfter).toBe(resolutionsBefore);
    expect(evidenceAfter).toBe(evidenceBefore);
  });

  it('reprocess mode deliberately re-evaluates candidates through PostgreSQL stored procedure', async () => {
    if (!ensureDbAvailable()) return;

    const reprocessRun = await runTicketmasterIngestion({
      useFixture: true,
      persist: true,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      reprocess: true,
    });

    expect(reprocessRun.candidatesReused).toBe(0);
    expect(reprocessRun.canonicalEventsCreated).toBe(0);
    expect(reprocessRun.canonicalEventsMatched).toBeGreaterThan(0);
  });

  it('successfully enriches external IDs for matched artist in PostgreSQL stored procedure', async () => {
    if (!ensureDbAvailable()) return;

    const testNonce = Date.now().toString();
    const artistName = `Test Match Artist ${testNonce}`;

    // 1. Create artist in PostgreSQL
    const { data: artist, error: artistError } = await adminClient!
      .from('artists')
      .insert({
        name: artistName,
        normalized_name: artistName.toLowerCase().trim(),
      })
      .select('id')
      .single();

    expect(artistError).toBeNull();
    expect(artist?.id).toBeDefined();

    // 2. Execute canonicalization transaction enriching the artist with a Ticketmaster external ID
    const externalId = `TM-ENRICH-${testNonce}`;
    const payload: CanonicalizationPayload = {
      event: {
        name: `Enrichment Concert ${testNonce}`,
        normalized_name: `enrichment concert ${testNonce}`,
        local_start_date: '2026-11-20',
        timezone: 'America/Denver',
      },
      artists: [
        {
          artist_id: artist!.id,
          name: artistName,
          external_ids: [
            {
              provider: 'ticketmaster',
              external_id: externalId,
              provider_url: `https://ticketmaster.com/artist/${externalId}`,
            },
          ],
        },
      ],
    };

    const res = await catalogRepo.applyCanonicalization(payload);
    expect(res.eventId).toBeDefined();

    // 3. Verify external ID record was committed to artist_external_ids
    const { data: extRecords, error: extError } = await adminClient!
      .from('artist_external_ids')
      .select('*')
      .eq('artist_id', artist!.id)
      .eq('provider', 'ticketmaster');

    expect(extError).toBeNull();
    expect(extRecords?.length).toBe(1);
    expect(extRecords![0].external_id).toBe(externalId);
  });

  it('idempotent identical external ID replay succeeds in PostgreSQL without error', async () => {
    if (!ensureDbAvailable()) return;

    const testNonce = Date.now().toString();
    const artistName = `Test Idempotent Artist ${testNonce}`;

    const { data: artist, error: artistError } = await adminClient!
      .from('artists')
      .insert({
        name: artistName,
        normalized_name: artistName.toLowerCase().trim(),
      })
      .select('id')
      .single();

    expect(artistError).toBeNull();
    expect(artist?.id).toBeDefined();

    const externalId = `TM-IDEM-${testNonce}`;
    const payload: CanonicalizationPayload = {
      event: {
        name: `Idempotent Concert ${testNonce}`,
        normalized_name: `idempotent concert ${testNonce}`,
        local_start_date: '2026-11-21',
        timezone: 'America/Denver',
      },
      artists: [
        {
          artist_id: artist!.id,
          name: artistName,
          external_ids: [
            {
              provider: 'ticketmaster',
              external_id: externalId,
            },
          ],
        },
      ],
    };

    // First application
    const res1 = await catalogRepo.applyCanonicalization(payload);
    expect(res1.eventId).toBeDefined();

    // Replay with identical (artist_id, provider, external_id)
    const res2 = await catalogRepo.applyCanonicalization(payload);
    expect(res2.eventId).toBeDefined();

    // Verify row count in artist_external_ids remains exactly 1
    const { data: extRecords } = await adminClient!
      .from('artist_external_ids')
      .select('*')
      .eq('artist_id', artist!.id)
      .eq('provider', 'ticketmaster');

    expect(extRecords?.length).toBe(1);
  });

  it('cross-artist external ID conflict rejects with 23505 and rolls back entire transaction atomically in PostgreSQL', async () => {
    if (!ensureDbAvailable()) return;

    const testNonce = Date.now().toString();
    const artist1Name = `Test Alpha Artist ${testNonce}`;
    const artist2Name = `Test Beta Artist ${testNonce}`;

    // 1. Create artist 1 and assign external ID
    const { data: artist1, error: a1Error } = await adminClient!
      .from('artists')
      .insert({
        name: artist1Name,
        normalized_name: artist1Name.toLowerCase().trim(),
      })
      .select('id')
      .single();
    expect(a1Error).toBeNull();

    const sharedExternalId = `TM-SHARED-${testNonce}`;
    const { error: ext1Error } = await adminClient!
      .from('artist_external_ids')
      .insert({
        artist_id: artist1!.id,
        provider: 'ticketmaster',
        external_id: sharedExternalId,
      });
    expect(ext1Error).toBeNull();

    // 2. Create artist 2
    const { data: artist2, error: a2Error } = await adminClient!
      .from('artists')
      .insert({
        name: artist2Name,
        normalized_name: artist2Name.toLowerCase().trim(),
      })
      .select('id')
      .single();
    expect(a2Error).toBeNull();

    // 3. Attempt canonicalization transaction with a new event and venue, attempting to assign artist 1's external ID to artist 2
    const conflictingEventName = `Conflicting Concert ${testNonce}`;
    const conflictingVenueName = `Conflicting Venue ${testNonce}`;
    const conflictPayload: CanonicalizationPayload = {
      event: {
        name: conflictingEventName,
        normalized_name: conflictingEventName.toLowerCase().trim(),
        local_start_date: '2026-11-22',
        timezone: 'America/Denver',
      },
      venueToCreate: {
        name: conflictingVenueName,
        normalized_name: conflictingVenueName.toLowerCase().trim(),
        city: 'Denver',
      },
      artists: [
        {
          artist_id: artist2!.id,
          name: artist2Name,
          external_ids: [
            {
              provider: 'ticketmaster',
              external_id: sharedExternalId, // Belongs to Artist 1!
            },
          ],
        },
      ],
    };

    // Stored procedure must raise exception 23505 and fail the transaction
    await expect(
      catalogRepo.applyCanonicalization(conflictPayload),
    ).rejects.toThrow(
      /Cannot assign external_id .* already assigned to artist|23505|unique constraint/i,
    );

    // 4. Verify complete PostgreSQL transaction rollback:
    // Event was NOT inserted
    const { data: rolledBackEvents } = await adminClient!
      .from('events')
      .select('id')
      .eq('name', conflictingEventName);
    expect(rolledBackEvents?.length).toBe(0);

    // Venue was NOT inserted
    const { data: rolledBackVenues } = await adminClient!
      .from('venues')
      .select('id')
      .eq('name', conflictingVenueName);
    expect(rolledBackVenues?.length).toBe(0);

    // Artist 2 was NOT given the external ID
    const { data: artist2Ext } = await adminClient!
      .from('artist_external_ids')
      .select('*')
      .eq('artist_id', artist2!.id);
    expect(artist2Ext?.length).toBe(0);

    // Artist 1 still exclusively owns the external ID
    const { data: artist1Ext } = await adminClient!
      .from('artist_external_ids')
      .select('*')
      .eq('external_id', sharedExternalId);
    expect(artist1Ext?.length).toBe(1);
    expect(artist1Ext![0].artist_id).toBe(artist1!.id);
  });
});
