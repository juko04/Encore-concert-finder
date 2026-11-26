#!/usr/bin/env node
/**
 * Benchmark for the exact full-catalog radius scan (lib/location/near-search.ts).
 *
 *   npx tsx scripts/bench-near-search.ts            # in-memory + read-only local DB timing
 *   npx tsx scripts/bench-near-search.ts --no-db    # in-memory only
 *   npx tsx scripts/bench-near-search.ts --seed-real 5000,20000,50000
 *       # ALSO writes that many reserved-id "(Synthetic Test)" events to the LOCAL database,
 *       # times the real scan at each total, then deletes exactly those ids (never a broad delete)
 *
 * server-only is imported by the repository, so run with NODE_OPTIONS=--conditions=react-server.
 *
 * Part A (in-memory): N synthetic events (city table + unknown cities) served by an in-memory
 *   repository in 500-row batches; measures the CPU cost of the radius filter + merge, i.e. the
 *   scan minus the database.
 * Part B/C also time the LIGHT scan used in production (ids + location columns only for the whole
 *   catalog, then hydration of just the first page) next to the legacy full-hydration walk, so
 *   one run reports before and after under identical conditions.
 * Part B (real DB, READ ONLY): times the real scan against the local Supabase catalog through
 *   SupabaseCatalogRepository (the same code path as /search and /api/catalog/search). It only
 *   reads; it never writes. The local catalog is small, so the per-batch cost is reported and
 *   larger volumes are EXTRAPOLATED (labelled as such), not measured.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { searchCatalogPage } from '@/lib/location/catalog-search';
import {
  listAllEventsWithinRadius,
  NEAR_BATCH_SIZE,
  type NearListRepository,
} from '@/lib/location/near-search';
import { CITIES } from '@/lib/location/cities';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { EventListFilters } from '@/lib/repositories/interfaces';
import { loadEnvLocal } from '@/lib/utils/load-env-local';

const HOME = { lat: 39.7392, lng: -104.9903 };
const RADIUS = 25;

const BENCH_VENUE_ID = '5ea4c4b0-0000-4000-8000-000000000001';
const BENCH_EVENT_PREFIX = '5ea4c4b0-0000-4000-8001-';
const hex12 = (n: number) => n.toString(16).padStart(12, '0');

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function syntheticCatalog(n: number): CanonicalEventSummary[] {
  const out: CanonicalEventSummary[] = [];
  for (let i = 0; i < n; i++) {
    const r = i % 20;
    let city: string | null;
    let region: string | null = null;
    let lat: number | null = null;
    let lng: number | null = null;
    if (r === 0) {
      city = 'Unlisted Town ' + (i % 97); // not in the city table: unknown location
      region = 'ZZ';
    } else if (r === 1) {
      city = 'Elsewhere';
      lat = 39.7 + (i % 10) * 0.01; // venue coordinate near home
      lng = -105.0;
    } else {
      const c = CITIES[i % CITIES.length];
      city = c.name;
      region = c.state;
    }
    out.push({
      id: `bench-${String(i).padStart(7, '0')}`,
      city,
      region,
      lat,
      lng,
    } as unknown as CanonicalEventSummary);
  }
  return out;
}

function memoryRepo(all: CanonicalEventSummary[]): NearListRepository {
  return {
    async listEvents(f?: EventListFilters) {
      const o = f?.offset ?? 0;
      return all.slice(o, o + (f?.limit ?? all.length));
    },
  };
}

type Admin = SupabaseClient;

async function deleteBenchRows(admin: Admin, upTo: number) {
  for (let i = 1; i <= upTo; i += 100) {
    const ids: string[] = [];
    for (let k = i; k < i + 100 && k <= upTo; k++)
      ids.push(`${BENCH_EVENT_PREFIX}${hex12(k)}`);
    const { error } = await admin.from('events').delete().in('id', ids);
    if (error) throw new Error(`bench cleanup: ${error.message}`);
  }
  const { error } = await admin
    .from('venues')
    .delete()
    .eq('id', BENCH_VENUE_ID);
  if (error) throw new Error(`bench cleanup venue: ${error.message}`);
}

async function seedBenchRows(admin: Admin, from: number, to: number) {
  for (let i = from; i <= to; i += 1000) {
    const rows: Array<Record<string, unknown>> = [];
    for (let n = i; n < i + 1000 && n <= to; n++) {
      const c = CITIES[n % CITIES.length];
      const date = new Date(Date.now() + (10 + (n % 300)) * 86400000)
        .toISOString()
        .slice(0, 10);
      const name = `Bench Show ${n} (Synthetic Test)`;
      rows.push({
        id: `${BENCH_EVENT_PREFIX}${hex12(n)}`,
        name,
        normalized_name: name.toLowerCase(),
        event_kind: 'concert',
        status: 'scheduled',
        venue_id: BENCH_VENUE_ID,
        city: c.name,
        region: c.state,
        country_code: 'US',
        timezone: 'America/Denver',
        local_start_date: date,
        starts_at: `${date}T20:00:00-06:00`,
        start_time_precision: 'instant',
        min_price: n % 9 === 0 ? null : 10 + (n % 90),
      });
    }
    const { error } = await admin.from('events').insert(rows);
    if (error) throw new Error(`bench seed: ${error.message}`);
  }
}

async function timeScan(
  repo: SupabaseCatalogRepository,
  filters: EventListFilters,
  concurrency: number,
  runs: number,
) {
  const times: number[] = [];
  let matches = 0;
  for (let run = 0; run < runs; run++) {
    const t0 = performance.now();
    const res = await listAllEventsWithinRadius(
      repo,
      filters,
      HOME,
      RADIUS,
      NEAR_BATCH_SIZE,
      Infinity,
      concurrency,
    );
    times.push(performance.now() - t0);
    matches = res.length;
  }
  return { ms: median(times), matches };
}

/** Cold first request as served today: light scan of every match + hydrate page 1 (no cache). */
async function timeLight(
  repo: SupabaseCatalogRepository,
  filters: EventListFilters,
  runs: number,
) {
  const times: number[] = [];
  let matches = 0;
  for (let run = 0; run < runs; run++) {
    const t0 = performance.now();
    const page = await searchCatalogPage(
      repo,
      { ...filters, limit: 50, offset: 0 },
      { home: HOME, radiusMiles: RADIUS },
      { cacheTtlMs: 0 },
    );
    times.push(performance.now() - t0);
    matches = page.totalCount;
  }
  return { ms: median(times), matches };
}

async function main() {
  const skipDb = process.argv.includes('--no-db');
  console.log(
    `Radius scan benchmark (home=Denver test point, radius=${RADIUS} mi, batch=${NEAR_BATCH_SIZE}, node ${process.version})`,
  );

  console.log('\nPart A: in-memory (filter + merge only, no database)');
  console.log('events | batches | matches | median ms (5 runs)');
  for (const n of [1_000, 5_000, 20_000, 50_000, 100_000]) {
    const all = syntheticCatalog(n);
    const repo = memoryRepo(all);
    const times: number[] = [];
    let matches = 0;
    for (let run = 0; run < 5; run++) {
      const t0 = performance.now();
      const res = await listAllEventsWithinRadius(repo, {}, HOME, RADIUS);
      times.push(performance.now() - t0);
      matches = res.length;
    }
    console.log(
      `${String(n).padStart(6)} | ${String(Math.ceil(n / NEAR_BATCH_SIZE)).padStart(7)} | ${String(matches).padStart(7)} | ${median(times).toFixed(1)}`,
    );
  }

  if (skipDb) return;
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.log('\nPart B skipped: Supabase env not configured.');
    return;
  }
  assertSafeDatabaseTarget(url, false, 'bench-near-search');
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const repo = new SupabaseCatalogRepository(client);
  const today = new Date().toISOString().slice(0, 10);
  const filters: EventListFilters = { fromDate: today, sortBy: 'date_asc' };

  const total = await repo.countEvents(filters);
  console.log(
    `\nPart B: real local DB, READ ONLY. Upcoming catalog size: ${total} events`,
  );
  console.log(
    'concurrency | batches | matches | median ms (3 runs) | ms/batch',
  );
  for (const concurrency of [1, 4]) {
    const times: number[] = [];
    let matches = 0;
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      const res = await listAllEventsWithinRadius(
        repo,
        filters,
        HOME,
        RADIUS,
        NEAR_BATCH_SIZE,
        Infinity,
        concurrency,
      );
      times.push(performance.now() - t0);
      matches = res.length;
    }
    const batches = Math.max(1, Math.ceil(total / NEAR_BATCH_SIZE));
    const m = median(times);
    console.log(
      `${String(concurrency).padStart(11)} | ${String(batches).padStart(7)} | ${String(matches).padStart(7)} | ${m.toFixed(0).padStart(18)} | ${(m / batches).toFixed(0)}`,
    );
    if (concurrency === 1) {
      console.log('  extrapolated from ms/batch (NOT measured):');
      for (const n of [5_000, 20_000, 50_000]) {
        const b = Math.ceil(n / NEAR_BATCH_SIZE);
        console.log(
          `    ${n} events -> ~${(((m / batches) * b) / 1000).toFixed(1)} s`,
        );
      }
    }
  }

  const light = await timeLight(repo, filters, 3);
  console.log(
    `  light scan + first page (production path): ${light.matches} matches, median ${light.ms.toFixed(0)} ms`,
  );

  const seedArg = process.argv.indexOf('--seed-real');
  if (seedArg === -1) return;
  const stages = (process.argv[seedArg + 1] ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || stages.length === 0) {
    console.log(
      '\n--seed-real needs SUPABASE_SERVICE_ROLE_KEY and a size list.',
    );
    return;
  }
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  console.log(
    '\nPart C: real DB with reserved-id synthetic rows ADDED on top of the real catalog',
  );
  console.log(
    'seeded | catalog total | path                     | matches | cold first request ms (median of 3)',
  );
  const max = stages[stages.length - 1];
  try {
    await deleteBenchRows(admin, max).catch(() => undefined); // leftovers of an aborted run
    const { error } = await admin.from('venues').insert({
      id: BENCH_VENUE_ID,
      name: 'Bench Venue (Synthetic Test)',
      normalized_name: 'bench venue synthetic test',
      city: 'Denver',
      region: 'CO',
      country_code: 'US',
      timezone: 'America/Denver',
    });
    if (error) throw new Error(`bench venue: ${error.message}`);
    let seeded = 0;
    for (const target of stages) {
      await seedBenchRows(admin, seeded + 1, target);
      seeded = target;
      const catalogTotal = await repo.countEvents(filters);
      for (const concurrency of [1, 4]) {
        const r = await timeScan(repo, filters, concurrency, 3);
        console.log(
          `${String(seeded).padStart(6)} | ${String(catalogTotal).padStart(13)} | legacy full scan, conc ${concurrency} | ${String(r.matches).padStart(7)} | ${r.ms.toFixed(0)}`,
        );
      }
      const l = await timeLight(repo, filters, 3);
      console.log(
        `${String(seeded).padStart(6)} | ${String(catalogTotal).padStart(13)} | light scan + page 1      | ${String(l.matches).padStart(7)} | ${l.ms.toFixed(0)}`,
      );
    }
  } finally {
    await deleteBenchRows(admin, max);
    console.log('bench rows removed (exact reserved ids only).');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
