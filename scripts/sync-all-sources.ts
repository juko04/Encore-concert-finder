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
import type {
  IRawIngestRepository,
  ISourceRepository,
} from '@/lib/repositories/interfaces';
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
  force?: boolean;
  rawIngestRepo?: IRawIngestRepository;
  sourceRepo?: ISourceRepository;
}

export interface SyncReport {
  sourceName: string;
  sourceType: 'aggregator' | 'venue';
  horizon?: SyncHorizon;
  stateCode?: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  eventsFetched: number;
  candidatesExtracted: number;
  canonicalCreated: number;
  canonicalMatched: number;
  soldOutCount: number;
  durationMs: number;
  hasIncompleteCoverage?: boolean;
  skippedFresh?: boolean;
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

export interface HorizonCheckpointOptions {
  status?: 'success' | 'partial' | 'failed';
  hasIncompleteCoverage?: boolean;
  statesCompleted?: string[];
  statesIncomplete?: string[];
  statesFailed?: string[];
  stateCode?: string;
  eventsFetched?: number;
  candidatesParsed?: number;
  canonicalCreated?: number;
  canonicalMatched?: number;
  fetchedAt?: Date;
}

export interface HorizonCheckpointPayload {
  horizon: string;
  completedAt: string;
  status: 'success' | 'partial' | 'failed';
  hasIncompleteCoverage: boolean;
  statesCompleted?: string[];
  statesIncomplete?: string[];
  statesFailed?: string[];
  stateCode?: string;
  eventsFetched?: number;
  candidatesParsed?: number;
  canonicalCreated?: number;
  canonicalMatched?: number;
}

/**
 * Durably records a state/region level synchronization checkpoint in raw_ingests.
 */
export async function recordStateCheckpoint(
  rawIngestRepo: IRawIngestRepository,
  tmSourceId: string,
  horizon: Exclude<SyncHorizon, 'auto'>,
  stateCode: string,
  options: HorizonCheckpointOptions = {},
): Promise<void> {
  const fetchedAt = options.fetchedAt ?? new Date();
  const horizonsToMark: Exclude<SyncHorizon, 'full' | 'auto'>[] =
    horizon === 'full' ? ['near-term', 'mid-term', 'long-term'] : [horizon];

  for (const h of horizonsToMark) {
    const sourceUrl = `encore://sync-checkpoint/ticketmaster/${h}/${stateCode.toUpperCase()}`;
    const content = JSON.stringify({
      horizon: h,
      stateCode: stateCode.toUpperCase(),
      status: options.status ?? 'success',
      hasIncompleteCoverage: options.hasIncompleteCoverage ?? false,
      completedAt: fetchedAt.toISOString(),
      eventsFetched: options.eventsFetched ?? 0,
      candidatesParsed: options.candidatesParsed ?? 0,
      canonicalCreated: options.canonicalCreated ?? 0,
      canonicalMatched: options.canonicalMatched ?? 0,
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

/**
 * Retrieves the most recent successful sync timestamp for a specific state and Ticketmaster horizon.
 */
export async function getStateSyncHistory(
  rawIngestRepo: IRawIngestRepository,
  tmSourceId: string,
  horizon: Exclude<SyncHorizon, 'auto'>,
  stateCode: string,
): Promise<{
  lastSyncAt: Date | null;
  isSuccess: boolean;
  hasIncompleteCoverage: boolean;
}> {
  try {
    const stateUrl = `encore://sync-checkpoint/ticketmaster/${horizon}/${stateCode.toUpperCase()}`;
    const checkpoints = await rawIngestRepo.listBySource(
      tmSourceId,
      50,
      stateUrl,
    );
    for (const cp of checkpoints) {
      if (cp.sourceUrl === stateUrl) {
        try {
          const payload: HorizonCheckpointPayload = JSON.parse(
            cp.rawContent || '{}',
          );
          if (payload.status === 'success' && !payload.hasIncompleteCoverage) {
            return {
              lastSyncAt: new Date(payload.completedAt || cp.fetchedAt),
              isSuccess: true,
              hasIncompleteCoverage: false,
            };
          }
        } catch {
          // malformed fails closed
        }
      }
    }
  } catch {
    // failure fails closed
  }
  return { lastSyncAt: null, isSuccess: false, hasIncompleteCoverage: true };
}

/**
 * Retrieves the most recent successful sync timestamp for each Ticketmaster horizon from raw_ingests.
 * Filters strictly by checkpoint prefix to prevent large raw-ingest runs from pushing checkpoints
 * out of the query window. Verifies true success and complete coverage before accepting timestamps.
 */
export async function getHorizonSyncHistory(
  rawIngestRepo: IRawIngestRepository,
  tmSourceId?: string,
  states?: string[],
): Promise<Record<Exclude<SyncHorizon, 'full' | 'auto'>, Date | null>> {
  const result: Record<Exclude<SyncHorizon, 'full' | 'auto'>, Date | null> = {
    'near-term': null,
    'mid-term': null,
    'long-term': null,
  };

  if (!tmSourceId) return result;

  const horizons: Exclude<SyncHorizon, 'full' | 'auto'>[] = [
    'near-term',
    'mid-term',
    'long-term',
  ];

  try {
    // When states are specified, reuse existing state-level checkpoints as the source of truth.
    // Derive horizon freshness conservatively as the oldest (minimum) last-success timestamp
    // among all required states. A skipped refresh never makes existing data appear newer.
    if (states && states.length > 0) {
      const uniqueStates = Array.from(
        new Set(states.map((s) => s.trim().toUpperCase())),
      );

      let allCheckedFromStates = true;
      for (const h of horizons) {
        const stateHistories = await Promise.all(
          uniqueStates.map((stateCode) =>
            getStateSyncHistory(rawIngestRepo, tmSourceId, h, stateCode),
          ),
        );

        const hasAnyStateCheckpoints = stateHistories.some(
          (hist) => hist.lastSyncAt !== null,
        );

        if (hasAnyStateCheckpoints) {
          // If state checkpoints exist, all requested states must be completely successful
          const allSuccessful = stateHistories.every(
            (hist) =>
              hist.isSuccess && !hist.hasIncompleteCoverage && hist.lastSyncAt,
          );

          if (allSuccessful) {
            const timestamps = stateHistories.map((hist) =>
              hist.lastSyncAt!.getTime(),
            );
            result[h] = new Date(Math.min(...timestamps));
          } else {
            result[h] = null;
          }
        } else {
          allCheckedFromStates = false;
        }
      }

      if (allCheckedFromStates) {
        return result;
      }
    }

    // Fallback: Query raw_ingests with checkpoint URL prefix filter so partition event pages never crowd out checkpoints
    const checkpoints = await rawIngestRepo.listBySource(
      tmSourceId,
      500,
      'encore://sync-checkpoint/ticketmaster/',
    );
    const sorted = [...checkpoints].sort(
      (a, b) =>
        new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime(),
    );

    for (const h of horizons) {
      if (result[h] !== null) continue;

      const exactHorizonUrl = `encore://sync-checkpoint/ticketmaster/${h}`;
      for (const cp of sorted) {
        if (cp.sourceUrl === exactHorizonUrl) {
          try {
            const payload: HorizonCheckpointPayload = JSON.parse(
              cp.rawContent || '{}',
            );
            // Strict check: status must be 'success' AND coverage must NOT be incomplete
            if (
              payload.status === 'success' &&
              !payload.hasIncompleteCoverage
            ) {
              // If states are specified, ensure all requested states were completed
              if (states && states.length > 0) {
                const completed = Array.isArray(payload.statesCompleted)
                  ? payload.statesCompleted.map((s) => s.toUpperCase())
                  : [];
                const missingStates = states.filter(
                  (s) => !completed.includes(s.toUpperCase()),
                );
                if (missingStates.length > 0) {
                  // This checkpoint does not cover all requested states; keep looking
                  continue;
                }
              }
              result[h] = new Date(payload.completedAt || cp.fetchedAt);
              break;
            }
          } catch {
            // Malformed JSON checkpoint fails closed
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
 * Only records status: 'success' when coverage is genuinely completed without failures or budget limits.
 */
export async function recordHorizonCheckpoint(
  rawIngestRepo: IRawIngestRepository,
  tmSourceId: string,
  horizon: Exclude<SyncHorizon, 'auto'>,
  optionsOrDate?: HorizonCheckpointOptions | Date,
): Promise<void> {
  const opts: HorizonCheckpointOptions =
    optionsOrDate instanceof Date
      ? { fetchedAt: optionsOrDate }
      : (optionsOrDate ?? {});

  const fetchedAt = opts.fetchedAt ?? new Date();
  const status = opts.status ?? 'success';
  const hasIncompleteCoverage = opts.hasIncompleteCoverage ?? false;

  const horizonsToMark =
    horizon === 'full'
      ? (['near-term', 'mid-term', 'long-term'] as const)
      : [horizon];

  for (const h of horizonsToMark) {
    const sourceUrl = `encore://sync-checkpoint/ticketmaster/${h}`;
    const content = JSON.stringify({
      horizon: h,
      completedAt: fetchedAt.toISOString(),
      status,
      hasIncompleteCoverage,
      statesCompleted: opts.statesCompleted ?? [],
      statesIncomplete: opts.statesIncomplete ?? [],
      statesFailed: opts.statesFailed ?? [],
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
  } else if (options.persist && !options.rawIngestRepo) {
    assertSafeDatabaseTarget(
      supabaseUrl,
      false,
      'Multi-Source Sync CLI Runner',
    );
  }

  // Set up repositories based on persistence flag or test overrides
  const catalogRepo =
    options.persist && !options.rawIngestRepo
      ? new SupabaseCatalogRepository()
      : new MemoryCatalogRepository();
  const rawIngestRepo =
    options.rawIngestRepo ??
    (options.persist
      ? new SupabaseRawIngestRepository()
      : new MemoryRawIngestRepository());
  const candidateRepo =
    options.persist && !options.rawIngestRepo
      ? new SupabaseEventCandidateRepository()
      : new MemoryEventCandidateRepository();
  const sourceRepo =
    options.sourceRepo ??
    (options.persist && !options.rawIngestRepo
      ? new SupabaseSourceRepository()
      : new MemorySourceRepository());

  const includeTm =
    !options.sources || options.sources.includes('ticketmaster');
  const includeVenues = !options.sources || options.sources.includes('venues');
  const { startUtc, endUtc } = calculateHorizonDates(options.horizon);

  // Geographic coverage (defaults to priority ['CO'])
  const states =
    options.states && options.states.length > 0
      ? Array.from(new Set(options.states.map((s) => s.trim().toUpperCase())))
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

    const syncHistory = await getHorizonSyncHistory(
      rawIngestRepo,
      tmSource.id,
      states,
    );
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
        // If recovery is active and force is not set, check if this state is already fresh
        if (
          options.recoverMissed &&
          !options.force &&
          options.persist &&
          currentHorizon !== 'full'
        ) {
          try {
            const stateHist = await getStateSyncHistory(
              rawIngestRepo,
              tmSource.id,
              currentHorizon,
              state,
            );
            if (
              stateHist.isSuccess &&
              !stateHist.hasIncompleteCoverage &&
              stateHist.lastSyncAt
            ) {
              const ageMs = Date.now() - stateHist.lastSyncAt.getTime();
              const slaMs = HORIZON_SLA_MS[currentHorizon];
              if (ageMs < slaMs) {
                log(
                  `[SYNC RECOVERY] Region ${state} (${currentHorizon}) is already complete and fresh (synced ${Math.round(ageMs / 60000)}m ago). Skipping to preserve request budget for overdue/incomplete regions.`,
                );
                reports.push({
                  sourceName:
                    targetHorizons.length > 1 || currentHorizon !== 'near-term'
                      ? `Ticketmaster (${state} Region, ${currentHorizon})`
                      : `Ticketmaster (${state} Region)`,
                  sourceType: 'aggregator',
                  horizon: currentHorizon,
                  stateCode: state,
                  status: 'skipped',
                  eventsFetched: 0,
                  candidatesExtracted: 0,
                  canonicalCreated: 0,
                  canonicalMatched: 0,
                  soldOutCount: 0,
                  durationMs: 0,
                  hasIncompleteCoverage: false,
                  skippedFresh: true,
                });
                continue;
              }
            }
          } catch {
            // Proceed with sync if state check fails
          }
        }

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
            horizon: currentHorizon,
            stateCode: state,
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

          if (options.persist) {
            try {
              await recordStateCheckpoint(
                rawIngestRepo,
                tmSource.id,
                currentHorizon,
                state,
                {
                  status: 'partial',
                  hasIncompleteCoverage: true,
                },
              );
            } catch (err) {
              warn(
                `[SYNC] Failed to record state checkpoint for ${state} (${currentHorizon}):`,
                err,
              );
            }
          }
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
            horizon: currentHorizon,
            stateCode: state,
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

          if (options.persist) {
            try {
              await recordStateCheckpoint(
                rawIngestRepo,
                tmSource.id,
                currentHorizon,
                state,
                {
                  status: isPartial ? 'partial' : 'success',
                  hasIncompleteCoverage: isPartial,
                  eventsFetched: tmResult.rawIngestsFetched,
                  candidatesParsed: tmResult.candidatesParsed,
                  canonicalCreated: tmResult.canonicalEventsCreated,
                  canonicalMatched: tmResult.canonicalEventsMatched,
                },
              );
            } catch (err) {
              warn(
                `[SYNC] Failed to record state checkpoint for ${state} (${currentHorizon}):`,
                err,
              );
            }
          }
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
            horizon: currentHorizon,
            stateCode: state,
            status: 'failed',
            eventsFetched: 0,
            candidatesExtracted: 0,
            canonicalCreated: 0,
            canonicalMatched: 0,
            soldOutCount: 0,
            durationMs: Date.now() - tmStart,
            hasIncompleteCoverage: true,
            error: err instanceof Error ? err.message : String(err),
          });

          if (options.persist) {
            try {
              await recordStateCheckpoint(
                rawIngestRepo,
                tmSource.id,
                currentHorizon,
                state,
                {
                  status: 'failed',
                  hasIncompleteCoverage: true,
                },
              );
            } catch (cpErr) {
              warn(
                `[SYNC] Failed to record state checkpoint for ${state} (${currentHorizon}):`,
                cpErr,
              );
            }
          }
        }
      }

      // Record durable checkpoint for this horizon if persisted
      if (options.persist) {
        try {
          const currentHorizonReports = reports.filter(
            (r) => r.horizon === currentHorizon && r.stateCode,
          );
          const statesCompleted = states.filter((s) =>
            currentHorizonReports.some(
              (r) =>
                r.stateCode === s &&
                (r.status === 'success' || r.skippedFresh) &&
                !r.hasIncompleteCoverage,
            ),
          );
          const statesFailed = states.filter((s) =>
            currentHorizonReports.some(
              (r) => r.stateCode === s && r.status === 'failed',
            ),
          );
          const statesIncomplete = states.filter(
            (s) => !statesCompleted.includes(s) && !statesFailed.includes(s),
          );

          const isHorizonComplete =
            states.length > 0 && statesCompleted.length === states.length;

          // Derive conservative timestamp from state-level checkpoints for completed states.
          // A skipped refresh must never make existing concert data appear newer than it actually is.
          let conservativeFetchedAt: Date | undefined;
          if (isHorizonComplete) {
            try {
              const stateHistories = await Promise.all(
                statesCompleted.map((s) =>
                  getStateSyncHistory(
                    rawIngestRepo,
                    tmSource.id,
                    currentHorizon,
                    s,
                  ),
                ),
              );
              const validTimestamps = stateHistories
                .map((sh) => sh.lastSyncAt?.getTime())
                .filter((t): t is number => typeof t === 'number');
              if (validTimestamps.length > 0) {
                conservativeFetchedAt = new Date(Math.min(...validTimestamps));
              }
            } catch {
              // Fall back to default fetchedAt on error
            }
          }

          await recordHorizonCheckpoint(
            rawIngestRepo,
            tmSource.id,
            currentHorizon,
            {
              status: isHorizonComplete
                ? 'success'
                : statesFailed.length === states.length
                  ? 'failed'
                  : 'partial',
              hasIncompleteCoverage: !isHorizonComplete,
              statesCompleted,
              statesIncomplete,
              statesFailed,
              fetchedAt: conservativeFetchedAt,
            },
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
    if (
      favoriteArtists.length === 0 &&
      (options.live || (options.persist && !options.rawIngestRepo))
    ) {
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
      (r.status === 'skipped' && !r.skippedFresh) ||
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
  const isForce = args.includes('--force');

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
      `Mode: ${isLive ? 'LIVE' : 'FIXTURE PREVIEW'} | Persist: ${isPersist} | Horizon: ${horizon}${isForce ? ' | Force: true' : ''}`,
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
    force: isForce,
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
