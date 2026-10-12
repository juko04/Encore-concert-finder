#!/usr/bin/env node

/**
 * Controlled CLI Ingestion Runner for Ticketmaster Discovery API (Phase 2, PR 2).
 * Usage:
 *   # Safe dry-run preview (default, zero database writes):
 *   npm run ingest:ticketmaster -- --fixture
 *   npm run ingest:ticketmaster -- [--state=CO] [--size=20] [--keyword=rock]
 *
 *   # Explicit database persistence mode:
 *   npm run ingest:ticketmaster -- --fixture --persist
 *   npm run ingest:ticketmaster -- --persist --size=5
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  TicketmasterDiscoveryAdapter,
  redactSensitiveString,
  runTicketmasterIngestion,
  type TicketmasterEventQueryParams,
} from '@/lib/sources/ticketmaster';
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

interface ParsedArgs {
  useFixture: boolean;
  persist: boolean;
  allowProductionWrite: boolean;
  stateCode: string;
  size: number;
  page: number;
  keyword?: string;
  marketId?: string;
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

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    useFixture: false,
    persist: false,
    allowProductionWrite: false,
    stateCode: 'CO',
    size: 20,
    page: 0,
  };

  for (const arg of args) {
    if (arg === '--fixture') {
      result.useFixture = true;
    } else if (arg === '--persist') {
      result.persist = true;
    } else if (arg === '--allow-production-write') {
      result.allowProductionWrite = true;
    } else if (arg.startsWith('--state=')) {
      result.stateCode = arg.split('=')[1].toUpperCase();
    } else if (arg.startsWith('--size=')) {
      result.size = parseInt(arg.split('=')[1], 10) || 20;
    } else if (arg.startsWith('--page=')) {
      result.page = parseInt(arg.split('=')[1], 10) || 0;
    } else if (arg.startsWith('--keyword=')) {
      result.keyword = arg.split('=')[1];
    } else if (arg.startsWith('--marketId=')) {
      result.marketId = arg.split('=')[1];
    }
  }

  return result;
}

async function run(): Promise<void> {
  loadEnvLocal();
  const options = parseArgs(process.argv.slice(2));

  console.log('\n============================================================');
  console.log('       ENCORE — TICKETMASTER INGESTION RUNNER (PR 2)');
  console.log('============================================================');
  console.log(
    `Mode:            ${options.persist ? 'DATABASE PERSISTENCE (Atomic Write)' : 'DRY-RUN (Safe Read-Only In-Memory Preview)'}`,
  );
  console.log(
    `Source:          ${options.useFixture ? 'Local Fixture (Deterministic)' : 'Live Ticketmaster Discovery API'}`,
  );
  console.log(`Target State:    ${options.stateCode}`);
  console.log(`Page Size:       ${options.size}`);
  console.log(`Page Number:     ${options.page}`);
  if (options.keyword) console.log(`Keyword:         ${options.keyword}`);
  console.log('------------------------------------------------------------\n');

  const apiKey = process.env.TICKETMASTER_API_KEY;

  if (!options.useFixture && !apiKey) {
    console.error(
      'Notice: TICKETMASTER_API_KEY environment variable is not set.\n' +
        'To test the ingestion runner without live credentials, run with --fixture:\n\n' +
        '  npm run ingest:ticketmaster -- --fixture\n\n' +
        'Or export TICKETMASTER_API_KEY to fetch live events from Ticketmaster.\n',
    );
    process.exit(1);
  }

  // Safety checks for database persistence mode
  if (options.persist) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(
        'ERROR: Database Persistence Requested (--persist) but Supabase credentials are missing.\n' +
          'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in environment or .env.local.\n' +
          'To test without database writes, omit --persist for dry-run preview.\n',
      );
      process.exit(1);
    }

    const isLocalOrDev =
      supabaseUrl.includes('127.0.0.1') ||
      supabaseUrl.includes('localhost') ||
      supabaseUrl.includes('.dev') ||
      supabaseUrl.includes('local');

    if (!isLocalOrDev && !options.allowProductionWrite) {
      console.error(
        'ERROR: Production Persistence Guard Active.\n' +
          `Target database (${supabaseUrl}) is not a recognized local or development instance.\n` +
          'Writing to production requires the explicit safety flag: --allow-production-write.\n' +
          'Aborting execution to prevent unauthorized modifications.\n',
      );
      process.exit(1);
    }
  }

  const adapter = new TicketmasterDiscoveryAdapter({
    apiKey: apiKey || 'fixture-test-key',
  });

  const queryParams: TicketmasterEventQueryParams = {
    stateCode: options.stateCode,
    size: options.size,
    page: options.page,
    classificationName: 'Music',
    keyword: options.keyword,
    marketId: options.marketId,
    sort: 'date,asc',
  };

  try {
    let result;

    if (options.persist) {
      console.log('Initializing PostgreSQL database repositories...');
      const sourceRepo = new SupabaseSourceRepository();
      const rawIngestRepo = new SupabaseRawIngestRepository();
      const candidateRepo = new SupabaseEventCandidateRepository();
      const catalogRepo = new SupabaseCatalogRepository();

      result = await runTicketmasterIngestion({
        sourceRepo,
        rawIngestRepo,
        candidateRepo,
        catalogRepo,
        adapter,
        queryParams,
        useFixture: options.useFixture,
        persist: true,
      });
    } else {
      console.log('Executing safe dry-run preview with in-memory pipeline...');
      const sourceRepo = new MemorySourceRepository();
      const rawIngestRepo = new MemoryRawIngestRepository();
      const candidateRepo = new MemoryEventCandidateRepository();
      const catalogRepo = new MemoryCatalogRepository();

      result = await runTicketmasterIngestion({
        sourceRepo,
        rawIngestRepo,
        candidateRepo,
        catalogRepo,
        adapter,
        queryParams,
        useFixture: options.useFixture,
        persist: false,
      });
    }

    console.log(`✓ Source: ${result.source.name} (id: ${result.source.id})`);
    console.log(`✓ Fetched ${result.rawIngestsFetched} raw page snapshot(s).`);
    console.log(`✓ Parsed ${result.candidatesParsed} event candidate(s).\n`);

    if (result.candidates.length === 0) {
      console.log('No music events found matching the specified criteria.');
      return;
    }

    console.log('Candidate Observations Preview:');
    console.log(
      '--------------------------------------------------------------------------------',
    );

    result.candidates.forEach((cand, idx) => {
      const headliner =
        cand.artists?.find((a) => a.billingPosition === 'headliner')?.name ||
        cand.artistNames[0] ||
        'N/A';
      const support = cand.artists
        ?.filter((a) => a.billingPosition === 'support')
        .map((a) => a.name)
        .join(', ');
      const location = [cand.venueName, cand.city, cand.state]
        .filter(Boolean)
        .join(', ');
      const timeStr =
        cand.startTimePrecision === 'instant'
          ? cand.startsAt
          : 'Date confirmed (Time TBA)';
      const priceStr = cand.price
        ? `$${cand.price.min} – $${cand.price.max} ${cand.price.currency ?? 'USD'}`
        : 'Price TBA';

      console.log(
        `[${idx + 1}] ${cand.title}\n` +
          `    Headliner:    ${headliner}\n` +
          (support ? `    Support:      ${support}\n` : '') +
          `    Venue:        ${location}\n` +
          `    Date/Time:    ${cand.localStartDate} | ${timeStr}\n` +
          `    Price:        ${priceStr}\n` +
          `    Kind:         ${cand.eventKind}\n` +
          `    Ticket URL:   ${cand.ticketUrl || 'N/A'}\n`,
      );
    });

    console.log(
      '================================================================================',
    );
    console.log('INGESTION TELEMETRY REPORT:');
    console.log(
      '================================================================================',
    );
    console.log(`  Raw Ingests Fetched:        ${result.rawIngestsFetched}`);
    console.log(`  Raw Ingests Persisted:      ${result.rawIngestsPersisted}`);
    console.log(`  Raw Ingests Reused:         ${result.rawIngestsReused}`);
    console.log(`  Candidates Parsed:          ${result.candidatesParsed}`);
    console.log(`  Candidates Persisted:       ${result.candidatesPersisted}`);
    console.log(
      `  Canonical Events Created:   ${result.canonicalEventsCreated}`,
    );
    console.log(
      `  Canonical Events Matched:   ${result.canonicalEventsMatched}`,
    );
    console.log(
      `  Candidates Needs Review:    ${result.candidatesNeedsReview}`,
    );

    if (Object.keys(result.reviewReasons).length > 0) {
      console.log('    Review Reasons Breakdown:');
      for (const [reason, count] of Object.entries(result.reviewReasons)) {
        console.log(`      - ${reason}: ${count}`);
      }
    }

    console.log(`  Candidates Rejected:        ${result.candidatesRejected}`);
    console.log(`  Database Errors:            0`);
    console.log(
      '================================================================================\n',
    );

    if (options.persist) {
      console.log(
        '✓ PERSISTENCE COMPLETE: Events and provenance atomically committed to database.',
      );
      console.log(
        `Persisted canonical event IDs (${result.persistedEventIds.length}):\n` +
          result.persistedEventIds.map((id) => `  - ${id}`).join('\n') +
          '\n',
      );
    } else {
      console.log(
        '✓ DRY-RUN COMPLETE: Zero database rows were modified (Safe Read-Only Preview).',
      );
      console.log(
        'To persist these records into local database, re-run with --persist:\n' +
          '  npm run ingest:ticketmaster -- --fixture --persist\n',
      );
    }
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    console.error(`\nIngestion failed: ${redactSensitiveString(rawMsg)}\n`);
    process.exit(1);
  }
}

run();
