import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { FakeVenueSourceAdapter } from '../fixtures/fake-source-adapter';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { SupabaseRawIngestRepository } from '@/lib/repositories/raw-ingest-repository';
import { SupabaseEventCandidateRepository } from '@/lib/repositories/event-candidate-repository';
import { CanonicalizationCoordinator } from '@/lib/entity-resolution/canonicalization-coordinator';
import type { EventCandidate } from '@/lib/domain/event-candidate';

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

describe('Supabase Golden Path Integration: Full Ingestion & Canonicalization Pipeline', () => {
  const credentials = resolveSupabaseCredentials();

  let adminClient: SupabaseClient | null = null;
  let isDbAvailable = false;

  let rawIngestRepo: SupabaseRawIngestRepository;
  let candidateRepo: SupabaseEventCandidateRepository;
  let catalogRepo: SupabaseCatalogRepository;
  let coordinator: CanonicalizationCoordinator;
  const adapter = new FakeVenueSourceAdapter();

  // Shared test context across golden path steps
  let persistedRaw1Id: string;
  let persistedCandA: EventCandidate & {
    id: string;
    rawIngestId: string;
    sourceId: string;
  };
  let persistedCandB: EventCandidate & {
    id: string;
    rawIngestId: string;
    sourceId: string;
  };
  let canonicalEventAId: string;
  let canonicalEventBId: string;

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

    rawIngestRepo = new SupabaseRawIngestRepository(adminClient);
    candidateRepo = new SupabaseEventCandidateRepository(adminClient);
    catalogRepo = new SupabaseCatalogRepository(adminClient);
    coordinator = new CanonicalizationCoordinator(catalogRepo);
  });

  it('step 1: ingests multi-event page fixture -> 1 raw ingest, 2 distinct candidate rows with UUIDs and artist external IDs', async () => {
    if (!isDbAvailable || !adminClient) return;

    // 1. Adapter crawl fetches raw pages
    const crawlResult = await adapter.crawl({
      sourceId: adapter.id,
      sourceType: 'venue',
      acquisitionMethod: 'structured_json',
      targetUrl: 'https://example-venue.com/events',
      crawlStartedAt: new Date().toISOString(),
    });

    expect(crawlResult.rawIngests.length).toBeGreaterThanOrEqual(1);
    const rawPage1 = crawlResult.rawIngests[0];

    // 2. Persist raw ingest row
    const persistedRaw1 = await rawIngestRepo.create(rawPage1);
    expect(persistedRaw1.id).toBeDefined();
    persistedRaw1Id = persistedRaw1.id;

    // 3. Adapter parses candidates associated with persistedRaw1
    const rawForParse = { ...rawPage1, id: persistedRaw1.id };
    const candidates = await adapter.parse([rawForParse]);
    expect(candidates.length).toBe(2);

    const [candAInput, candBInput] = candidates;
    expect(candAInput.sourceEventId).toBe('evt-101');
    expect(candBInput.sourceEventId).toBe('evt-102');

    // 4. Persist both candidate rows to database
    persistedCandA = await candidateRepo.create(
      candAInput as EventCandidate & { rawIngestId: string; sourceId: string },
    );
    persistedCandB = await candidateRepo.create(
      candBInput as EventCandidate & { rawIngestId: string; sourceId: string },
    );

    // Assert candidates have valid, non-colliding UUIDs
    expect(persistedCandA.id).toBeDefined();
    expect(persistedCandB.id).toBeDefined();
    expect(persistedCandA.id).not.toBe(persistedCandB.id);
    expect(persistedCandA.rawIngestId).toBe(persistedRaw1Id);
    expect(persistedCandB.rawIngestId).toBe(persistedRaw1Id);

    // Verify candidates exist in event_candidates table
    const { data: dbCandA } = await adminClient
      .from('event_candidates')
      .select('*')
      .eq('id', persistedCandA.id)
      .single();
    expect(dbCandA).not.toBeNull();
    expect(dbCandA.candidate_artists).toBeDefined();
    expect(Array.isArray(dbCandA.candidate_artists)).toBe(true);
    expect(dbCandA.candidate_artists[0].externalIds?.length).toBeGreaterThan(0);

    // 5. Canonicalize both candidates
    const resA = await coordinator.canonicalize(persistedCandA);
    const resB = await coordinator.canonicalize(persistedCandB);

    expect(resA.status).toBe('created');
    expect(resB.status).toBe('created');
    expect(resA.eventId).toBeDefined();
    expect(resB.eventId).toBeDefined();
    expect(resA.eventId).not.toBe(resB.eventId);

    canonicalEventAId = resA.eventId!;
    canonicalEventBId = resB.eventId!;

    // 6. Verify canonical event details in database
    const { data: eventA } = await adminClient
      .from('events')
      .select('*')
      .eq('id', canonicalEventAId)
      .single();
    expect(eventA).not.toBeNull();
    expect(eventA.name).toBe(persistedCandA.title);
    expect(eventA.timezone).toBe('America/Denver');

    // 7. Verify artist external ID round-trip: spotify external ID is stored in artist_external_ids table
    const { data: artistExtIds } = await adminClient
      .from('artist_external_ids')
      .select('*')
      .eq('external_id', 'spotify_artist_mountain_echoes');
    expect(artistExtIds?.length).toBeGreaterThanOrEqual(1);
    expect(artistExtIds![0].provider).toBe('spotify');

    // 8. Verify ticket links created
    const { data: ticketLinks } = await adminClient
      .from('event_ticket_links')
      .select('*')
      .eq('event_id', canonicalEventAId);
    expect(ticketLinks?.length).toBeGreaterThanOrEqual(1);
    expect(ticketLinks![0].url).toBe('https://tickets.example.com/evt-101');

    // 9. Verify event source record attached to event A
    const { data: eventSources } = await adminClient
      .from('event_sources')
      .select('*')
      .eq('event_id', canonicalEventAId);
    expect(eventSources?.length).toBeGreaterThanOrEqual(1);
    expect(eventSources![0].source_event_id).toBe('evt-101');
    expect(eventSources![0].candidate_id).toBe(persistedCandA.id);
    expect(eventSources![0].raw_ingest_id).toBe(persistedRaw1Id);

    // 10. Verify event field evidence recorded
    const { data: evidence } = await adminClient
      .from('event_field_evidence')
      .select('*')
      .eq('event_id', canonicalEventAId);
    expect(evidence?.length).toBeGreaterThanOrEqual(1);
    expect(evidence!.some((e) => e.field_name === 'title')).toBe(true);
  });

  it('step 2: handles second observation for Event A (rescheduled date/time, price change) without duplicate canonical event and preserving prior evidence', async () => {
    if (!isDbAvailable || !adminClient || !canonicalEventAId) return;

    // 1. Simulate next-day crawl producing a second raw ingest
    const rawObs2 = await rawIngestRepo.create({
      sourceId: adapter.id,
      sourceUrl: 'https://example-venue.com/events?page=1',
      acquisitionMethod: 'structured_json',
      fetchedAt: new Date(Date.now() + 86400000).toISOString(),
      contentHash: `hash_page_1_rescheduled_${Date.now()}`,
      contentType: 'application/json',
      rawContent: JSON.stringify({ page: 1, events: [] }),
      httpStatus: 200,
      parserVersion: '1.1.0',
    });

    expect(rawObs2.id).not.toBe(persistedRaw1Id);

    // 2. Second candidate observation: rescheduled to Oct 17 21:00, price $50 - $95
    const candA_obs2 = await candidateRepo.create({
      ...persistedCandA,
      rawIngestId: rawObs2.id,
      sourceId: adapter.id,
      sourceEventId: 'evt-101', // same upstream stable ID
      title: 'The Mountain Echoes Live (Rescheduled Show)',
      localStartDate: '2026-10-17',
      startsAt: '2026-10-17T21:00:00-06:00',
      price: { min: 50.0, max: 95.0, currency: 'USD' },
      provenance: {
        ...persistedCandA.provenance,
        rawIngestId: rawObs2.id,
        contentHash: rawObs2.contentHash,
        fetchedAt: rawObs2.fetchedAt,
      },
    });

    // Verify candidate observation is an immutable separate row
    expect(candA_obs2.id).not.toBe(persistedCandA.id);
    expect(candA_obs2.rawIngestId).toBe(rawObs2.id);

    // 3. Canonicalize second candidate
    const resA_obs2 = await coordinator.canonicalize(candA_obs2);

    // Must resolve to existing canonical event, NOT create a duplicate
    expect(resA_obs2.status).toBe('matched');
    expect(resA_obs2.eventId).toBe(canonicalEventAId);

    // 4. Exactly one canonical event exists for Event A
    const { count: eventCount } = await adminClient
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('id', canonicalEventAId);
    expect(eventCount).toBe(1);

    // 5. Canonical event has updated date and start time
    const { data: updatedEvent } = await adminClient
      .from('events')
      .select('*')
      .eq('id', canonicalEventAId)
      .single();
    expect(updatedEvent.local_start_date).toBe('2026-10-17');
    expect(updatedEvent.starts_at).toBe('2026-10-17T21:00:00-06:00');

    // 6. Verify field evidence contains observations from BOTH ingest runs (history is preserved)
    const { data: allEvidence } = await adminClient
      .from('event_field_evidence')
      .select('*')
      .eq('event_id', canonicalEventAId);
    expect(allEvidence).not.toBeNull();

    const candidateIdsInEvidence = allEvidence!.map((e) => e.candidate_id);
    expect(candidateIdsInEvidence).toContain(persistedCandA.id);
    expect(candidateIdsInEvidence).toContain(candA_obs2.id);
  });

  it('step 3: rejects reassigning existing source_event_id to a different canonical event', async () => {
    if (
      !isDbAvailable ||
      !adminClient ||
      !canonicalEventAId ||
      !canonicalEventBId
    )
      return;

    // Upstream evt-101 is already associated with canonicalEventAId.
    // Attempting to map (adapter.id, evt-101) to canonicalEventBId must fail with unique constraint violation 23505
    const { error: reassignmentError } = await adminClient
      .from('event_sources')
      .insert({
        event_id: canonicalEventBId, // conflicting destination
        source_id: adapter.id,
        source_event_id: 'evt-101', // already attached to event A
        source_url: 'https://example-venue.com/events/conflict',
      });

    expect(reassignmentError).not.toBeNull();
    expect(reassignmentError?.code).toBe('23505');
  });

  it('step 4: maintains raw ingest URL separation: identical content hash on URL A vs URL B produces 2 distinct raw ingests', async () => {
    if (!isDbAvailable) return;

    const deterministicHash = `hash_identical_${Date.now()}`;
    const rawA = await rawIngestRepo.create({
      sourceId: adapter.id,
      sourceUrl: `https://example-venue.com/events/view-a?nonce=${Date.now()}`,
      acquisitionMethod: 'structured_json',
      fetchedAt: new Date().toISOString(),
      contentHash: deterministicHash,
      contentType: 'application/json',
      rawContent: '{"view": "a"}',
      httpStatus: 200,
      parserVersion: '1.1.0',
    });

    const rawB = await rawIngestRepo.create({
      sourceId: adapter.id,
      sourceUrl: `https://example-venue.com/events/view-b?nonce=${Date.now()}`,
      acquisitionMethod: 'structured_json',
      fetchedAt: new Date().toISOString(),
      contentHash: deterministicHash,
      contentType: 'application/json',
      rawContent: '{"view": "b"}',
      httpStatus: 200,
      parserVersion: '1.1.0',
    });

    expect(rawA.id).not.toBe(rawB.id);
    expect(rawA.contentHash).toBe(rawB.contentHash);
    expect(rawA.sourceUrl).not.toBe(rawB.sourceUrl);
  });

  it('step 5: verifies artist external ID lookup through repository read methods', async () => {
    if (!isDbAvailable || !adminClient) return;

    const artist = await catalogRepo.findArtistByExternalId(
      'spotify',
      'spotify_artist_mountain_echoes',
    );
    expect(artist).not.toBeNull();
    expect(artist?.name).toBe('The Mountain Echoes');

    const extIds = await catalogRepo.findArtistExternalIds(artist!.id);
    expect(extIds.length).toBeGreaterThanOrEqual(1);
    expect(
      extIds.some(
        (e) =>
          e.provider === 'spotify' &&
          e.externalId === 'spotify_artist_mountain_echoes',
      ),
    ).toBe(true);
  });
});
