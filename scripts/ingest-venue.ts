#!/usr/bin/env node

/**
 * Controlled CLI Ingestion Runner for Official Venue Websites (Phase 3, PR #13 & PR #14).
 *
 * Supported Venues:
 *   - cervantes (Cervantes' Masterpiece Ballroom)
 *   - larimer (Larimer Lounge)
 *   - lostlake (Lost Lake Lounge)
 *   - globehall (Globe Hall)
 *   - all-denver (runs Larimer Lounge, Lost Lake Lounge, and Globe Hall)
 *   - all (runs all 4 Denver venues)
 *
 * Usage:
 *   # Safe dry-run preview from fixture (default, zero network, zero database writes):
 *   npm run ingest:venue -- --venue=larimer --fixture
 *
 *   # Safe dry-run preview from live venue website:
 *   npm run ingest:venue -- --venue=larimer --live
 *
 *   # Safe dry-run of all three Denver independent venues:
 *   npm run ingest:venue -- --venue=all-denver --fixture
 *
 *   # Explicit database persistence mode from live website:
 *   npm run ingest:venue -- --venue=globehall --live --persist
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  CervantesVenueAdapter,
  IndependentVenueAdapter,
  runVenueIngestion,
  CERVANTES_CONFIG,
  DENVER_INDEPENDENT_VENUE_CONFIGS,
  ALL_SUPPORTED_VENUE_CONFIGS,
  getVenueSourceConfig,
  type VenueSourceConfig,
  type VenueIngestionResult,
} from '@/lib/sources/venue';
import type { EventSourceAdapter } from '@/lib/domain/source';
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

function printSummaryReport(result: VenueIngestionResult): void {
  console.log('='.repeat(70));
  console.log(
    `  INGESTION SUMMARY REPORT: ${result.source.name.toUpperCase()}`,
  );
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
}

async function main(): Promise<void> {
  loadEnvLocal();
  const args = parseCliArgs(process.argv);

  console.log('='.repeat(70));
  console.log('  ENCORE — PHASE 3 VENUE INGESTION RUNNER (PR #13 & PR #14)');
  console.log('='.repeat(70));
  console.log(`Venue Argument: ${args.venue}`);
  console.log(
    `Mode:           ${args.persist ? 'PERSIST (Database Writes Enabled)' : 'DRY RUN (Preview Only)'}`,
  );
  console.log(
    `Source:         ${args.useFixture ? 'Local Static Fixture' : 'Live Official Venue Website'}`,
  );
  console.log(`Reprocess:      ${args.reprocess ? 'YES' : 'NO'}`);
  console.log('='.repeat(70));

  if (args.persist) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    assertSafeDatabaseTarget(
      supabaseUrl,
      args.allowProductionWrite,
      'Venue Ingestion CLI Runner',
    );
  }

  // Determine list of venue configs to process
  let targetConfigs: VenueSourceConfig[] = [];

  if (
    args.venue === 'all-denver' ||
    args.venue === 'all-ivg' ||
    args.venue === 'ivg'
  ) {
    targetConfigs = [...DENVER_INDEPENDENT_VENUE_CONFIGS];
  } else if (args.venue === 'all') {
    targetConfigs = [...ALL_SUPPORTED_VENUE_CONFIGS];
  } else {
    const matched = getVenueSourceConfig(args.venue);
    if (!matched) {
      console.error(
        `Unknown venue: "${args.venue}". Supported venue options:\n` +
          '  - cervantes\n' +
          '  - larimer (or larimer-lounge)\n' +
          '  - lostlake (or lost-lake-lounge)\n' +
          '  - globehall (or globe-hall)\n' +
          '  - all-denver (runs Larimer Lounge, Lost Lake, Globe Hall)\n' +
          '  - all (runs all 4 Denver venues)',
      );
      process.exit(1);
    }
    targetConfigs = [matched];
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

  console.log(
    `\nStarting ingestion for ${targetConfigs.length} venue(s): ${targetConfigs.map((c) => c.name).join(', ')}...\n`,
  );

  const results: VenueIngestionResult[] = [];

  for (const config of targetConfigs) {
    const adapter: EventSourceAdapter =
      config.slug === CERVANTES_CONFIG.slug
        ? new CervantesVenueAdapter()
        : new IndependentVenueAdapter(config);

    try {
      console.log(`\n>>> Processing ${config.name} (${config.slug})...`);
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

      results.push(result);
      printSummaryReport(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `\nPipeline execution failed for ${config.name}: ${message}`,
      );
      if (targetConfigs.length === 1) {
        process.exit(1);
      }
    }
  }

  // If multiple venues were ingested, print consolidated summary
  if (results.length > 1) {
    console.log('\n' + '='.repeat(70));
    console.log('  CONSOLIDATED MULTI-VENUE INGESTION SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total Venues Processed:     ${results.length}`);
    console.log(
      `Total Raw Ingests Fetched:  ${results.reduce((s, r) => s + r.rawIngestsFetched, 0)}`,
    );
    console.log(
      `Total Candidates Parsed:    ${results.reduce((s, r) => s + r.candidatesParsed, 0)}`,
    );
    console.log(
      `Canonical Events Created:   ${results.reduce((s, r) => s + r.canonicalEventsCreated, 0)}`,
    );
    console.log(
      `Canonical Events Matched:   ${results.reduce((s, r) => s + r.canonicalEventsMatched, 0)}`,
    );
    console.log(
      `Candidates Needs Review:    ${results.reduce((s, r) => s + r.candidatesNeedsReview, 0)}`,
    );
    console.log(
      `Candidates Rejected:        ${results.reduce((s, r) => s + r.candidatesRejected, 0)}`,
    );
    const totalDuration = results.reduce((s, r) => s + r.durationMs, 0);
    console.log(
      `Total Execution Duration:   ${(totalDuration / 1000).toFixed(2)}s`,
    );
    console.log('='.repeat(70));
  }

  console.log('\nVenue ingestion CLI completed successfully.\n');
}

main();
