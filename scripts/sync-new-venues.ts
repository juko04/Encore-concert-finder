#!/usr/bin/env node

/**
 * Runs ONLY the extra Colorado venue adapters (Mishawaka Amphitheatre, Bohemian Live Music:
 * Washington's + The Armory, 10 Mile Music Hall) through the standard venue pipeline.
 * The same targets are included in `npm run sync:all`; this runner exists to refresh just these
 * sources without touching Ticketmaster or the other venues.
 *
 * Usage:
 *   npm run sync:new-venues -- --fixture                 # fixtures, no network, no DB writes
 *   npm run sync:new-venues -- --live                    # live dry run (no DB writes)
 *   npm run sync:new-venues -- --live --persist          # persist to the LOCAL database
 *   npm run sync:new-venues -- --live --only=10-mile-music-hall
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  EXTRA_VENUE_SYNC_TARGETS,
  runVenueIngestion,
} from '@/lib/sources/venue';
import {
  MemoryCatalogRepository,
  MemoryEventCandidateRepository,
  MemoryRawIngestRepository,
  MemorySourceRepository,
} from '@/lib/repositories/memory-repositories';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { SupabaseEventCandidateRepository } from '@/lib/repositories/event-candidate-repository';
import { SupabaseRawIngestRepository } from '@/lib/repositories/raw-ingest-repository';
import { SupabaseSourceRepository } from '@/lib/repositories/source-repository';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const persist = args.includes('--persist');
  const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];

  if (persist && !live) {
    throw new Error('--persist requires --live (fixture runs never persist).');
  }
  if (persist) {
    // No production override on purpose: local databases only.
    assertSafeDatabaseTarget(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      false,
      'New Venue Sync Runner',
    );
  }

  const targets = EXTRA_VENUE_SYNC_TARGETS.filter(
    (t) => !only || t.config.slug === only,
  );
  if (targets.length === 0) {
    throw new Error(`No venue matches --only=${only}`);
  }

  const sourceRepo = persist
    ? new SupabaseSourceRepository()
    : new MemorySourceRepository();
  const rawIngestRepo = persist
    ? new SupabaseRawIngestRepository()
    : new MemoryRawIngestRepository();
  const candidateRepo = persist
    ? new SupabaseEventCandidateRepository()
    : new MemoryEventCandidateRepository();
  const catalogRepo = persist
    ? new SupabaseCatalogRepository()
    : new MemoryCatalogRepository();

  console.log(
    `Mode: ${live ? 'LIVE' : 'FIXTURE'} | Persist: ${persist} | Venues: ${targets.map((t) => t.config.slug).join(', ')}`,
  );

  let failed = false;
  for (const t of targets) {
    try {
      const r = await runVenueIngestion({
        config: t.config,
        adapter: t.adapterFactory(),
        sourceRepo,
        rawIngestRepo,
        candidateRepo,
        catalogRepo,
        persist,
        useFixture: !live,
        fixturePath: live ? undefined : path.resolve(process.cwd(), t.fixture),
      });
      console.log(
        `${t.config.name}: rawFetched=${r.rawIngestsFetched} candidates=${r.candidatesParsed} ` +
          `created=${r.canonicalEventsCreated} matched=${r.canonicalEventsMatched} ` +
          `needsReview=${r.candidatesNeedsReview} rejected=${r.candidatesRejected} ` +
          `skippedExisting=${r.candidatesSkipped} reasons=${JSON.stringify(r.reviewReasons)}`,
      );
    } catch (err) {
      failed = true;
      console.error(`${t.config.name}: FAILED`, err);
    }
    // Politeness between different hosts is already satisfied by separate origins.
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
