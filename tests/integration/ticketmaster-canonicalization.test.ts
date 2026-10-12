import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { SupabaseSourceRepository } from '@/lib/repositories/source-repository';
import { SupabaseRawIngestRepository } from '@/lib/repositories/raw-ingest-repository';
import { SupabaseEventCandidateRepository } from '@/lib/repositories/event-candidate-repository';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { ensureTicketmasterSource } from '@/lib/sources/ticketmaster/source-registry';
import { runTicketmasterIngestion } from '@/lib/sources/ticketmaster/ingestion-pipeline';

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

  it('verifies idempotent replay through PostgreSQL stored procedure produces zero duplicate events', async () => {
    if (!ensureDbAvailable()) return;

    const run1 = await runTicketmasterIngestion({
      useFixture: true,
      persist: true,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
    });

    const run2 = await runTicketmasterIngestion({
      useFixture: true,
      persist: true,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
    });

    // Replay should match existing events rather than creating duplicates
    expect(run2.canonicalEventsCreated).toBe(0);
    expect(run2.canonicalEventsMatched).toBe(run1.canonicalEventsCreated);
  });
});
