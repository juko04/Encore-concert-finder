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

    // 10. Verify event field evidence recorded with field-level provenance (Issue 1)
    const { data: evidence } = await adminClient
      .from('event_field_evidence')
      .select('*')
      .eq('event_id', canonicalEventAId);
    expect(evidence).not.toBeNull();
    expect(evidence!.length).toBeGreaterThanOrEqual(10);

    const fieldNames = evidence!.map((e) => e.field_name);
    expect(fieldNames).toContain('title');
    expect(fieldNames).toContain('event_kind');
    expect(fieldNames).toContain('status');
    expect(fieldNames).toContain('venue');
    expect(fieldNames).toContain('city');
    expect(fieldNames).toContain('region');
    expect(fieldNames).toContain('country_code');
    expect(fieldNames).toContain('timezone');
    expect(fieldNames).toContain('local_start_date');
    expect(fieldNames).toContain('starts_at');
    expect(fieldNames).toContain('start_time_precision');
    expect(fieldNames).toContain('doors_at');
    expect(fieldNames).toContain('primary_ticket_url');
    expect(fieldNames).toContain('canonical_event_created');

    // Verify all initial field evidence rows link to correct source, raw ingest, and candidate
    for (const ev of evidence!) {
      expect(ev.source_id).toBe(adapter.id);
      expect(ev.raw_ingest_id).toBe(persistedRaw1Id);
      expect(ev.candidate_id).toBe(persistedCandA.id);
    }
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

  it('step 6: persists, reloads, and canonicalizes date-only candidate without startsAt (Issue 2)', async () => {
    if (!isDbAvailable || !adminClient) return;

    // Create raw ingest for date-only show
    const rawDateOnly = await rawIngestRepo.create({
      sourceId: adapter.id,
      sourceUrl: `https://example-venue.com/events/date-only-${Date.now()}`,
      acquisitionMethod: 'structured_json',
      fetchedAt: new Date().toISOString(),
      contentHash: `hash_date_only_${Date.now()}`,
      contentType: 'application/json',
      rawContent: JSON.stringify({}),
      httpStatus: 200,
      parserVersion: '1.1.0',
    });

    // Candidate has localStartDate, but NO startsAt and NO explicit startTimePrecision
    const dateOnlyCandidateInput: EventCandidate & {
      rawIngestId: string;
      sourceId: string;
    } = {
      rawIngestId: rawDateOnly.id,
      sourceId: adapter.id,
      sourceEventId: `tm_date_only_${Date.now()}`,
      title: 'Acoustic Sunday (Date Only)',
      artistNames: ['Local Acoustic Duo'],
      venueName: 'Red Rock Amphitheatre',
      city: 'Morrison',
      state: 'CO',
      country: 'US',
      timezone: 'America/Denver',
      localStartDate: '2026-11-05',
      // NO startsAt!
      // NO startTimePrecision!
      confidence: 0.95,
      verificationStatus: 'unverified',
      provenance: {
        sourceId: adapter.id,
        sourceType: 'venue',
        acquisitionMethod: 'structured_json',
        sourceUrl: rawDateOnly.sourceUrl,
        rawIngestId: rawDateOnly.id,
        fetchedAt: rawDateOnly.fetchedAt,
        contentHash: rawDateOnly.contentHash,
        parserVersion: '1.1.0',
        confidence: 0.95,
      },
    };

    // 1. Persist candidate
    const persistedDateOnly = await candidateRepo.create(
      dateOnlyCandidateInput,
    );
    expect(persistedDateOnly.id).toBeDefined();

    // 2. Reload candidate from database
    const reloaded = await candidateRepo.getById(persistedDateOnly.id);
    expect(reloaded).not.toBeNull();
    // Verify candidate reloads as date_only
    expect(reloaded!.startTimePrecision).toBe('date_only');
    expect(reloaded!.startsAt).toBeUndefined();

    // 3. Canonicalize reloaded candidate
    const resDateOnly = await coordinator.canonicalize(reloaded!);
    expect(resDateOnly.status).toBe('created');
    expect(resDateOnly.eventId).toBeDefined();

    // 4. Verify canonical event in database
    const { data: dbEvent } = await adminClient
      .from('events')
      .select('*')
      .eq('id', resDateOnly.eventId)
      .single();

    expect(dbEvent).not.toBeNull();
    expect(dbEvent.local_start_date).toBe('2026-11-05');
    expect(dbEvent.starts_at).toBeNull();
    expect(dbEvent.start_time_precision).toBe('date_only');
    // Confirms no midnight timestamp was fabricated!
  });

  it('step 7: prevents same-name artist false merges when canonical artist IDs disagree (Issue 3)', async () => {
    if (!isDbAvailable || !adminClient) return;

    const testNonce = Date.now();
    const rawGhost = await rawIngestRepo.create({
      sourceId: adapter.id,
      sourceUrl: `https://example-venue.com/events/ghost-${testNonce}`,
      acquisitionMethod: 'structured_json',
      fetchedAt: new Date().toISOString(),
      contentHash: `hash_ghost_${testNonce}`,
      contentType: 'application/json',
      rawContent: JSON.stringify({}),
      httpStatus: 200,
      parserVersion: '1.1.0',
    });

    // Show 1: Artist "Ghost" with external ID provider-1 / artist-A
    const candGhostA = await candidateRepo.create({
      rawIngestId: rawGhost.id,
      sourceId: adapter.id,
      sourceEventId: `ghost_show_A_${testNonce}`,
      title: 'Ghost Live - Tour A',
      artistNames: ['Ghost'],
      artists: [
        {
          name: 'Ghost',
          billingPosition: 'headliner',
          externalIds: [
            { provider: 'provider-1', externalId: `artist-A-${testNonce}` },
          ],
        },
      ],
      venueName: 'Red Rock Amphitheatre',
      city: 'Morrison',
      state: 'CO',
      country: 'US',
      timezone: 'America/Denver',
      localStartDate: '2026-11-12',
      startsAt: '2026-11-12T20:00:00-06:00',
      confidence: 0.95,
      verificationStatus: 'unverified',
      provenance: {
        sourceId: adapter.id,
        sourceType: 'venue',
        acquisitionMethod: 'structured_json',
        sourceUrl: rawGhost.sourceUrl,
        rawIngestId: rawGhost.id,
        fetchedAt: rawGhost.fetchedAt,
        contentHash: rawGhost.contentHash,
        parserVersion: '1.1.0',
        confidence: 0.95,
      },
    });

    const resGhostA = await coordinator.canonicalize(candGhostA);
    expect(resGhostA.status).toBe('created');
    expect(resGhostA.eventId).toBeDefined();

    // Show 2: Same venue, same local start date, same artist name "Ghost", but different external ID provider-1 / artist-B
    const candGhostB = await candidateRepo.create({
      rawIngestId: rawGhost.id,
      sourceId: adapter.id,
      sourceEventId: `ghost_show_B_${testNonce}`,
      title: 'Ghost Live - Tour B',
      artistNames: ['Ghost'],
      artists: [
        {
          name: 'Ghost',
          billingPosition: 'headliner',
          externalIds: [
            { provider: 'provider-1', externalId: `artist-B-${testNonce}` },
          ],
        },
      ],
      venueName: 'Red Rock Amphitheatre',
      city: 'Morrison',
      state: 'CO',
      country: 'US',
      timezone: 'America/Denver',
      localStartDate: '2026-11-12',
      startsAt: '2026-11-12T20:00:00-06:00',
      confidence: 0.95,
      verificationStatus: 'unverified',
      provenance: {
        sourceId: adapter.id,
        sourceType: 'venue',
        acquisitionMethod: 'structured_json',
        sourceUrl: rawGhost.sourceUrl,
        rawIngestId: rawGhost.id,
        fetchedAt: rawGhost.fetchedAt,
        contentHash: rawGhost.contentHash,
        parserVersion: '1.1.0',
        confidence: 0.95,
      },
    });

    const resGhostB = await coordinator.canonicalize(candGhostB);
    // Must NOT merge into Event A!
    expect(resGhostB.status).not.toBe('matched');
    expect(resGhostB.status).toBe('needs_review');
    expect(resGhostB.eventId).toBeNull();
  });

  it('step 8: enforces exact candidate ↔ raw observation composite FK integrity (Issue 4)', async () => {
    if (!isDbAvailable || !adminClient) return;

    const sourceA = adapter.id;

    // Raw Ingest 1
    const raw1 = await rawIngestRepo.create({
      sourceId: sourceA,
      sourceUrl: `https://example-venue.com/events/raw-1-${Date.now()}`,
      acquisitionMethod: 'structured_json',
      fetchedAt: new Date().toISOString(),
      contentHash: `hash_raw1_${Date.now()}`,
      contentType: 'application/json',
      rawContent: '{}',
      httpStatus: 200,
      parserVersion: '1.1.0',
    });

    // Candidate 1 under Raw Ingest 1
    const cand1 = await candidateRepo.create({
      rawIngestId: raw1.id,
      sourceId: sourceA,
      sourceEventId: `src_ev_fk_${Date.now()}`,
      title: 'Candidate Under Raw 1',
      artistNames: ['Artist One'],
      venueName: 'Red Rock Amphitheatre',
      city: 'Morrison',
      state: 'CO',
      timezone: 'America/Denver',
      localStartDate: '2026-11-15',
      confidence: 0.95,
      verificationStatus: 'unverified',
      provenance: {
        sourceId: sourceA,
        sourceType: 'venue',
        acquisitionMethod: 'structured_json',
        sourceUrl: raw1.sourceUrl,
        rawIngestId: raw1.id,
        fetchedAt: raw1.fetchedAt,
        contentHash: raw1.contentHash,
        parserVersion: '1.1.0',
        confidence: 0.95,
      },
    });

    // Raw Ingest 2 under same Source A
    const raw2 = await rawIngestRepo.create({
      sourceId: sourceA,
      sourceUrl: `https://example-venue.com/events/raw-2-${Date.now()}`,
      acquisitionMethod: 'structured_json',
      fetchedAt: new Date().toISOString(),
      contentHash: `hash_raw2_${Date.now()}`,
      contentType: 'application/json',
      rawContent: '{}',
      httpStatus: 200,
      parserVersion: '1.1.0',
    });

    expect(raw1.id).not.toBe(raw2.id);

    // Attempt to insert event_sources mixing Candidate 1 with Raw Ingest 2
    const { error: crossRawSourceError } = await adminClient
      .from('event_sources')
      .insert({
        event_id: canonicalEventAId,
        source_id: sourceA,
        candidate_id: cand1.id,
        raw_ingest_id: raw2.id, // Mismatch! cand1 belongs to raw1, not raw2
        source_url: 'https://example.com/cross-raw',
      });

    expect(crossRawSourceError).not.toBeNull();
    // 23503 is foreign_key_violation in PostgreSQL
    expect(crossRawSourceError?.code).toBe('23503');
    expect(crossRawSourceError?.message).toContain(
      'fk_event_sources_candidate_source_raw',
    );

    // Attempt to insert event_field_evidence mixing Candidate 1 with Raw Ingest 2
    const { error: crossRawEvidenceError } = await adminClient
      .from('event_field_evidence')
      .insert({
        event_id: canonicalEventAId,
        field_name: 'title',
        source_id: sourceA,
        candidate_id: cand1.id,
        raw_ingest_id: raw2.id, // Mismatch! cand1 belongs to raw1, not raw2
        observed_value: { title: 'Mismatch' },
        value_hash: 'hash_mismatch',
      });

    expect(crossRawEvidenceError).not.toBeNull();
    expect(crossRawEvidenceError?.code).toBe('23503');
    expect(crossRawEvidenceError?.message).toContain(
      'fk_event_field_evidence_candidate_source_raw',
    );
  });

  it('step 9: executes createMany() idempotently on batch replay without duplicates (Issue 5)', async () => {
    if (!isDbAvailable || !adminClient) return;

    const rawBatch = await rawIngestRepo.create({
      sourceId: adapter.id,
      sourceUrl: `https://example-venue.com/events/batch-${Date.now()}`,
      acquisitionMethod: 'structured_json',
      fetchedAt: new Date().toISOString(),
      contentHash: `hash_batch_${Date.now()}`,
      contentType: 'application/json',
      rawContent: '{}',
      httpStatus: 200,
      parserVersion: '1.1.0',
    });

    const batchInput = [
      {
        rawIngestId: rawBatch.id,
        sourceId: adapter.id,
        sourceEventId: `batch_show_1_${Date.now()}`,
        title: 'Batch Show One',
        artistNames: ['Artist One'],
        venueName: 'Red Rock Amphitheatre',
        city: 'Morrison',
        state: 'CO',
        timezone: 'America/Denver',
        localStartDate: '2026-11-20',
        confidence: 0.95,
        verificationStatus: 'unverified' as const,
        provenance: {
          sourceId: adapter.id,
          sourceType: 'venue' as const,
          acquisitionMethod: 'structured_json' as const,
          sourceUrl: rawBatch.sourceUrl,
          rawIngestId: rawBatch.id,
          fetchedAt: rawBatch.fetchedAt,
          contentHash: rawBatch.contentHash,
          parserVersion: '1.1.0',
          confidence: 0.95,
        },
      },
      {
        rawIngestId: rawBatch.id,
        sourceId: adapter.id,
        sourceEventId: `batch_show_2_${Date.now()}`,
        title: 'Batch Show Two',
        artistNames: ['Artist Two'],
        venueName: 'Red Rock Amphitheatre',
        city: 'Morrison',
        state: 'CO',
        timezone: 'America/Denver',
        localStartDate: '2026-11-21',
        confidence: 0.95,
        verificationStatus: 'unverified' as const,
        provenance: {
          sourceId: adapter.id,
          sourceType: 'venue' as const,
          acquisitionMethod: 'structured_json' as const,
          sourceUrl: rawBatch.sourceUrl,
          rawIngestId: rawBatch.id,
          fetchedAt: rawBatch.fetchedAt,
          contentHash: rawBatch.contentHash,
          parserVersion: '1.1.0',
          confidence: 0.95,
        },
      },
    ];

    // First bulk insert
    const run1 = await candidateRepo.createMany(batchInput);
    expect(run1.length).toBe(2);
    expect(run1[0].id).not.toBe(run1[1].id);

    // Replay identical batch
    const run2 = await candidateRepo.createMany(batchInput);
    expect(run2.length).toBe(2);

    // Candidates must reuse existing rows with stable IDs
    expect(run2[0].id).toBe(run1[0].id);
    expect(run2[1].id).toBe(run1[1].id);

    // Verify row count in Supabase
    const { data: dbCandidates } = await adminClient
      .from('event_candidates')
      .select('*')
      .eq('raw_ingest_id', rawBatch.id);

    expect(dbCandidates?.length).toBe(2);
  });
});
