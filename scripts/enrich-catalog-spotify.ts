#!/usr/bin/env node

/**
 * Spotify Catalog Enrichment Script
 *
 * Enriches canonical Encore artists from events in local Supabase
 * adhering to Invariant 5 (Conservative Entity Resolution) and Invariant 6 (Safe Database Target).
 *
 * Usage:
 *   # Safe preview run (dry-run, zero database writes):
 *   vite-node --config vitest.config.ts scripts/enrich-catalog-spotify.ts -- --dry-run
 *
 *   # Live enrichment run:
 *   vite-node --config vitest.config.ts scripts/enrich-catalog-spotify.ts
 *
 *   # Limited run (e.g. first 20 headliners):
 *   vite-node --config vitest.config.ts scripts/enrich-catalog-spotify.ts -- --limit=20
 *
 * Backfill genres for already-mapped artists (requires migration 20261124010000):
 *   vite-node --config vitest.config.ts scripts/enrich-catalog-spotify.ts -- --backfill-genres
 */

import fs from 'node:fs';
import path from 'node:path';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import {
  type ArtistEnrichmentResult,
  SpotifyCatalogEnricher,
} from '@/lib/entity-resolution/spotify-catalog-enricher';

interface ParsedArgs {
  dryRun: boolean;
  allowProductionWrite: boolean;
  limit?: number;
  region?: string;
  verbose: boolean;
  backfillGenres?: boolean;
}

function parseCliArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const parsed: ParsedArgs = {
    dryRun: false,
    allowProductionWrite: false,
    verbose: false,
    backfillGenres: false,
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--allow-production-write') {
      parsed.allowProductionWrite = true;
    } else if (arg === '--backfill-genres') {
      parsed.backfillGenres = true;
    } else if (arg === '--verbose') {
      parsed.verbose = true;
    } else if (arg.startsWith('--limit=')) {
      const val = parseInt(arg.split('=')[1], 10);
      if (!isNaN(val) && val > 0) {
        parsed.limit = val;
      }
    } else if (arg.startsWith('--region=')) {
      parsed.region = arg.split('=')[1].trim();
    }
  }

  return parsed;
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

export async function runSpotifyCatalogEnrichment(cliArgs?: ParsedArgs) {
  loadEnvLocal();

  const args = cliArgs ?? parseCliArgs();

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required in environment.');
  }
  if (!clientId || !clientSecret) {
    throw new Error(
      'SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required in environment.',
    );
  }

  // Enforce Invariant 6: Destination Safety Guard
  assertSafeDatabaseTarget(
    supabaseUrl,
    args.allowProductionWrite,
    'Spotify Catalog Enrichment CLI Runner',
  );

  console.log('='.repeat(64));
  console.log('       ENCORE — SPOTIFY CATALOG ENRICHMENT RUNNER');
  console.log('='.repeat(64));
  console.log(`Database Target:        ${supabaseUrl}`);
  console.log(
    `Execution Mode:         ${args.dryRun ? 'DRY-RUN (Safe Read-Only Preview)' : 'LIVE PERSISTENCE'}`,
  );
  if (args.limit) {
    console.log(`Limit:                  ${args.limit}`);
  }
  if (args.region) {
    console.log(`Region Filter:          ${args.region}`);
  }
  console.log('-'.repeat(64));

  const enricher = new SpotifyCatalogEnricher({
    supabaseUrl,
    serviceRoleKey,
    clientId,
    clientSecret,
    allowProductionWrite: args.allowProductionWrite,
    dryRun: args.dryRun,
    rateLimitDelayMs: 100, // 100ms spacing
  });

  if (args.backfillGenres) {
    // Genre-only backfill for artists that already have a Spotify mapping (no matching/search)
    console.log('Backfilling Spotify genres for already-mapped artists...');
    const result = await enricher.backfillGenres({ limit: args.limit });
    console.log(
      args.dryRun
        ? `Genre backfill (DRY-RUN, nothing written): ${result.wouldUpdate} would be updated, ${result.skippedNoGenres} had no Spotify genres, ${result.candidates} candidates`
        : `Genre backfill: ${result.updated} updated, ${result.skippedNoGenres} had no Spotify genres, ${result.candidates} candidates`,
    );
    return;
  }

  console.log('Querying canonical headliners from events in local Supabase...');
  const headliners = await enricher.getHeadlinersToEnrich({
    region: args.region,
    limit: args.limit,
  });

  const totalEventCount = headliners.reduce(
    (sum, h) => sum + (h.eventCount || 1),
    0,
  );
  console.log(`✓ Scanned events: ${totalEventCount}`);
  console.log(`✓ Unique canonical headliners to process: ${headliners.length}`);
  console.log('-'.repeat(64));

  const startTime = Date.now();

  const report = await enricher.enrichArtists(
    headliners,
    (res: ArtistEnrichmentResult, current: number, total: number) => {
      const tag =
        res.status === 'enriched'
          ? '✓ ENRICHED'
          : res.status === 'already_linked'
            ? '⚡ LINKED'
            : res.status === 'ambiguous'
              ? '⚠ AMBIGUOUS'
              : '✗ UNMATCHED';

      const padNum = `[${String(current).padStart(String(total).length, ' ')}/${total}]`;

      if (args.verbose || current % 25 === 0 || current === total) {
        console.log(
          `${padNum} ${tag.padEnd(12)} ${res.artistName.padEnd(35).slice(0, 35)} ${
            res.spotifyId ? `(spotify:${res.spotifyId})` : ''
          }`,
        );
      }
    },
  );

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(64));
  console.log('ENRICHMENT TELEMETRY METRICS:');
  console.log('='.repeat(64));
  console.log(
    `  Execution Mode:             ${args.dryRun ? 'DRY-RUN' : 'LIVE PERSISTENCE'}`,
  );
  console.log(`  Total Events Scanned:       ${totalEventCount}`);
  console.log(`  Total Processed Artists:    ${report.summary.totalProcessed}`);
  console.log(`  Enriched (Corroborated 1):  ${report.summary.enrichedCount}`);
  console.log(`  Ambiguous (Collisions >1):  ${report.summary.ambiguousCount}`);
  console.log(`  Unmatched (0 Exact):        ${report.summary.unmatchedCount}`);
  console.log(
    `  Already Linked (Idempotent):${report.summary.alreadyLinkedCount}`,
  );
  console.log(
    `  Images Enriched/Updated:    ${report.summary.imagesUpdatedCount}`,
  );
  console.log(
    `  Spotify API Requests Used:  ${report.summary.apiRequestsUsed}`,
  );
  console.log(`  Total Duration:             ${durationSec}s`);
  console.log('='.repeat(64));

  // Print a reviewed sample of matches
  const enrichedSample = report.results
    .filter((r) => r.status === 'enriched')
    .slice(0, 10);

  if (enrichedSample.length > 0) {
    console.log('\nREVIEWED SAMPLE: ENRICHED ARTISTS (Corroborated 1:1 Match)');
    console.log('-'.repeat(64));
    for (const r of enrichedSample) {
      console.log(
        `  • ${r.artistName.padEnd(28)} -> Spotify ID: ${r.spotifyId} (Image: ${r.imageUpdated ? 'Updated' : 'Preserved/None'})`,
      );
    }
  }

  const ambiguousSample = report.results
    .filter((r) => r.status === 'ambiguous')
    .slice(0, 10);

  if (ambiguousSample.length > 0) {
    console.log(
      '\nREVIEWED SAMPLE: AMBIGUOUS COLLISION PROTECTION (Invariant 5)',
    );
    console.log('-'.repeat(64));
    for (const r of ambiguousSample) {
      const cCount = r.ambiguousCandidates?.length ?? 0;
      const ids =
        r.ambiguousCandidates
          ?.map((c) => c.id)
          .slice(0, 3)
          .join(', ') ?? '';
      console.log(
        `  • ${r.artistName.padEnd(28)} -> ${cCount} matches [${ids}${cCount > 3 ? '...' : ''}]`,
      );
    }
  }

  const unmatchedSample = report.results
    .filter((r) => r.status === 'unmatched')
    .slice(0, 5);

  if (unmatchedSample.length > 0) {
    console.log('\nREVIEWED SAMPLE: UNMATCHED ARTISTS');
    console.log('-'.repeat(64));
    for (const r of unmatchedSample) {
      console.log(`  • ${r.artistName.padEnd(28)} -> ${r.reason}`);
    }
  }

  console.log('\n✓ Enrichment task finished cleanly.\n');
  return report;
}

// Direct execution entrypoint
const isCliEntry =
  !process.env.VITEST &&
  (import.meta.url.includes('enrich-catalog-spotify') ||
    process.argv.some((arg) => arg.includes('enrich-catalog-spotify')));

if (isCliEntry) {
  runSpotifyCatalogEnrichment().catch((err) => {
    console.error('\n❌ Fatal error in Spotify catalog enrichment:', err);
    process.exit(1);
  });
}
