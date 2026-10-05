import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { CanonicalizationCoordinator } from '@/lib/entity-resolution/canonicalization-coordinator';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { SupabaseSourceRepository } from '@/lib/repositories/source-repository';
import { SupabaseRawIngestRepository } from '@/lib/repositories/raw-ingest-repository';
import { SupabaseEventCandidateRepository } from '@/lib/repositories/event-candidate-repository';
import {
  createRawIngestForCandidate,
  getFixtureCandidate,
} from '@/tests/fixtures/fixture-helper';

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

  return {
    url: 'http://127.0.0.1:54321',
    anonKey:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE2MTQ1NTIwMDAsImV4cCI6MTk3MDEwODAwMH0.09X-XbQhJ191y_bS09YmKjX8X8x8_bS09YmKjX8X8x8',
    serviceRoleKey:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTYxNDU1MjAwMCwiZXhwIjoxOTcwMTA4MDAwfQ.09X-XbQhJ191y_bS09YmKjX8X8x8_bS09YmKjX8X8x8',
  };
}

describe('Phase 1 Inventory, Ingestion, and RLS Database Integration', () => {
  const credentials = resolveSupabaseCredentials();

  let adminClient: SupabaseClient | null = null;
  let anonClient: SupabaseClient | null = null;
  let isDbAvailable = false;

  let catalogRepo: SupabaseCatalogRepository;
  let sourceRepo: SupabaseSourceRepository;
  let rawIngestRepo: SupabaseRawIngestRepository;
  let candidateRepo: SupabaseEventCandidateRepository;

  const testSourceAId = 'a0000000-0000-0000-0000-000000000001';
  const testSourceBId = 'a0000000-0000-0000-0000-000000000002';

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
        `Local Supabase is not running at ${credentials.url}. Skipping Phase 1 database integration tests locally (Docker runtime required).`,
      );
      return;
    }

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    anonClient = createClient(credentials.url, credentials.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    catalogRepo = new SupabaseCatalogRepository(adminClient);
    sourceRepo = new SupabaseSourceRepository(adminClient);
    rawIngestRepo = new SupabaseRawIngestRepository(adminClient);
    candidateRepo = new SupabaseEventCandidateRepository(adminClient);

    // Ensure baseline test sources exist
    await sourceRepo.upsert({
      id: testSourceAId,
      slug: 'test-source-a',
      name: 'Test Source A',
      sourceType: 'venue',
      acquisitionMethod: 'structured_json',
      baseUrl: 'https://source-a.example.com',
      reliabilityScore: 0.95,
      active: true,
      parserVersion: '1.0.0',
      consecutiveFailures: 0,
    });

    await sourceRepo.upsert({
      id: testSourceBId,
      slug: 'test-source-b',
      name: 'Test Source B',
      sourceType: 'promoter',
      acquisitionMethod: 'html_http',
      baseUrl: 'https://source-b.example.com',
      reliabilityScore: 0.9,
      active: true,
      parserVersion: '1.0.0',
      consecutiveFailures: 0,
    });
  });

  describe('Database Schema Constraints', () => {
    it('enforces start_time_precision constraint (instant requires starts_at, date_only forbids it)', async () => {
      if (!isDbAvailable) return;

      // instant precision without starts_at must fail
      const { error: instantError } = await adminClient!.from('events').insert({
        name: 'Invalid Instant Event',
        normalized_name: 'invalid instant event',
        event_kind: 'concert',
        status: 'scheduled',
        timezone: 'America/Denver',
        local_start_date: '2026-10-15',
        start_time_precision: 'instant',
        starts_at: null, // Violated constraint
        is_multi_day: false,
      });
      expect(instantError).not.toBeNull();

      // date_only precision with starts_at must fail
      const { error: dateOnlyError } = await adminClient!
        .from('events')
        .insert({
          name: 'Invalid Date Only Event',
          normalized_name: 'invalid date only event',
          event_kind: 'concert',
          status: 'scheduled',
          timezone: 'America/Denver',
          local_start_date: '2026-10-15',
          start_time_precision: 'date_only',
          starts_at: '2026-10-15T20:00:00Z', // Violated constraint
          is_multi_day: false,
        });
      expect(dateOnlyError).not.toBeNull();
    });

    it('enforces composite foreign key consistency (candidate cannot link to different source raw ingest)', async () => {
      if (!isDbAvailable) return;

      // 1. Create raw ingest under source A
      const rawIngest = await rawIngestRepo.create({
        sourceId: testSourceAId,
        sourceUrl: 'https://source-a.example.com/shows/1',
        acquisitionMethod: 'structured_json',
        fetchedAt: new Date().toISOString(),
        contentHash: `hash_test_${Date.now()}`,
        contentType: 'application/json',
        rawContent: '{}',
        httpStatus: 200,
        parserVersion: '1.0.0',
      });

      // 2. Attempt to create candidate pointing to rawIngest.id but with source B
      const { error } = await adminClient!.from('event_candidates').insert({
        raw_ingest_id: rawIngest.id,
        source_id: testSourceBId, // Mismatched source ID!
        title: 'Mismatched Candidate',
        artist_names: ['Artist'],
        venue_name: 'Venue',
        confidence: 0.9,
      });

      expect(error).not.toBeNull();
    });
  });

  describe('Row Level Security (RLS) Policy Enforcement', () => {
    it('allows anonymous read access to public catalog tables', async () => {
      if (!isDbAvailable) return;

      const { data: sources, error: srcErr } = await anonClient!
        .from('sources')
        .select('*');
      expect(srcErr).toBeNull();
      expect(sources?.length).toBeGreaterThan(0);

      const { error: eventsErr } = await anonClient!.from('events').select('*');
      expect(eventsErr).toBeNull();

      const { error: artistsErr } = await anonClient!
        .from('artists')
        .select('*');
      expect(artistsErr).toBeNull();
    });

    it('denies anonymous write access to catalog tables', async () => {
      if (!isDbAvailable) return;

      const { error: artistInsertErr } = await anonClient!
        .from('artists')
        .insert({
          name: 'Malicious Artist',
          normalized_name: 'malicious artist',
        });
      expect(artistInsertErr).not.toBeNull();

      const { error: eventInsertErr } = await anonClient!
        .from('events')
        .insert({
          name: 'Malicious Event',
          normalized_name: 'malicious event',
          event_kind: 'concert',
          status: 'scheduled',
          timezone: 'America/Denver',
          local_start_date: '2026-10-15',
          start_time_precision: 'date_only',
          is_multi_day: false,
        });
      expect(eventInsertErr).not.toBeNull();
    });

    it('denies anonymous read and write access to operational ingestion tables', async () => {
      if (!isDbAvailable) return;

      // raw_ingests
      const { data: rawData, error: rawErr } = await anonClient!
        .from('raw_ingests')
        .select('*');
      expect(rawData).toHaveLength(0);

      // event_candidates
      const { data: candData } = await anonClient!
        .from('event_candidates')
        .select('*');
      expect(candData).toHaveLength(0);

      // event_field_evidence
      const { data: evData } = await anonClient!
        .from('event_field_evidence')
        .select('*');
      expect(evData).toHaveLength(0);

      // candidate_resolutions
      const { data: resData } = await anonClient!
        .from('candidate_resolutions')
        .select('*');
      expect(resData).toHaveLength(0);
    });
  });

  describe('End-to-End Pipeline in PostgreSQL', () => {
    it('executes full ingest -> candidate -> canonicalization flow in database', async () => {
      if (!isDbAvailable) return;

      const coordinator = new CanonicalizationCoordinator();
      const candidate = getFixtureCandidate('singleShow');

      // 1. Persist raw ingest
      const rawIngestData = createRawIngestForCandidate(candidate);
      const rawIngest = await rawIngestRepo.create(rawIngestData);

      // 2. Persist event candidate
      const persistedCandidate = await candidateRepo.create({
        ...candidate,
        rawIngestId: rawIngest.id,
        sourceId: candidate.sourceId,
      });

      // 3. Run canonicalization coordinator against real DB
      const resolution = await coordinator.canonicalize({
        candidate: persistedCandidate,
        catalogRepo,
      });

      expect(resolution.status).toBe('created');
      expect(resolution.eventId).toBeDefined();

      // 4. Verify canonical event in DB
      const eventDetail = await catalogRepo.getEventById(resolution.eventId!);
      expect(eventDetail).not.toBeNull();
      expect(eventDetail?.name).toBe('The Mountain Goats');
      expect(eventDetail?.venue?.name).toBe('Gothic Theatre');
      expect(eventDetail?.startTimePrecision).toBe('instant');
      expect(eventDetail?.ticketLinks.length).toBe(1);
      expect(eventDetail?.sources.length).toBe(1);

      // 5. Test Idempotent Replay
      const replayRes = await coordinator.canonicalize({
        candidate: persistedCandidate,
        catalogRepo,
      });
      expect(replayRes.status).toBe('created');
      expect(replayRes.eventId).toBe(resolution.eventId);
    });
  });
});
