#!/usr/bin/env node

/**
 * Controlled CLI Ingestion Runner for Official Venue Websites (Phase 3, PR #13).
 *
 * Usage:
 *   # Safe dry-run preview from fixture (default, zero network, zero database writes):
 *   npm run ingest:venue -- --fixture
 *
 *   # Safe dry-run preview from live venue website:
 *   npm run ingest:venue -- --live
 *
 *   # Explicit database persistence mode from fixture:
 *   npm run ingest:venue -- --fixture --persist
 *
 *   # Explicit database persistence mode from live venue website:
 *   npm run ingest:venue -- --live --persist
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  CervantesVenueAdapter,
  runVenueIngestion,
  CERVANTES_CONFIG,
} from '@/lib/sources/venue';
import {
  MemoryCatalogRepository,
  MemoryEventCandidateRepository,
  MemoryRawIngestRepository,
  MemorySourceRepository,
} from '@/lib/repositories/memory-repositories';
import { SupabaseSourceRepository } from '@/lib/repositories/source-repository';
import { SupabaseRawIngestRepository } from '@/lib/repositories/raw-ingest-repository';
import { SupabaseEventCandidateRepository } from '@/lib/repositories/event-candidate-repository';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';

interface ParsedArgs {
  venue: string;
  useFixture: boolean;
  live: boolean;
  persist: boolean;
  allowProductionWrite: boolean;
  reprocess: boolean;
  fixturePath?: string;
}

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

function parseCliArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    venue: 'cervantes',
    useFixture: false,
    live: false,
    persist: false,
    allowProductionWrite: false,
    reprocess: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--fixture') {
      args.useFixture = true;
    } else if (arg.startsWith('--fixture=')) {
      args.useFixture = true;
      args.fixturePath = arg.slice('--fixture='.length);
    } else if (arg === '--live') {
      args.live = true;
    } else if (arg === '--persist') {
      args.persist = true;
    } else if (arg === '--dry-run') {
      args.persist = false;
    } else if (arg === '--allow-production-write') {
      args.allowProductionWrite = true;
    } else if (arg === '--reprocess') {
      args.reprocess = true;
    } else if (arg.startsWith('--venue=')) {
      args.venue = arg.slice('--venue='.length).toLowerCase();
    }
  }

  // Default: if neither --live nor --fixture specified, default to fixture for safety
  if (!args.live && !args.useFixture) {
    args.useFixture = true;
  }

  return args;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const args = parseCliArgs(process.argv);

  console.log('='.repeat(70));
  console.log('  ENCORE — PHASE 3 VENUE INGESTION RUNNER (PR #13)');
  console.log('='.repeat(70));
  console.log(`Venue:       ${args.venue}`);
  console.log(
    `Mode:        ${args.persist ? 'PERSIST (Database Writes Enabled)' : 'DRY RUN (Preview Only)'}`,
  );
  console.log(
    `Source:      ${args.useFixture ? 'Local Static Fixture' : 'Live Official Venue Website'}`,
  );
  console.log(`Reprocess:   ${args.reprocess ? 'YES' : 'NO'}`);
  console.log('='.repeat(70));

  if (args.persist) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    assertSafeDatabaseTarget(
      supabaseUrl,
      args.allowProductionWrite,
      'Venue Ingestion CLI Runner',
    );
  }

  // Select adapter configuration based on venue argument
  let config = CERVANTES_CONFIG;
  let adapter = new CervantesVenueAdapter();

  if (args.venue !== 'cervantes') {
    console.error(
      `Unknown venue: ${args.venue}. Currently supported venues: cervantes`,
    );
    process.exit(1);
  }

  // Select repositories: in-memory for dry-run; Supabase for persistence
  const sourceRepo = args.persist
    ? new SupabaseSourceRepository()
    : new MemorySourceRepository();
  const rawIngestRepo = args.persist
    ? new SupabaseRawIngestRepository()
    : new MemoryRawIngestRepository();
  const candidateRepo = args.persist
    ? new SupabaseEventCandidateRepository()
    : new MemoryEventCandidateRepository();
  const catalogRepo = args.persist
    ? new SupabaseCatalogRepository()
    : new MemoryCatalogRepository();

  console.log('\nStarting venue ingestion pipeline...\n');

  try {
    const result = await runVenueIngestion({
      config,
      adapter,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      useFixture: args.useFixture,
      fixturePath: args.fixturePath,
      persist: args.persist,
      reprocess: args.reprocess,
    });

    console.log('='.repeat(70));
    console.log('  INGESTION SUMMARY REPORT');
    console.log('='.repeat(70));
    console.log(`Source Name:                ${result.source.name}`);
    console.log(`Source Slug:                ${result.source.slug}`);
    console.log(`Raw Ingests Fetched:        ${result.rawIngestsFetched}`);
    console.log(`Raw Ingests Persisted:      ${result.rawIngestsPersisted}`);
    console.log(`Raw Ingests Reused:         ${result.rawIngestsReused}`);
    console.log(`Candidates Parsed:          ${result.candidatesParsed}`);
    console.log(`Candidates Persisted:       ${result.candidatesPersisted}`);
    console.log(`Candidates Reused:          ${result.candidatesReused}`);
    console.log(`Canonical Events Created:   ${result.canonicalEventsCreated}`);
    console.log(`Canonical Events Matched:   ${result.canonicalEventsMatched}`);
    console.log(`Candidates Needs Review:    ${result.candidatesNeedsReview}`);
    console.log(`Candidates Rejected:        ${result.candidatesRejected}`);
    console.log(
      `Execution Duration:         ${(result.durationMs / 1000).toFixed(2)}s`,
    );
    console.log('='.repeat(70));

    if (Object.keys(result.reviewReasons).length > 0) {
      console.log('\nCandidates Routed to Review:');
      for (const [reason, count] of Object.entries(result.reviewReasons)) {
        console.log(`  - ${reason}: ${count}`);
      }
    }

    if (result.candidates.length > 0) {
      console.log('\nSample Parsed Concerts (First 3):');
      for (const [idx, c] of result.candidates.slice(0, 3).entries()) {
        console.log(`\n  [${idx + 1}] ${c.title}`);
        console.log(`      Venue:    ${c.venueName} (${c.city}, ${c.state})`);
        console.log(
          `      Date:     ${c.localStartDate} (Precision: ${c.startTimePrecision})`,
        );
        console.log(`      Starts:   ${c.startsAt || 'TBA'}`);
        console.log(
          `      Artists:  ${c.artists?.map((a) => `${a.name} [${a.billingPosition}]`).join(', ')}`,
        );
        console.log(`      Ticket:   ${c.ticketUrl || 'None'}`);
      }
    }

    console.log('\nVenue ingestion pipeline finished successfully.\n');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nPipeline execution failed: ${message}`);
    process.exit(1);
  }
}

main();
