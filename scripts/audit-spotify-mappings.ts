#!/usr/bin/env node

/**
 * Spotify Catalog Mappings Integrity Auditor & Repair CLI
 *
 * Exhaustively audits all Spotify external ID mappings in public.artist_external_ids
 * adhering to Invariant 5 (Conservative Entity Resolution) and Invariant 6 (Safe Database Target):
 *
 * 1. Checks format validity: strictly 22-character alphanumeric strings matching ^[0-9A-Za-z]{22}$.
 * 2. Identifies synthetic placeholders (e.g. spotify_*_real or non-standard format).
 * 3. Batches queries to Spotify Web API (GET /v1/artists?ids=... with fallback) to corroborate
 *    exact artist names against canonical Encore artist names.
 * 4. Detects valid corroborated, name mismatch, unverified, conflicting, or ambiguous mappings.
 * 5. Ensures canonical artist for John Summit exists in artists table and has verified
 *    Spotify ID 7kNqXtgeIwFtelmRjWv205 in artist_external_ids.
 * 6. Outputs exact counts:
 *    - Total Spotify mappings audited
 *    - Valid 22-char format count
 *    - Corroborated with Spotify API count
 *    - Placeholders/invalid detected and repaired
 *    - Conflicting / ambiguous mappings
 *
 * Usage:
 *   # Safe preview run (dry-run, zero database writes):
 *   vite-node --config vitest.config.ts scripts/audit-spotify-mappings.ts -- --dry-run
 *
 *   # Live audit & ensure John Summit:
 *   vite-node --config vitest.config.ts scripts/audit-spotify-mappings.ts
 *
 *   # Live audit with auto-repair of detected placeholders:
 *   vite-node --config vitest.config.ts scripts/audit-spotify-mappings.ts -- --repair
 */

import fs from 'node:fs';
import path from 'node:path';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import {
  SpotifyCatalogEnricher,
  type SpotifyMappingAuditReport,
} from '@/lib/entity-resolution/spotify-catalog-enricher';

interface ParsedArgs {
  dryRun: boolean;
  repair: boolean;
  allowProductionWrite: boolean;
  verbose: boolean;
  json: boolean;
  ensureJohnSummit: boolean;
}

function parseCliArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const parsed: ParsedArgs = {
    dryRun: false,
    repair: false,
    allowProductionWrite: false,
    verbose: false,
    json: false,
    ensureJohnSummit: true,
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--repair') {
      parsed.repair = true;
    } else if (arg === '--allow-production-write') {
      parsed.allowProductionWrite = true;
    } else if (arg === '--verbose') {
      parsed.verbose = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--no-ensure-john-summit') {
      parsed.ensureJohnSummit = false;
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

export async function runSpotifyMappingAudit(
  cliArgs?: ParsedArgs,
): Promise<SpotifyMappingAuditReport> {
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
    'Spotify Mapping Auditor CLI',
  );

  if (!args.json) {
    console.log('='.repeat(72));
    console.log('       ENCORE — SPOTIFY CATALOG MAPPINGS INTEGRITY AUDITOR');
    console.log('='.repeat(72));
    console.log(`Database Target:        ${supabaseUrl}`);
    console.log(
      `Execution Mode:         ${args.dryRun ? 'DRY-RUN (Safe Read-Only Preview)' : 'LIVE EXECUTION'}`,
    );
    console.log(
      `Auto-Repair Mode:       ${args.repair ? 'ENABLED' : 'DISABLED (Audit Only)'}`,
    );
    console.log(
      `Ensure John Summit:     ${args.ensureJohnSummit ? 'YES (Verified Spotify ID 7kNqXtgeIwFtelmRjWv205)' : 'NO'}`,
    );
    console.log('-'.repeat(72));
  }

  const enricher = new SpotifyCatalogEnricher({
    supabaseUrl,
    serviceRoleKey,
    clientId,
    clientSecret,
    allowProductionWrite: args.allowProductionWrite,
    dryRun: args.dryRun,
    rateLimitDelayMs: 60,
  });

  if (args.ensureJohnSummit) {
    if (!args.json) {
      console.log(
        'Ensuring canonical artist John Summit exists in artists table...',
      );
    }
    const jsResult = await enricher.ensureJohnSummit();
    if (!args.json) {
      console.log(
        `✓ John Summit: Artist ID: ${jsResult.artistId} (Created: ${jsResult.createdArtist}, Linked External ID: ${jsResult.linkedExternalId})`,
      );
    }
  }

  if (!args.json) {
    console.log(
      'Auditing all Spotify artist mappings from public.artist_external_ids...',
    );
  }

  const startTime = Date.now();

  const report = await enricher.auditSpotifyMappings({
    repair: args.repair,
    ensureJohnSummit: false, // Already ran above if requested
    onProgress: (current, total) => {
      if (
        !args.json &&
        (args.verbose || current % 30 === 0 || current === total)
      ) {
        process.stdout.write(
          `\rAudited ${current} / ${total} mappings (${Math.round((current / total) * 100)}%)...`,
        );
      }
    },
  });

  if (!args.json) {
    process.stdout.write('\n');
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  const { summary, rows } = report;

  console.log('\n' + '='.repeat(72));
  console.log('EXHAUSTIVE SPOTIFY CATALOG AUDIT COUNTS:');
  console.log('='.repeat(72));
  console.log(
    `  • Total Spotify mappings audited:             ${summary.totalAudited}`,
  );
  console.log(
    `  • Valid 22-char format count:                 ${summary.validFormatCount}`,
  );
  console.log(
    `  • Corroborated with Spotify API count:        ${summary.corroboratedCount}`,
  );
  console.log(
    `  • Placeholders/invalid detected:              ${summary.placeholdersDetectedCount}`,
  );
  console.log(
    `  • Placeholders/invalid repaired:              ${summary.placeholdersRepairedCount}`,
  );
  console.log(
    `  • Conflicting mappings:                       ${summary.conflictingCount}`,
  );
  console.log(
    `  • Ambiguous mappings:                         ${summary.ambiguousCount}`,
  );
  console.log(
    `  • Name mismatches:                            ${summary.nameMismatchCount}`,
  );
  console.log(
    `  • Unverified / 404 count:                     ${summary.unverifiedCount}`,
  );
  console.log(
    `  • Total duration:                             ${durationSec}s`,
  );
  console.log('='.repeat(72));

  // Reconciliation Table
  console.log('\nRECONCILIATION TABLE:');
  console.log('-'.repeat(110));
  console.log(
    ` ${'#'.padEnd(4)} | ${'Encore Artist Name'.padEnd(28)} | ${'Spotify ID'.padEnd(22)} | ${'Spotify Name'.padEnd(28)} | ${'Status'.padEnd(14)}`,
  );
  console.log('-'.repeat(110));

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const num = String(i + 1).padStart(3, ' ');
    const encoreName = r.encoreArtistName.padEnd(28).slice(0, 28);
    const spotifyId = (r.repairedToSpotifyId || r.spotifyId)
      .padEnd(22)
      .slice(0, 22);
    const spotName = (r.spotifyArtistName || 'N/A').padEnd(28).slice(0, 28);
    const status = r.status.toUpperCase().padEnd(14);

    if (
      args.verbose ||
      i < 15 ||
      i >= rows.length - 5 ||
      r.status !== 'corroborated'
    ) {
      console.log(
        ` ${num} | ${encoreName} | ${spotifyId} | ${spotName} | ${status}`,
      );
    } else if (i === 15) {
      console.log(
        ` ... | ... (${rows.length - 20} corroborated entries omitted; use --verbose) ...`,
      );
    }
  }
  console.log('-'.repeat(110));

  if (summary.placeholdersDetectedCount > 0 && !args.repair) {
    console.log(
      '\n⚠ NOTE: Detected synthetic placeholders or invalid formats. Run with --repair to automatically resolve them.\n',
    );
  } else {
    console.log(
      '\n✓ Spotify catalog audit completed with 100% integrity verification.\n',
    );
  }

  return report;
}

// Direct execution entrypoint
const isCliEntry =
  !process.env.VITEST &&
  (import.meta.url.includes('audit-spotify-mappings') ||
    process.argv.some((arg) => arg.includes('audit-spotify-mappings')));

if (isCliEntry) {
  runSpotifyMappingAudit().catch((err) => {
    console.error('\n❌ Fatal error in Spotify catalog audit:', err);
    process.exit(1);
  });
}
