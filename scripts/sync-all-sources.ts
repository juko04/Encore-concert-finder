#!/usr/bin/env node

/**
 * ENCORE V2 — Multi-Source Ingestion & Rolling Synchronization CLI
 *
 * Orchestrates multi-horizon synchronization across:
 * 1. Ticketmaster Discovery API v2 (Configurable Geographic Coverage & Nationwide Tours)
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
 *   # Safe dry-run preview of default CO region from fixtures:
 *   npx tsx scripts/sync-all-sources.ts --fixture
 *
 *   # Multi-state coverage preview (CO, UT, WY, NM):
 *   npx tsx scripts/sync-all-sources.ts --fixture --states=CO,UT,WY,NM
 *
 *   # Live preview of near-term events without persisting:
 *   npx tsx scripts/sync-all-sources.ts --live --horizon=near-term
 *
 *   # Explicit database persistence mode to local database:
 *   npx tsx scripts/sync-all-sources.ts --live --persist --horizon=near-term
 *
 *   # Deliberate production persistence (requires --allow-production-write):
 *   npx tsx scripts/sync-all-sources.ts --live --persist --allow-production-write
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import type { IRawIngestRepository } from '@/lib/repositories/interfaces';
import {
  TicketmasterDiscoveryAdapter,
  runTicketmasterIngestion,
  getGlobalTicketmasterQuotaGuard,
  RunRequestBudget,
  ensureTicketmasterSource,
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

export type SyncHorizon =
  'near-term' | 'mid-term' | 'long-term' | 'full' | 'auto';

export const HORIZON_SLA_MS: Record<
  Exclude<SyncHorizon, 'full' | 'auto'>,
  number
> = {
  'near-term': 24 * 60 * 60 * 1000, // 24 hours (sync daily)
  'mid-term': 96 * 60 * 60 * 1000, // 96 hours / 4 days (sync twice weekly)
  'long-term': 192 * 60 * 60 * 1000, // 192 hours / 8 days (sync weekly)
};

export interface SyncOptions {
  horizon: SyncHorizon;
  live: boolean;
  persist: boolean;
  states?: string[];
  sources?: ('ticketmaster' | 'venues')[];
  allowProductionWrite?: boolean;
  favoriteArtists?: string[];
  syncFavoriteArtists?: boolean;
  syncFestivals?: boolean;
  usePartitioner?: boolean;
  maxRequestsPerRun?: number;
  silent?: boolean;
  recoverMissed?: boolean;
}

export interface SyncReport {
  sourceName: string;
  sourceType: 'aggregator' | 'venue';
  status: 'success' | 'partial' | 'failed' | 'skipped';
  eventsFetched: number;
  candidatesExtracted: number;
  canonicalCreated: number;
  canonicalMatched: number;
  soldOutCount: number;
  durationMs: number;
  hasIncompleteCoverage?: boolean;
  error?: string;
}

export interface MultiSourceSyncResult {
  overallStatus: 'success' | 'partial' | 'failed';
  exitCode: number;
  reports: SyncReport[];
  totalTimeMs: number;
  regionsCovered: string[];
  favoriteArtistsQueried: string[];
  festivalsQueried: boolean;
  horizonsExecuted?: SyncHorizon[];
  recoveredHorizons?: SyncHorizon[];
  runBudgetStatus?: {
    maxRequests: number;
    consumed: number;
    remaining: number;
  };
}

export function calculateHorizonDates(horizon: SyncHorizon): {
  startUtc: string;
  endUtc: string;
} {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  switch (horizon) {
    case 'auto':
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

/**
 * Retrieves the most recent successful sync timestamp for each Ticketmaster horizon from raw_ingests.
 */
export async function getHorizonSyncHistory(
  rawIngestRepo: IRawIngestRepository,
  tmSourceId?: string,
): Promise<Record<Exclude<SyncHorizon, 'full' | 'auto'>, Date | null>> {
  const result: Record<Exclude<SyncHorizon, 'full' | 'auto'>, Date | null> = {
    'near-term': null,
    'mid-term': null,
    'long-term': null,
  };

  if (!tmSourceId) return result;

  try {
    const ingests = await rawIngestRepo.listBySource(tmSourceId, 100);
    const sorted = [...ingests].sort(
      (a, b) =>
        new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime(),
    );
    for (const ingest of sorted) {
      if (
        ingest.sourceUrl.startsWith('encore://sync-checkpoint/ticketmaster/')
      ) {
        for (const h of ['near-term', 'mid-term', 'long-term'] as const) {
          if (ingest.sourceUrl.includes(`/ticketmaster/${h}`) && !result[h]) {
            result[h] = new Date(ingest.fetchedAt);
          }
        }
      }
    }
  } catch {
    // If error or empty, return null timestamps
  }

  return result;
}

/**
 * Determines which horizons are overdue and need execution based on SLAs and durable history.
 * Guarantees that pending-run replacement in GitHub Actions (concurrency queue depth 1)
 * cannot silently drop or starve mid-term or long-term synchronization windows.
 */
export function determineDueHorizons(
  requestedHorizon: SyncHorizon,
  syncHistory: Record<Exclude<SyncHorizon, 'full' | 'auto'>, Date | null>,
  now: Date = new Date(),
  recoverMissed: boolean = true,
): Exclude<SyncHorizon, 'auto'>[] {
  if (requestedHorizon === 'full') {
    return ['full'];
  }

  const overdue: Exclude<SyncHorizon, 'full' | 'auto'>[] = [];
  const horizons: Exclude<SyncHorizon, 'full' | 'auto'>[] = [
    'near-term',
    'mid-term',
    'long-term',
  ];

  for (const h of horizons) {
    const lastSync = syncHistory[h];
    const slaMs = HORIZON_SLA_MS[h];
    if (!lastSync) {
      overdue.push(h);
    } else {
      const elapsedMs = now.getTime() - lastSync.getTime();
      if (elapsedMs > slaMs) {
        overdue.push(h);
      }
    }
  }

  if (requestedHorizon === 'auto') {
    return overdue.length > 0 ? overdue : ['near-term'];
  }

  const target: Exclude<SyncHorizon, 'auto'>[] = [requestedHorizon];
  if (recoverMissed) {
    for (const h of overdue) {
      if (!target.includes(h)) {
        target.push(h);
      }
    }
  }
  return target;
}

/**
 * Durably records an immutable synchronization checkpoint in raw_ingests.
 */
export async function recordHorizonCheckpoint(
  rawIngestRepo: IRawIngestRepository,
  tmSourceId: string,
  horizon: Exclude<SyncHorizon, 'auto'>,
  fetchedAt: Date = new Date(),
): Promise<void> {
  const horizonsToMark =
    horizon === 'full'
      ? (['near-term', 'mid-term', 'long-term'] as const)
      : [horizon];

  for (const h of horizonsToMark) {
    const sourceUrl = `encore://sync-checkpoint/ticketmaster/${h}`;
    const content = JSON.stringify({
      horizon: h,
      completedAt: fetchedAt.toISOString(),
      status: 'success',
    });
    const contentHash = crypto
      .createHash('sha256')
      .update(sourceUrl + content + fetchedAt.getTime())
      .digest('hex');

    await rawIngestRepo.create({
      sourceId: tmSourceId,
      sourceUrl,
      acquisitionMethod: 'api',
      fetchedAt: fetchedAt.toISOString(),
      contentHash,
      contentType: 'application/json',
      rawContent: content,
      externalStorageRef: null,
      httpStatus: 200,
      parserVersion: '1.0.0',
    });
  }
}

export async function runMultiSourceSync(
  options: SyncOptions,
): Promise<MultiSourceSyncResult> {
  const log = (...args: unknown[]) => {
    if (!options.silent) {
      console.log(...args);
    }
  };
  const warn = (...args: unknown[]) => {
    if (!options.silent) {
      console.warn(...args);
    }
  };

  const startTime = Date.now();
  const reports: SyncReport[] = [];

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

  if (options.allowProductionWrite) {
    if (!options.live) {
      throw new Error(
        'Cannot use --allow-production-write in fixture mode; must be used with --live.',
      );
    }
    assertSafeDatabaseTarget(
      supabaseUrl,
      true,
      'Multi-Source Sync Production Runner',
    );
  } else if (options.persist) {
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

  // Geographic coverage (defaults to priority ['CO'])
  const states =
    options.states && options.states.length > 0
      ? options.states.map((s) => s.trim().toUpperCase())
      : ['CO'];

  let favoriteArtistsQueried: string[] = [];
  let festivalsQueried = false;
  const horizonsExecuted: SyncHorizon[] = [];
  const recoveredHorizons: SyncHorizon[] = [];

  if (options.maxRequestsPerRun !== undefined) {
    if (
      !Number.isInteger(options.maxRequestsPerRun) ||
      options.maxRequestsPerRun <= 0
    ) {
      throw new Error(
        `Invalid maxRequestsPerRun: ${options.maxRequestsPerRun}. Must be a positive integer.`,
      );
    }
  }

  const runBudget =
    options.maxRequestsPerRun !== undefined
      ? new RunRequestBudget(options.maxRequestsPerRun)
      : undefined;

  // 1. Ticketmaster Ingestion (Configurable Geographic Coverage & Nationwide)
  if (includeTm) {
    const tmAdapter = new TicketmasterDiscoveryAdapter({
      apiKey: options.live
        ? process.env.TICKETMASTER_API_KEY
        : 'fixture-test-key',
      runBudget,
    });

    const tmSource = await ensureTicketmasterSource(sourceRepo);

    const syncHistory = await getHorizonSyncHistory(rawIngestRepo, tmSource.id);
    const shouldRecoverMissed =
      options.recoverMissed ??
      ((options.persist && options.horizon !== 'full') ||
        options.horizon === 'auto');
    const targetHorizons = determineDueHorizons(
      options.horizon,
      syncHistory,
      new Date(),
      shouldRecoverMissed,
    );

    if (targetHorizons.length > 1) {
      const recovered = targetHorizons.filter((h) => h !== options.horizon);
      recoveredHorizons.push(...recovered);
      log(
        `\n[SYNC RECOVERY] Multi-horizon execution active to guarantee missed synchronization windows: [${targetHorizons.join(', ')}] (Recovered: [${recovered.join(', ')}])`,
      );
    }
    horizonsExecuted.push(...targetHorizons);

    for (const currentHorizon of targetHorizons) {
      const { startUtc: hStartUtc, endUtc: hEndUtc } =
        calculateHorizonDates(currentHorizon);

      // 1A. Loop through specified regional states
      for (const state of states) {
        if (runBudget && runBudget.isExhausted()) {
          warn(
            `[SYNC BUDGET] Reached maximum requests per run budget (${options.maxRequestsPerRun}). Skipping region ${state} (${currentHorizon}).`,
          );
          reports.push({
            sourceName:
              targetHorizons.length > 1 || currentHorizon !== 'near-term'
                ? `Ticketmaster (${state} Region, ${currentHorizon})`
                : `Ticketmaster (${state} Region)`,
            sourceType: 'aggregator',
            status: 'partial',
            eventsFetched: 0,
            candidatesExtracted: 0,
            canonicalCreated: 0,
            canonicalMatched: 0,
            soldOutCount: 0,
            durationMs: 0,
            hasIncompleteCoverage: true,
            error: `Run request budget exhausted (${runBudget.getConsumed()}/${runBudget.getMaxRequests()})`,
          });
          continue;
        }
        const tmStart = Date.now();
        try {
          log(
            `\n[SYNC] Starting Ticketmaster sync for region: ${state} (${currentHorizon}: ${hStartUtc} -> ${hEndUtc})...`,
          );

          const tmResult = await runTicketmasterIngestion({
            adapter: tmAdapter,
            rawIngestRepo,
            candidateRepo,
            catalogRepo,
            sourceRepo,
            queryParams: {
              stateCode: state,
              startDateTime: hStartUtc,
              endDateTime: hEndUtc,
              size: 50,
              classificationName: 'Music',
            },
            usePartitioner: options.usePartitioner ?? true,
            useFixture: !options.live,
            persist: options.persist,
          });

          const isPartial = Boolean(tmResult.hasIncompleteCoverage);

          reports.push({
            sourceName:
              targetHorizons.length > 1 || currentHorizon !== 'near-term'
                ? `Ticketmaster (${state} Region, ${currentHorizon})`
                : `Ticketmaster (${state} Region)`,
            sourceType: 'aggregator',
            status: isPartial ? 'partial' : 'success',
            eventsFetched: tmResult.rawIngestsFetched,
            candidatesExtracted: tmResult.candidatesParsed,
            canonicalCreated: tmResult.canonicalEventsCreated,
            canonicalMatched: tmResult.canonicalEventsMatched,
            soldOutCount: tmResult.candidates.filter(
              (c) => c.inventoryStatus === 'sold_out',
            ).length,
            durationMs: Date.now() - tmStart,
            hasIncompleteCoverage: tmResult.hasIncompleteCoverage,
          });
        } catch (err) {
          console.error(
            `[SYNC] Ticketmaster sync failed for region ${state} (${currentHorizon}):`,
            err,
          );
          reports.push({
            sourceName:
              targetHorizons.length > 1 || currentHorizon !== 'near-term'
                ? `Ticketmaster (${state} Region, ${currentHorizon})`
                : `Ticketmaster (${state} Region)`,
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

      // Record durable checkpoint for this horizon if persisted
      if (options.persist) {
        try {
          await recordHorizonCheckpoint(
            rawIngestRepo,
            tmSource.id,
            currentHorizon,
          );
        } catch (cpErr) {
          warn(
            `[SYNC] Failed to record horizon checkpoint for ${currentHorizon}:`,
            cpErr,
          );
        }
      }
    }

    // 1B. Nationwide Tour Lookup for Verified Favorite Artists
    let favoriteArtists: string[] = options.favoriteArtists ?? [];
    if (favoriteArtists.length === 0 && (options.live || options.persist)) {
      try {
        const adminClient = createAdminClient();
        const { data: prefs, error } = await adminClient
          .from('user_artist_preferences')
          .select('artist_name')
          .eq('preference_level', 'favorite');

        if (!error && prefs) {
          favoriteArtists = Array.from(
            new Set(
              prefs.map((p: { artist_name?: string }) => p.artist_name?.trim()),
            ),
          ).filter((name): name is string => Boolean(name && name.length > 0));
        }
      } catch (err) {
        warn(
          '[SYNC] Could not query user_artist_preferences for favorite artists:',
          err,
        );
      }
    }

    favoriteArtistsQueried = favoriteArtists;
    const shouldSyncFavorites = options.syncFavoriteArtists ?? true;

    if (shouldSyncFavorites && favoriteArtists.length > 0) {
      log(
        `\n[SYNC] Querying nationwide tour dates for ${favoriteArtists.length} verified favorite artist(s)...`,
      );

      for (const artistName of favoriteArtists) {
        if (runBudget && runBudget.isExhausted()) {
          reports.push({
            sourceName: `Ticketmaster (Tour: ${artistName})`,
            sourceType: 'aggregator',
            status: 'partial',
            eventsFetched: 0,
            candidatesExtracted: 0,
            canonicalCreated: 0,
            canonicalMatched: 0,
            soldOutCount: 0,
            durationMs: 0,
            hasIncompleteCoverage: true,
            error: `Run request budget exhausted (${runBudget.getConsumed()}/${runBudget.getMaxRequests()})`,
          });
          continue;
        }

        const faStart = Date.now();
        try {
          const tmFaResult = await runTicketmasterIngestion({
            adapter: tmAdapter,
            rawIngestRepo,
            candidateRepo,
            catalogRepo,
            sourceRepo,
            queryParams: {
              keyword: artistName,
              countryCode: 'US',
              startDateTime: startUtc,
              endDateTime: endUtc,
              size: 50,
              classificationName: 'Music',
            },
            usePartitioner: options.usePartitioner ?? true,
            useFixture: !options.live,
            persist: options.persist,
          });

          const isPartial = Boolean(tmFaResult.hasIncompleteCoverage);

          reports.push({
            sourceName: `Ticketmaster (Tour: ${artistName})`,
            sourceType: 'aggregator',
            status: isPartial ? 'partial' : 'success',
            eventsFetched: tmFaResult.rawIngestsFetched,
            candidatesExtracted: tmFaResult.candidatesParsed,
            canonicalCreated: tmFaResult.canonicalEventsCreated,
            canonicalMatched: tmFaResult.canonicalEventsMatched,
            soldOutCount: tmFaResult.candidates.filter(
              (c) => c.inventoryStatus === 'sold_out',
            ).length,
            durationMs: Date.now() - faStart,
            hasIncompleteCoverage: tmFaResult.hasIncompleteCoverage,
          });
        } catch (err) {
          console.error(`[SYNC] Failed tour sync for ${artistName}:`, err);
          reports.push({
            sourceName: `Ticketmaster (Tour: ${artistName})`,
            sourceType: 'aggregator',
            status: 'failed',
            eventsFetched: 0,
            candidatesExtracted: 0,
            canonicalCreated: 0,
            canonicalMatched: 0,
            soldOutCount: 0,
            durationMs: Date.now() - faStart,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // 1C. Major Nationwide Music Festivals
    const shouldSyncFestivals = options.syncFestivals ?? true;
    if (shouldSyncFestivals) {
      festivalsQueried = true;
      if (runBudget && runBudget.isExhausted()) {
        reports.push({
          sourceName: 'Ticketmaster (Nationwide Festivals)',
          sourceType: 'aggregator',
          status: 'partial',
          eventsFetched: 0,
          candidatesExtracted: 0,
          canonicalCreated: 0,
          canonicalMatched: 0,
          soldOutCount: 0,
          durationMs: 0,
          hasIncompleteCoverage: true,
          error: `Run request budget exhausted (${runBudget.getConsumed()}/${runBudget.getMaxRequests()})`,
        });
      } else {
        const festStart = Date.now();
        try {
          log(`\n[SYNC] Querying major nationwide music festivals (US)...`);
          const tmFestResult = await runTicketmasterIngestion({
            adapter: tmAdapter,
            rawIngestRepo,
            candidateRepo,
            catalogRepo,
            sourceRepo,
            queryParams: {
              keyword: 'festival',
              countryCode: 'US',
              startDateTime: startUtc,
              endDateTime: endUtc,
              size: 50,
              classificationName: 'Music',
            },
            usePartitioner: options.usePartitioner ?? true,
            useFixture: !options.live,
            persist: options.persist,
          });

          const isPartial = Boolean(tmFestResult.hasIncompleteCoverage);

          reports.push({
            sourceName: 'Ticketmaster (Nationwide Festivals)',
            sourceType: 'aggregator',
            status: isPartial ? 'partial' : 'success',
            eventsFetched: tmFestResult.rawIngestsFetched,
            candidatesExtracted: tmFestResult.candidatesParsed,
            canonicalCreated: tmFestResult.canonicalEventsCreated,
            canonicalMatched: tmFestResult.canonicalEventsMatched,
            soldOutCount: tmFestResult.candidates.filter(
              (c) => c.inventoryStatus === 'sold_out',
            ).length,
            durationMs: Date.now() - festStart,
            hasIncompleteCoverage: tmFestResult.hasIncompleteCoverage,
          });
        } catch (err) {
          console.error('[SYNC] Failed nationwide festival sync:', err);
          reports.push({
            sourceName: 'Ticketmaster (Nationwide Festivals)',
            sourceType: 'aggregator',
            status: 'failed',
            eventsFetched: 0,
            candidatesExtracted: 0,
            canonicalCreated: 0,
            canonicalMatched: 0,
            soldOutCount: 0,
            durationMs: Date.now() - festStart,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
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
        log(`[SYNC] Syncing venue: ${v.config.name}...`);
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
  const hasFailed = reports.some((r) => r.status === 'failed');
  const hasPartial = reports.some(
    (r) =>
      r.status === 'partial' ||
      r.status === 'skipped' ||
      Boolean(r.hasIncompleteCoverage),
  );
  const overallStatus: 'success' | 'partial' | 'failed' = hasFailed
    ? 'failed'
    : hasPartial
      ? 'partial'
      : 'success';
  const exitCode = hasFailed ? 1 : hasPartial ? 2 : 0;

  return {
    overallStatus,
    exitCode,
    reports,
    totalTimeMs,
    regionsCovered: states,
    favoriteArtistsQueried,
    festivalsQueried,
    horizonsExecuted,
    recoveredHorizons,
    runBudgetStatus: runBudget?.getStatus(),
  };
}

// CLI runner
async function main() {
  const args = process.argv.slice(2);
  const isLive = args.includes('--live');
  const isPersist = args.includes('--persist');
  const isJson = args.includes('--json');
  const allowProductionWrite = args.includes('--allow-production-write');
  const recoverMissed = !args.includes('--no-recover-missed');

  if (allowProductionWrite && !isLive) {
    throw new Error(
      'Cannot use --allow-production-write in fixture mode; must be used with --live.',
    );
  }

  const horizonArg = args
    .find((a) => a.startsWith('--horizon='))
    ?.split('=')[1] as SyncHorizon | undefined;
  const horizon: SyncHorizon = horizonArg || 'full';

  const statesArg = args.find((a) => a.startsWith('--states='))?.split('=')[1];
  const states = statesArg
    ? statesArg
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : ['CO'];

  const maxRequestsArg = args
    .find((a) => a.startsWith('--max-requests='))
    ?.split('=')[1];
  let maxRequestsPerRun: number | undefined;

  if (maxRequestsArg !== undefined) {
    const parsed = Number(maxRequestsArg);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      const errMsg = `[CLI ERROR] Invalid --max-requests value "${maxRequestsArg}". Must be a positive integer greater than 0.`;
      if (isJson) {
        console.log(
          JSON.stringify(
            {
              overallStatus: 'failed',
              exitCode: 1,
              error: errMsg,
            },
            null,
            2,
          ),
        );
      } else {
        console.error(errMsg);
      }
      process.exit(1);
    }
    maxRequestsPerRun = parsed;
  }

  if (!isJson) {
    console.log('='.repeat(70));
    console.log('ENCORE V2 — MULTI-SOURCE ROLLING SYNCHRONIZATION');
    console.log('='.repeat(70));
    console.log(
      `Mode: ${isLive ? 'LIVE' : 'FIXTURE PREVIEW'} | Persist: ${isPersist} | Horizon: ${horizon}`,
    );
    console.log(`Regions: ${states.join(', ')}`);
    if (maxRequestsPerRun !== undefined) {
      console.log(`Run Request Budget: ${maxRequestsPerRun} max requests`);
    }
    console.log(
      `Production Write Allowed: ${allowProductionWrite ? 'YES' : 'NO (Protected Local Only)'}`,
    );

    const quota = getGlobalTicketmasterQuotaGuard();
    const quotaStatus = quota.getStatus();
    console.log(
      `Ticketmaster Daily Quota: ${quotaStatus.count}/${quotaStatus.dailyLimit} (Remaining: ${quotaStatus.remaining})`,
    );
  }

  const result = await runMultiSourceSync({
    horizon,
    live: isLive,
    persist: isPersist,
    states,
    allowProductionWrite,
    usePartitioner: true,
    maxRequestsPerRun,
    silent: isJson,
    recoverMissed,
  });

  let totalFetched = 0;
  let totalCandidates = 0;
  let totalCreated = 0;
  let totalMatched = 0;
  let totalSoldOut = 0;

  for (const r of result.reports) {
    totalFetched += r.eventsFetched;
    totalCandidates += r.candidatesExtracted;
    totalCreated += r.canonicalCreated;
    totalMatched += r.canonicalMatched;
    totalSoldOut += r.soldOutCount;
  }

  if (isJson) {
    const jsonOutput = {
      overallStatus: result.overallStatus,
      exitCode: result.exitCode,
      totalTimeMs: result.totalTimeMs,
      regionsCovered: result.regionsCovered,
      favoriteArtistsQueried: result.favoriteArtistsQueried,
      festivalsQueried: result.festivalsQueried,
      horizonsExecuted: result.horizonsExecuted,
      recoveredHorizons: result.recoveredHorizons,
      runBudgetStatus: result.runBudgetStatus,
      totals: {
        jobs: result.reports.length,
        fetched: totalFetched,
        candidates: totalCandidates,
        canonicalCreated: totalCreated,
        canonicalMatched: totalMatched,
        soldOut: totalSoldOut,
        failed: result.reports.filter((r) => r.status === 'failed').length,
        partial: result.reports.filter((r) => r.status === 'partial').length,
        skipped: result.reports.filter((r) => r.status === 'skipped').length,
        success: result.reports.filter((r) => r.status === 'success').length,
      },
      reports: result.reports,
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
  } else {
    console.log('\n' + '='.repeat(70));
    console.log('SYNCHRONIZATION RESULTS SUMMARY');
    console.log('='.repeat(70));
    console.log(
      `Overall Status:            ${result.overallStatus.toUpperCase()} (Exit Code: ${result.exitCode})`,
    );
    console.log(
      `Regions Covered:           ${result.regionsCovered.join(', ')}`,
    );
    console.log(`Horizon:                   ${horizon}`);
    if (result.horizonsExecuted && result.horizonsExecuted.length > 1) {
      console.log(
        `Horizons Executed:         ${result.horizonsExecuted.join(', ')}`,
      );
      console.log(
        `Recovered Missed Horizons: ${result.recoveredHorizons?.join(', ') || 'None'}`,
      );
    }
    console.log(
      `Favorite Artist Tours:     ${
        result.favoriteArtistsQueried.length > 0
          ? `${result.favoriteArtistsQueried.length} (${result.favoriteArtistsQueried.join(', ')})`
          : '0 (None configured)'
      }`,
    );
    console.log(
      `Major Nationwide Festivals: ${result.festivalsQueried ? 'Queried (US nationwide)' : 'Skipped'}`,
    );
    if (result.runBudgetStatus) {
      console.log(
        `Run Request Budget:        ${result.runBudgetStatus.consumed}/${result.runBudgetStatus.maxRequests} consumed (Remaining: ${result.runBudgetStatus.remaining})`,
      );
    }
    console.log('-'.repeat(70));

    for (const r of result.reports) {
      const statusBadge =
        r.status === 'success'
          ? '✓ PASS'
          : r.status === 'partial'
            ? '⚠ PART'
            : r.status === 'skipped'
              ? '⊘ SKIP'
              : '✗ FAIL';
      console.log(
        `${statusBadge.padEnd(8)} ${r.sourceName.padEnd(38)} ` +
          `Fetched: ${String(r.eventsFetched).padStart(3)} | ` +
          `Candidates: ${String(r.candidatesExtracted).padStart(3)} | ` +
          `Canonical: +${String(r.canonicalCreated).padStart(3)} (Merged: ${String(r.canonicalMatched).padStart(2)}) | ` +
          `Sold Out: ${String(r.soldOutCount).padStart(2)} | ` +
          `Time: ${r.durationMs}ms`,
      );
    }

    console.log('-'.repeat(70));
    console.log(
      `TOTALS: ${result.reports.length} sync jobs | ` +
        `Raw: ${totalFetched} | Candidates: ${totalCandidates} | ` +
        `New Canonical: +${totalCreated} | Merged Duplicates: ${totalMatched} | ` +
        `Sold Out: ${totalSoldOut} | Total Duration: ${(result.totalTimeMs / 1000).toFixed(2)}s`,
    );
    console.log('='.repeat(70) + '\n');
  }

  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
}

const isTestRunner = Boolean(process.env.VITEST);
const isDirectExecution =
  !isTestRunner &&
  (Boolean(process.env.npm_lifecycle_script?.includes('sync-all-sources')) ||
    process.argv.some((arg) => arg.includes('sync-all-sources')) ||
    (typeof process !== 'undefined' &&
      process.argv[1] &&
      (process.argv[1].endsWith('sync-all-sources.ts') ||
        process.argv[1].endsWith('sync-all-sources') ||
        process.argv[1].includes('vite-node'))));

if (isDirectExecution) {
  main().catch((err) => {
    console.error('Fatal sync failure:', err);
    process.exit(1);
  });
}
