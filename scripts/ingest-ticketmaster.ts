#!/usr/bin/env node

/**
 * Controlled CLI Ingestion Runner for Ticketmaster Discovery API.
 * Usage:
 *   npm run ingest:ticketmaster -- [--dry-run] [--fixture] [--state=CO] [--size=20] [--keyword=rock]
 *
 * Defaults:
 *   --dry-run: true (does not write to database unless --persist is explicitly passed)
 *   --state: CO (configurable initial test region)
 *   --size: 20
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  TicketmasterDiscoveryAdapter,
  redactSensitiveString,
  type TicketmasterEventQueryParams,
} from '@/lib/sources/ticketmaster';
import type { RawIngest } from '@/lib/domain/source';

interface ParsedArgs {
  dryRun: boolean;
  useFixture: boolean;
  stateCode: string;
  size: number;
  page: number;
  keyword?: string;
  marketId?: string;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    dryRun: true,
    useFixture: false,
    stateCode: 'CO',
    size: 20,
    page: 0,
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--persist' || arg === '--no-dry-run') {
      result.dryRun = false;
    } else if (arg === '--fixture') {
      result.useFixture = true;
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
  const options = parseArgs(process.argv.slice(2));

  console.log('\n============================================================');
  console.log('       ENCORE — TICKETMASTER INGESTION RUNNER (PR 1)');
  console.log('============================================================');
  console.log(
    `Mode:            ${options.dryRun ? 'DRY-RUN (Safe Read-Only)' : 'PERSIST (Write to DB)'}`,
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
        '  npm run ingest:ticketmaster -- --dry-run --fixture\n\n' +
        'Or export TICKETMASTER_API_KEY to fetch live events from Ticketmaster.\n',
    );
    process.exit(1);
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
    let rawIngests: RawIngest[] = [];

    if (options.useFixture) {
      console.log('Loading deterministic Ticketmaster fixture...');
      const fixturePath = path.resolve(
        process.cwd(),
        'tests/fixtures/ticketmaster-events-response.json',
      );
      const rawJson = fs.readFileSync(fixturePath, 'utf-8');

      rawIngests = [
        {
          id: crypto.randomUUID(),
          sourceId: adapter.id,
          sourceUrl:
            'https://app.ticketmaster.com/discovery/v2/events.json?classificationName=Music&stateCode=' +
            options.stateCode,
          acquisitionMethod: 'api',
          fetchedAt: new Date().toISOString(),
          contentHash: 'fixture_deterministic_hash',
          contentType: 'application/json',
          rawContent: rawJson,
          httpStatus: 200,
          parserVersion: adapter.parserVersion,
        },
      ];
    } else {
      console.log(
        'Fetching live event pages from Ticketmaster Discovery API...',
      );
      rawIngests = await adapter.fetch({
        sourceId: adapter.id,
        sourceType: adapter.sourceType,
        acquisitionMethod: adapter.acquisitionMethod,
        targetUrl: 'https://app.ticketmaster.com/discovery/v2/events.json',
        crawlStartedAt: new Date().toISOString(),
        metadata: queryParams as Record<string, unknown>,
      });
    }

    const candidates = await adapter.parse(rawIngests);

    console.log(`✓ Loaded ${rawIngests.length} raw ingest page(s).`);
    console.log(`✓ Parsed ${candidates.length} candidate observation(s).\n`);

    if (candidates.length === 0) {
      console.log('No music events found matching the specified criteria.');
      return;
    }

    console.log('Candidate Observations Preview:');
    console.log(
      '--------------------------------------------------------------------------------',
    );

    candidates.forEach((cand, idx) => {
      const headliner =
        cand.artists?.find((a) => a.billingPosition === 'headliner')?.name ||
        cand.artistNames[0];
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
        ? `$${cand.price.min} – $${cand.price.max} ${cand.price.currency}`
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

    // Summary Telemetry
    const instantCount = candidates.filter(
      (c) => c.startTimePrecision === 'instant',
    ).length;
    const dateOnlyCount = candidates.filter(
      (c) => c.startTimePrecision === 'date_only',
    ).length;
    const multiActCount = candidates.filter(
      (c) => (c.artists?.length || 0) > 1,
    ).length;
    const festivalCount = candidates.filter((c) => c.isFestival).length;
    const missingCityCount = candidates.filter((c) => !c.city).length;

    console.log(
      '--------------------------------------------------------------------------------',
    );
    console.log('Ingestion Summary:');
    console.log(`  Total Candidates:      ${candidates.length}`);
    console.log(`  Instant Precision:     ${instantCount}`);
    console.log(`  Date-Only Precision:   ${dateOnlyCount}`);
    console.log(`  Multi-Act Bills:       ${multiActCount}`);
    console.log(`  Festivals / Multi-day: ${festivalCount}`);
    console.log(
      `  Missing Venue City:    ${missingCityCount} (will route to needs_review in PR 2)`,
    );
    console.log(
      '--------------------------------------------------------------------------------\n',
    );

    if (options.dryRun) {
      console.log('✓ DRY-RUN COMPLETE: Zero database rows were modified.');
      console.log(
        'To persist raw ingests and candidates, pass --persist with Supabase credentials.',
      );
    } else {
      console.log('Persisting to database...');
      const { createClient } = await import('@supabase/supabase-js');
      const { SupabaseRawIngestRepository } =
        await import('@/lib/repositories/raw-ingest-repository');
      const { SupabaseEventCandidateRepository } =
        await import('@/lib/repositories/event-candidate-repository');
      const { getServerEnv } = await import('@/lib/env/server');

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();

      if (!supabaseUrl || !SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error(
          'Supabase URL or service role key missing in environment. Cannot persist.',
        );
      }

      const client = createClient(supabaseUrl, SUPABASE_SERVICE_ROLE_KEY);
      const rawRepo = new SupabaseRawIngestRepository(client);
      const candRepo = new SupabaseEventCandidateRepository(client);

      for (const raw of rawIngests) {
        const persistedRaw = await rawRepo.create(raw);
        console.log(`✓ Persisted raw_ingests row: ${persistedRaw.id}`);

        const pageCandidates = candidates.filter(
          (c) => c.rawIngestId === raw.id,
        );
        const candidatesWithRawId = pageCandidates.map((c) => ({
          ...c,
          rawIngestId: persistedRaw.id,
          sourceId: raw.sourceId,
        }));

        const persistedCandidates =
          await candRepo.createMany(candidatesWithRawId);
        console.log(
          `✓ Persisted ${persistedCandidates.length} candidate rows.`,
        );
      }

      console.log(
        '\n✓ PERSISTENCE COMPLETE: Candidates saved to event_candidates table.',
      );
      console.log('Note: Canonicalization integration will execute in PR 2.\n');
    }
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    console.error(`\nIngestion failed: ${redactSensitiveString(rawMsg)}\n`);
    process.exit(1);
  }
}

run();
