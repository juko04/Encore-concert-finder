#!/usr/bin/env node

/**
 * Market price sync (SeatGeek Platform API, price-only). Plan:
 * docs/phases/active/MARKET_PRICES_PLAN.md.
 *
 * Usage:
 *   # Dry run (default): fetch, match and print the coverage report. No database writes.
 *   npm run sync:market-prices -- --states=CO
 *
 *   # Exercise the pipeline without a key, using the recorded fixture page:
 *   npm run sync:market-prices -- --states=CO --fixture
 *
 *   # Append observations (local database only unless --allow-production-write):
 *   npm run sync:market-prices -- --states=CO --write
 *
 * Options: --days=90 (horizon), --max-pages=10 (per state), --max-requests=60,
 *          --report=path.json (also save the report).
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadEnvLocal } from '@/lib/utils/load-env-local';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseSourceRepository } from '@/lib/repositories/source-repository';
import {
  SEATGEEK_DEFAULT_SOURCE_ID,
  SeatGeekClient,
  ensureSeatGeekSource,
  redactSeatGeekSecrets,
  runMarketPriceSync,
  type MarketPriceSyncReport,
  type SeatGeekPageFetcher,
} from '@/lib/sources/seatgeek';
import { SupabaseMarketPriceStore } from '@/lib/sources/seatgeek/store';

const FIXTURE = path.resolve(
  __dirname,
  '../tests/fixtures/seatgeek/events-page.json',
);

interface Args {
  states: string[];
  days: number;
  maxPages: number;
  maxRequests: number;
  write: boolean;
  fixture: boolean;
  allowProductionWrite: boolean;
  reportPath: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    states: [],
    days: 90,
    maxPages: 10,
    maxRequests: 60,
    write: false,
    fixture: false,
    allowProductionWrite: false,
    reportPath: null,
  };
  for (const arg of argv) {
    const [key, value = ''] = arg.split('=');
    if (key === '--states') {
      args.states = value
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else if (key === '--days')
      args.days = Math.max(1, parseInt(value, 10) || 90);
    else if (key === '--max-pages')
      args.maxPages = Math.max(1, parseInt(value, 10) || 10);
    else if (key === '--max-requests') {
      args.maxRequests = Math.max(1, parseInt(value, 10) || 60);
    } else if (key === '--write') args.write = true;
    else if (key === '--fixture') args.fixture = true;
    else if (key === '--allow-production-write')
      args.allowProductionWrite = true;
    else if (key === '--report') args.reportPath = value || null;
    else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return args;
}

/** Serves the recorded page as page 1 of every state, then an empty page. */
function fixtureFetcher(): SeatGeekPageFetcher {
  const body = fs.readFileSync(FIXTURE, 'utf-8');
  const empty = JSON.stringify({
    events: [],
    meta: { total: 0, page: 2, per_page: 100 },
  });
  return {
    async fetchEventsPage(query) {
      return {
        sourceUrl: `fixture://seatgeek/events?venue.state=${query.stateCode}&page=${query.page}`,
        status: 200,
        body: query.page === 1 ? body : empty,
      };
    },
  };
}

function printReport(report: MarketPriceSyncReport): void {
  const line = (label: string, value: unknown) =>
    console.log(`${label.padEnd(30)} ${value}`);
  console.log(
    '\n================ MARKET PRICE SYNC (SeatGeek) ================',
  );
  line(
    'Mode',
    report.mode === 'write' ? 'WRITE' : 'DRY RUN (no database writes)',
  );
  line(
    'Status',
    report.status + (report.stoppedReason ? ` (${report.stoppedReason})` : ''),
  );
  line('States', report.states.join(', '));
  line('Window', `${report.window.fromDate} to ${report.window.toDate}`);
  line('Pages fetched', report.pagesFetched);
  line('Listings fetched', report.listingsFetched);
  line('Invalid listings', report.invalidListings);
  line('Matched events', report.matched);
  line('  by method', JSON.stringify(report.matchedByMethod));
  line('Skipped', JSON.stringify(report.skipped));
  line('Unmatched', JSON.stringify(report.unmatched));
  line('Ambiguous', JSON.stringify(report.ambiguous));
  line('Observations inserted', report.observationsInserted);
  const c = report.coverage;
  console.log('\n---------------- Coverage of unpriced shows ----------------');
  line('Upcoming unpriced shows', c.upcomingUnpriced);
  line('Gained a market price', `${c.unpricedGained} (${c.percent}%)`);
  line(
    'Festivals unpriced / gained',
    `${c.festivalsUnpriced} / ${c.festivalsGained}`,
  );
  line('Priced shows also on SeatGeek', c.pricedEventsWithMarketPrice);
  console.log('\nVenues with the most unpriced shows (gained / unpriced):');
  for (const v of c.topVenues) {
    console.log(`  ${v.venueName.padEnd(40)} ${v.gained} / ${v.unpriced}`);
  }
  if (report.samples.unmatched.length > 0) {
    console.log('\nUnmatched samples:');
    for (const s of report.samples.unmatched.slice(0, 10)) {
      console.log(`  [${s.reason}] ${s.date ?? 'TBD'} ${s.title} @ ${s.venue}`);
    }
  }
  console.log(
    '==============================================================\n',
  );
}

async function main(): Promise<void> {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));
  if (args.states.length === 0) {
    throw new Error(
      'Pass the states to sync, e.g. --states=CO (no default region).',
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  if (!supabaseUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.',
    );
  }
  if (args.write) {
    if (args.fixture) {
      throw new Error(
        '--fixture is for dry runs only; fixture prices are never written.',
      );
    }
    assertSafeDatabaseTarget(
      supabaseUrl,
      args.allowProductionWrite,
      'Market price sync',
    );
  }

  let fetcher: SeatGeekPageFetcher;
  if (args.fixture) {
    fetcher = fixtureFetcher();
  } else {
    const clientId = process.env.SEATGEEK_CLIENT_ID;
    if (!clientId) {
      throw new Error(
        'SEATGEEK_CLIENT_ID is not set. Add it to .env.local, or use --fixture for a dry run.',
      );
    }
    fetcher = new SeatGeekClient({ clientId, maxRequests: args.maxRequests });
  }

  const sourceId = args.write
    ? (await ensureSeatGeekSource(new SupabaseSourceRepository())).id
    : SEATGEEK_DEFAULT_SOURCE_ID;

  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + args.days);

  const report = await runMarketPriceSync({
    fetcher,
    store: new SupabaseMarketPriceStore(),
    sourceId,
    states: args.states,
    fromDate: today,
    toDate: end.toISOString().slice(0, 10),
    maxPagesPerState: args.maxPages,
    write: args.write,
  });
  printReport(report);
  if (args.reportPath) {
    fs.writeFileSync(args.reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Report saved to ${args.reportPath}`);
  }
  if (report.status === 'auth_failed') process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error(`\nERROR: ${redactSeatGeekSecrets((err as Error).message)}\n`);
  process.exit(1);
});
