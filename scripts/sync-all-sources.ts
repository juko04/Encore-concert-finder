#!/usr/bin/env node

/**
 * ENCORE V2 — Multi-Source Ingestion & Rolling Synchronization CLI
 *
 * Orchestrates multi-horizon synchronization across:
 * 1. Ticketmaster Discovery API v2 (with Temporal Date Bisection & Quota Guard)
 * 2. Z2 Entertainment Network (Boulder Theater, Fox Theatre, Aggie Theatre)
 * 3. Independent Venue Group (Larimer Lounge, Lost Lake Lounge, Globe Hall)
 * 4. Cervantes' Masterpiece Ballroom & The Other Side
 * 5. Velvet Elk Lounge & Roots Music Project
 *
 * Scheduling Horizons:
 * - near-term (0 - 14 days): daily high-frequency refresh
 * - mid-term (15 - 60 days): bi-weekly refresh
 * - long-term (61 - 365 days): weekly refresh
 * - full (0 - 365 days): comprehensive baseline sync
 *
 * Usage:
 *   # Safe dry-run preview of all sources from fixtures (default, zero network, zero DB writes):
 *   npx tsx scripts/sync-all-sources.ts --fixture
 *
 *   # Live preview of near-term events without persisting:
 *   npx tsx scripts/sync-all-sources.ts --live --horizon=near-term
 *
 *   # Explicit database persistence mode:
 *   npx tsx scripts/sync-all-sources.ts --live --persist --horizon=near-term
 */

import path from 'node:path';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import {
  TicketmasterApiClient,
  TicketmasterDiscoveryAdapter,
  runTicketmasterIngestion,
  getGlobalTicketmasterQuotaGuard,
} from '@/lib/sources/ticketmaster';
import {
  CervantesVenueAdapter,
  IndependentVenueAdapter,
  VelvetElkAdapter,
  RootsMusicProjectAdapter,
  Z2EntertainmentAdapter,
  runVenueIngestion,
  CERVANTES_CONFIG,
  LARIMER_LOUNGE_CONFIG,
  LOST_LAKE_CONFIG,
  GLOBE_HALL_CONFIG,
  VELVET_ELK_CONFIG,
  ROOTS_MUSIC_PROJECT_CONFIG,
  Z2_ENTERTAINMENT_CONFIG,
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

export type SyncHorizon = 'near-term' | 'mid-term' | 'long-term' | 'full';

export interface SyncOptions {
  horizon: SyncHorizon;
  live: boolean;
  persist: boolean;
  sources?: ('ticketmaster' | 'venues')[];
}

export interface SyncReport {
  sourceName: string;
  sourceType: 'aggregator' | 'venue';
  status: 'success' | 'failed' | 'skipped';
  eventsFetched: number;
  candidatesExtracted: number;
  canonicalCreated: number;
  canonicalMatched: number;
  soldOutCount: number;
  durationMs: number;
  error?: string;
}

export function calculateHorizonDates(horizon: SyncHorizon): {
  startUtc: string;
  endUtc: string;
} {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  switch (horizon) {
    case 'near-term':
      end.setDate(now.getDate() + 14);
      break;
    case 'mid-term':
      start.setDate(now.getDate() + 15);
      end.setDate(now.getDate() + 60);
      break;
    case 'long-term':
      start.setDate(now.getDate() + 61);
      end.setDate(now.getDate() + 365);
      break;
    case 'full':
    default:
      end.setDate(now.getDate() + 365);
      break;
  }

  return {
    startUtc: start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    endUtc: end.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

export async function runMultiSourceSync(
  options: SyncOptions,
): Promise<{ reports: SyncReport[]; totalTimeMs: number }> {
  const startTime = Date.now();
  const reports: SyncReport[] = [];

  if (options.persist) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    assertSafeDatabaseTarget(
      supabaseUrl,
      false,
      'Multi-Source Sync CLI Runner',
    );
  }

  // Set up repositories based on persistence flag
  const catalogRepo = options.persist
    ? new SupabaseCatalogRepository()
    : new MemoryCatalogRepository();
  const rawIngestRepo = options.persist
    ? new SupabaseRawIngestRepository()
    : new MemoryRawIngestRepository();
  const candidateRepo = options.persist
    ? new SupabaseEventCandidateRepository()
    : new MemoryEventCandidateRepository();
  const sourceRepo = options.persist
    ? new SupabaseSourceRepository()
    : new MemorySourceRepository();

  const includeTm =
    !options.sources || options.sources.includes('ticketmaster');
  const includeVenues = !options.sources || options.sources.includes('venues');

  const { startUtc, endUtc } = calculateHorizonDates(options.horizon);

  // 1. Ticketmaster Ingestion
  if (includeTm) {
    const tmStart = Date.now();
    try {
      console.log(
        `\n[SYNC] Starting Ticketmaster sync (${options.horizon}: ${startUtc} -> ${endUtc})...`,
      );
      const tmAdapter = new TicketmasterDiscoveryAdapter({
        apiKey: options.live
          ? process.env.TICKETMASTER_API_KEY
          : 'fixture-test-key',
      });

      const tmResult = await runTicketmasterIngestion({
        adapter: tmAdapter,
        rawIngestRepo,
        candidateRepo,
        catalogRepo,
        sourceRepo,
        queryParams: {
          stateCode: 'CO',
          startDateTime: startUtc,
          endDateTime: endUtc,
          size: 50,
        },
        useFixture: !options.live,
        persist: options.persist,
      });

      reports.push({
        sourceName: 'Ticketmaster (CO Region)',
        sourceType: 'aggregator',
        status: 'success',
        eventsFetched: tmResult.rawIngestsFetched,
        candidatesExtracted: tmResult.candidatesParsed,
        canonicalCreated: tmResult.canonicalEventsCreated,
        canonicalMatched: tmResult.canonicalEventsMatched,
        soldOutCount: tmResult.candidates.filter(
          (c) => c.inventoryStatus === 'sold_out',
        ).length,
        durationMs: Date.now() - tmStart,
      });
    } catch (err) {
      console.error('[SYNC] Ticketmaster sync failed:', err);
      reports.push({
        sourceName: 'Ticketmaster (CO Region)',
        sourceType: 'aggregator',
        status: 'failed',
        eventsFetched: 0,
        candidatesExtracted: 0,
        canonicalCreated: 0,
        canonicalMatched: 0,
        soldOutCount: 0,
        durationMs: Date.now() - tmStart,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. Official Colorado Venue Adapters
  if (includeVenues) {
    const venueConfigs = [
      {
        config: Z2_ENTERTAINMENT_CONFIG,
        adapterFactory: () =>
          new Z2EntertainmentAdapter(Z2_ENTERTAINMENT_CONFIG),
        fixture: 'tests/fixtures/z2-events-response.html',
      },
      {
        config: CERVANTES_CONFIG,
        adapterFactory: () => new CervantesVenueAdapter(CERVANTES_CONFIG),
        fixture: 'tests/fixtures/cervantes-events-response.html',
      },
      {
        config: LARIMER_LOUNGE_CONFIG,
        adapterFactory: () =>
          new IndependentVenueAdapter(LARIMER_LOUNGE_CONFIG),
        fixture: 'tests/fixtures/larimer-lounge-events-response.html',
      },
      {
        config: LOST_LAKE_CONFIG,
        adapterFactory: () => new IndependentVenueAdapter(LOST_LAKE_CONFIG),
        fixture: 'tests/fixtures/lost-lake-events-response.html',
      },
      {
        config: GLOBE_HALL_CONFIG,
        adapterFactory: () => new IndependentVenueAdapter(GLOBE_HALL_CONFIG),
        fixture: 'tests/fixtures/globe-hall-events-response.html',
      },
      {
        config: VELVET_ELK_CONFIG,
        adapterFactory: () => new VelvetElkAdapter(VELVET_ELK_CONFIG),
        fixture: 'tests/fixtures/velvet-elk-events-response.html',
      },
      {
        config: ROOTS_MUSIC_PROJECT_CONFIG,
        adapterFactory: () =>
          new RootsMusicProjectAdapter(ROOTS_MUSIC_PROJECT_CONFIG),
        fixture: 'tests/fixtures/roots-music-project-events-response.html',
      },
    ];

    for (const v of venueConfigs) {
      const vStart = Date.now();
      try {
        console.log(`[SYNC] Syncing venue: ${v.config.name}...`);
        const adapter = v.adapterFactory();
        const vResult = await runVenueIngestion({
          config: v.config,
          adapter,
          rawIngestRepo,
          candidateRepo,
          catalogRepo,
          sourceRepo,
          persist: options.persist,
          useFixture: !options.live,
          fixturePath: options.live
            ? undefined
            : path.resolve(process.cwd(), v.fixture),
        });

        reports.push({
          sourceName: v.config.name,
          sourceType: 'venue',
          status: 'success',
          eventsFetched: vResult.rawIngestsFetched,
          candidatesExtracted: vResult.candidatesParsed,
          canonicalCreated: vResult.canonicalEventsCreated,
          canonicalMatched: vResult.canonicalEventsMatched,
          soldOutCount: vResult.candidates.filter(
            (c) =>
              c.inventoryStatus === 'sold_out' ||
              c.rawPayload?.isSoldOut === true,
          ).length,
          durationMs: Date.now() - vStart,
        });
      } catch (err) {
        console.error(`[SYNC] Failed syncing ${v.config.name}:`, err);
        reports.push({
          sourceName: v.config.name,
          sourceType: 'venue',
          status: 'failed',
          eventsFetched: 0,
          candidatesExtracted: 0,
          canonicalCreated: 0,
          canonicalMatched: 0,
          soldOutCount: 0,
          durationMs: Date.now() - vStart,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const totalTimeMs = Date.now() - startTime;
  return { reports, totalTimeMs };
}

// CLI runner
async function main() {
  const args = process.argv.slice(2);
  const isLive = args.includes('--live');
  const isPersist = args.includes('--persist');
  const horizonArg = args
    .find((a) => a.startsWith('--horizon='))
    ?.split('=')[1] as SyncHorizon | undefined;
  const horizon: SyncHorizon = horizonArg || 'full';

  console.log('='.repeat(70));
  console.log('ENCORE V2 — MULTI-SOURCE ROLLING SYNCHRONIZATION');
  console.log('='.repeat(70));
  console.log(
    `Mode: ${isLive ? 'LIVE' : 'FIXTURE PREVIEW'} | Persist: ${isPersist} | Horizon: ${horizon}`,
  );

  const quota = getGlobalTicketmasterQuotaGuard();
  const quotaStatus = quota.getStatus();
  console.log(
    `Ticketmaster Daily Quota: ${quotaStatus.count}/${quotaStatus.dailyLimit} (Remaining: ${quotaStatus.remaining})`,
  );

  const { reports, totalTimeMs } = await runMultiSourceSync({
    horizon,
    live: isLive,
    persist: isPersist,
  });

  console.log('\n' + '='.repeat(70));
  console.log('SYNCHRONIZATION RESULTS SUMMARY');
  console.log('='.repeat(70));

  let totalFetched = 0;
  let totalCandidates = 0;
  let totalCreated = 0;
  let totalMatched = 0;
  let totalSoldOut = 0;

  for (const r of reports) {
    totalFetched += r.eventsFetched;
    totalCandidates += r.candidatesExtracted;
    totalCreated += r.canonicalCreated;
    totalMatched += r.canonicalMatched;
    totalSoldOut += r.soldOutCount;

    const statusBadge = r.status === 'success' ? '✓ PASS' : '✗ FAIL';
    console.log(
      `${statusBadge.padEnd(8)} ${r.sourceName.padEnd(36)} ` +
        `Fetched: ${String(r.eventsFetched).padStart(3)} | ` +
        `Candidates: ${String(r.candidatesExtracted).padStart(3)} | ` +
        `Canonical: +${String(r.canonicalCreated).padStart(3)} (Merged: ${String(r.canonicalMatched).padStart(2)}) | ` +
        `Sold Out: ${String(r.soldOutCount).padStart(2)} | ` +
        `Time: ${r.durationMs}ms`,
    );
  }

  console.log('-'.repeat(70));
  console.log(
    `TOTALS: ${reports.length} sources | ` +
      `Raw: ${totalFetched} | Candidates: ${totalCandidates} | ` +
      `New Canonical: +${totalCreated} | Merged Duplicates: ${totalMatched} | ` +
      `Sold Out: ${totalSoldOut} | Total Duration: ${(totalTimeMs / 1000).toFixed(2)}s`,
  );
  console.log('='.repeat(70) + '\n');
}

main().catch((err) => {
  console.error('Fatal sync failure:', err);
  process.exit(1);
});
