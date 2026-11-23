import { describe, expect, it, vi } from 'vitest';
import {
  calculateHorizonDates,
  runMultiSourceSync,
  determineDueHorizons,
  getHorizonSyncHistory,
  recordHorizonCheckpoint,
  recordStateCheckpoint,
  getStateSyncHistory,
  HORIZON_SLA_MS,
} from '@/scripts/sync-all-sources';
import { MemoryRawIngestRepository } from '@/lib/repositories/memory-repositories';
import {
  assertLiveIngestionCanonicalization,
  assertLiveVerificationIdempotency,
  auditDatabaseRelations,
} from '@/scripts/verify-live-ingestion';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';

describe('Sync All Sources & Live Verification (PR #20 Remediations)', () => {
  describe('calculateHorizonDates', () => {
    it('calculates 14-day window for near-term horizon', () => {
      const { startUtc, endUtc } = calculateHorizonDates('near-term');
      const start = new Date(startUtc);
      const end = new Date(endUtc);
      const diffDays = Math.round(
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
      );
      expect(diffDays).toBe(14);
    });

    it('calculates 15-to-60-day window for mid-term horizon', () => {
      const { startUtc, endUtc } = calculateHorizonDates('mid-term');
      const start = new Date(startUtc);
      const end = new Date(endUtc);
      const now = new Date();
      const startDiff = Math.round(
        (start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      const endDiff = Math.round(
        (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      expect(startDiff).toBe(15);
      expect(endDiff).toBe(60);
    });

    it('calculates 61-to-365-day window for long-term horizon', () => {
      const { startUtc, endUtc } = calculateHorizonDates('long-term');
      const start = new Date(startUtc);
      const end = new Date(endUtc);
      const now = new Date();
      const startDiff = Math.round(
        (start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      const endDiff = Math.round(
        (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      expect(startDiff).toBe(61);
      expect(endDiff).toBe(365);
    });

    it('calculates 365-day baseline window for full horizon', () => {
      const { startUtc, endUtc } = calculateHorizonDates('full');
      const start = new Date(startUtc);
      const end = new Date(endUtc);
      const diffDays = Math.round(
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
      );
      expect(diffDays).toBe(365);
    });
  });

  describe('Configurable Geographic Coverage (Finding 6)', () => {
    it('defaults to priority Colorado region (CO) when states option is omitted', async () => {
      const result = await runMultiSourceSync({
        horizon: 'near-term',
        live: false,
        persist: false,
        sources: ['ticketmaster'],
        syncFavoriteArtists: false,
        syncFestivals: false,
      });

      expect(result.regionsCovered).toEqual(['CO']);
      expect(result.reports).toHaveLength(1);
      expect(result.reports[0].sourceName).toBe('Ticketmaster (CO Region)');
      expect(result.reports[0].status).toBe('success');
    });

    it('iterates through multiple specified states (CO, UT, WY, NM) in fixture mode', async () => {
      const result = await runMultiSourceSync({
        horizon: 'near-term',
        live: false,
        persist: false,
        states: ['CO', 'UT', 'WY', 'NM'],
        sources: ['ticketmaster'],
        syncFavoriteArtists: false,
        syncFestivals: false,
      });

      expect(result.regionsCovered).toEqual(['CO', 'UT', 'WY', 'NM']);
      expect(result.reports).toHaveLength(4);
      expect(result.reports.map((r) => r.sourceName)).toEqual([
        'Ticketmaster (CO Region)',
        'Ticketmaster (UT Region)',
        'Ticketmaster (WY Region)',
        'Ticketmaster (NM Region)',
      ]);
      expect(result.reports.every((r) => r.status === 'success')).toBe(true);
    });
  });

  describe('Nationwide Favorite Artists & Festivals (Finding 6)', () => {
    it('executes nationwide tour lookups for user favorite artists without state code restrictions', async () => {
      const result = await runMultiSourceSync({
        horizon: 'near-term',
        live: false,
        persist: false,
        states: ['CO'],
        sources: ['ticketmaster'],
        favoriteArtists: ['Khruangbin', 'LCD Soundsystem'],
        syncFavoriteArtists: true,
        syncFestivals: false,
      });

      expect(result.favoriteArtistsQueried).toEqual([
        'Khruangbin',
        'LCD Soundsystem',
      ]);
      const tourReports = result.reports.filter((r) =>
        r.sourceName.includes('Tour:'),
      );
      expect(tourReports).toHaveLength(2);
      expect(tourReports[0].sourceName).toBe('Ticketmaster (Tour: Khruangbin)');
      expect(tourReports[1].sourceName).toBe(
        'Ticketmaster (Tour: LCD Soundsystem)',
      );
    });

    it('queries major nationwide music festivals when enabled', async () => {
      const result = await runMultiSourceSync({
        horizon: 'near-term',
        live: false,
        persist: false,
        states: ['CO'],
        sources: ['ticketmaster'],
        syncFavoriteArtists: false,
        syncFestivals: true,
      });

      expect(result.festivalsQueried).toBe(true);
      const festivalReport = result.reports.find((r) =>
        r.sourceName.includes('Festivals'),
      );
      expect(festivalReport).toBeDefined();
      expect(festivalReport?.sourceName).toBe(
        'Ticketmaster (Nationwide Festivals)',
      );
    });
  });

  describe('Destination Safety & --allow-production-write', () => {
    it('throws error when --allow-production-write is combined with fixture mode', async () => {
      await expect(
        runMultiSourceSync({
          horizon: 'near-term',
          live: false,
          persist: false,
          allowProductionWrite: true,
        }),
      ).rejects.toThrow(
        'Cannot use --allow-production-write in fixture mode; must be used with --live.',
      );
    });

    it('rejects remote database URL when allowProductionWrite is false or unapproved', () => {
      // 1. Unapproved remote destination fails even with allowProductionWrite
      expect(() =>
        assertSafeDatabaseTarget(
          'https://unapproved-project.supabase.co',
          true,
          'Test Runner',
        ),
      ).toThrow(/not an approved local, development, or production instance/);

      // 2. Approved remote destination without allowProductionWrite fails
      process.env.ENCORE_APPROVED_PROD_HOSTS = 'my-prod-project.supabase.co';
      try {
        expect(() =>
          assertSafeDatabaseTarget(
            'https://my-prod-project.supabase.co',
            false,
            'Test Runner',
          ),
        ).toThrow(
          /Writing to remote or production databases requires deliberate authorization/,
        );
      } finally {
        delete process.env.ENCORE_APPROVED_PROD_HOSTS;
      }
    });

    it('permits remote database URL when allowProductionWrite is true AND host is approved', () => {
      process.env.ENCORE_APPROVED_PROD_HOSTS = 'my-prod-project.supabase.co';
      try {
        expect(() =>
          assertSafeDatabaseTarget(
            'https://my-prod-project.supabase.co',
            true,
            'Test Runner',
          ),
        ).not.toThrow();
      } finally {
        delete process.env.ENCORE_APPROVED_PROD_HOSTS;
      }
    });

    it('permits local development database URL without allowProductionWrite', () => {
      expect(() =>
        assertSafeDatabaseTarget(
          'http://127.0.0.1:54321',
          false,
          'Test Runner',
        ),
      ).not.toThrow();
      expect(() =>
        assertSafeDatabaseTarget(
          'http://localhost:54321',
          false,
          'Test Runner',
        ),
      ).not.toThrow();
    });
  });

  describe('Live Ingestion Canonicalization Assertions (Pass 1)', () => {
    it('passes when Pass 1 creates or matches canonical events for both providers', () => {
      expect(() =>
        assertLiveIngestionCanonicalization({
          pass1: {
            ticketmaster: {
              fetched: 1,
              candidates: 50,
              created: 45,
              matched: 5,
              needsReview: 0,
              reviewReasons: {},
              durationMs: 400,
            },
            z2: {
              fetched: 1,
              candidates: 25,
              created: 25,
              matched: 0,
              needsReview: 0,
              reviewReasons: {},
              durationMs: 350,
            },
          },
        }),
      ).not.toThrow();
    });

    it('throws when Ticketmaster Pass 1 creates 0 and matches 0 events despite having candidates', () => {
      expect(() =>
        assertLiveIngestionCanonicalization({
          pass1: {
            ticketmaster: {
              fetched: 1,
              candidates: 50,
              created: 0,
              matched: 0, // VIOLATION: canonicalization was not exercised!
              needsReview: 0,
              reviewReasons: {},
              durationMs: 400,
            },
            z2: {
              fetched: 1,
              candidates: 25,
              created: 25,
              matched: 0,
              needsReview: 0,
              reviewReasons: {},
              durationMs: 350,
            },
          },
        }),
      ).toThrow(
        /\[CANONICALIZATION FAILURE\] Ticketmaster Pass 1 processed 50 candidates but created 0 and matched 0 canonical events/,
      );
    });

    it('throws when Z2 Pass 1 creates 0 and matches 0 events despite having candidates', () => {
      expect(() =>
        assertLiveIngestionCanonicalization({
          pass1: {
            ticketmaster: {
              fetched: 1,
              candidates: 50,
              created: 50,
              matched: 0,
              needsReview: 0,
              reviewReasons: {},
              durationMs: 400,
            },
            z2: {
              fetched: 1,
              candidates: 25,
              created: 0,
              matched: 0, // VIOLATION
              needsReview: 0,
              reviewReasons: {},
              durationMs: 350,
            },
          },
        }),
      ).toThrow(
        /\[CANONICALIZATION FAILURE\] Z2 Entertainment Pass 1 processed 25 candidates but created 0 and matched 0 canonical events/,
      );
    });
  });

  describe('Live Verification Idempotency Assertions (Finding 5)', () => {
    it('passes when both providers create 0 events and match existing events on pass 2', () => {
      expect(() =>
        assertLiveVerificationIdempotency({
          pass2Idempotency: {
            ticketmaster: {
              fetched: 1,
              candidates: 50,
              created: 0,
              matched: 50,
              rawIngestsReused: 1,
              durationMs: 120,
            },
            z2: {
              fetched: 1,
              candidates: 23,
              created: 0,
              matched: 23,
              rawIngestsReused: 1,
              durationMs: 90,
            },
          },
        }),
      ).not.toThrow();
    });

    it('throws when Ticketmaster pass 2 creates duplicate canonical events', () => {
      expect(() =>
        assertLiveVerificationIdempotency({
          pass2Idempotency: {
            ticketmaster: {
              fetched: 1,
              candidates: 50,
              created: 2, // VIOLATION
              matched: 48,
              rawIngestsReused: 0,
              durationMs: 120,
            },
            z2: {
              fetched: 1,
              candidates: 23,
              created: 0,
              matched: 23,
              rawIngestsReused: 1,
              durationMs: 90,
            },
          },
        }),
      ).toThrow(
        '[IDEMPOTENCY FAILURE] Ticketmaster Pass 2 created 2 duplicate canonical events',
      );
    });

    it('throws when Z2 Entertainment pass 2 creates duplicate canonical events', () => {
      expect(() =>
        assertLiveVerificationIdempotency({
          pass2Idempotency: {
            ticketmaster: {
              fetched: 1,
              candidates: 50,
              created: 0,
              matched: 50,
              rawIngestsReused: 1,
              durationMs: 120,
            },
            z2: {
              fetched: 1,
              candidates: 23,
              created: 1, // VIOLATION
              matched: 22,
              rawIngestsReused: 0,
              durationMs: 90,
            },
          },
        }),
      ).toThrow(
        '[IDEMPOTENCY FAILURE] Z2 Entertainment Pass 2 created 1 duplicate canonical events',
      );
    });

    it('throws when pass 2 parses candidates but fails to match or reuse any records', () => {
      expect(() =>
        assertLiveVerificationIdempotency({
          pass2Idempotency: {
            ticketmaster: {
              fetched: 1,
              candidates: 10,
              created: 0,
              matched: 0, // VIOLATION (candidates parsed but 0 matched and 0 reused)
              rawIngestsReused: 0,
              durationMs: 120,
            },
            z2: {
              fetched: 1,
              candidates: 23,
              created: 0,
              matched: 23,
              rawIngestsReused: 1,
              durationMs: 90,
            },
          },
        }),
      ).toThrow(
        '[IDEMPOTENCY FAILURE] Ticketmaster Pass 2 processed 10 candidates but matched 0 canonical events and reused 0 raw ingests.',
      );
    });
  });

  describe('Database Relations Referential Integrity Audit (Finding 5)', () => {
    it('audits valid event_sources and canonical events without throwing', async () => {
      const mockAdminClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'event_sources') {
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'es-1',
                      event_id: 'ev-1',
                      source_id: 'src-1',
                      source_url: 'https://tm.com/1',
                    },
                    {
                      id: 'es-2',
                      event_id: 'ev-2',
                      source_id: 'src-2',
                      source_url: 'https://z2.com/2',
                    },
                  ],
                  error: null,
                }),
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [],
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'events') {
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    { id: 'ev-1', venue_id: 'ven-1', title: 'Concert 1' },
                    { id: 'ev-2', venue_id: 'ven-2', title: 'Concert 2' },
                  ],
                  error: null,
                }),
              }),
            };
          }
          return { select: vi.fn() };
        }),
      };

      const result = await auditDatabaseRelations(
        mockAdminClient as unknown as Parameters<
          typeof auditDatabaseRelations
        >[0],
        ['ev-1', 'ev-2'],
      );

      expect(result.verifiedRelationsCount).toBe(2);
      expect(result.orphanedEventSourcesCount).toBe(0);
      expect(result.missingEventsCount).toBe(0);
      expect(result.missingVenuesCount).toBe(0);
    });

    it('detects orphaned event_sources referencing missing canonical events and throws', async () => {
      const mockAdminClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'event_sources') {
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'es-orphan',
                      event_id: 'ev-missing',
                      source_id: 'src-1',
                    },
                  ],
                  error: null,
                }),
              }),
            };
          }
          if (table === 'events') {
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [], // ev-missing is NOT in events table!
                  error: null,
                }),
              }),
            };
          }
          return { select: vi.fn() };
        }),
      };

      await expect(
        auditDatabaseRelations(
          mockAdminClient as unknown as Parameters<
            typeof auditDatabaseRelations
          >[0],
          ['ev-missing'],
        ),
      ).rejects.toThrow(
        '[DATABASE INTEGRITY VIOLATION] Found 1 orphaned event_sources records and 1 missing canonical events.',
      );
    });
  });

  describe('Exit Codes & Machine-Readable Reporting (Finding 3)', () => {
    it('returns overallStatus: success and exitCode: 0 when all jobs complete successfully', async () => {
      const result = await runMultiSourceSync({
        horizon: 'near-term',
        live: false,
        persist: false,
        sources: ['ticketmaster'],
        syncFavoriteArtists: false,
        syncFestivals: false,
      });

      expect(result.overallStatus).toBe('success');
      expect(result.exitCode).toBe(0);
      expect(result.reports.every((r) => r.status === 'success')).toBe(true);
    });

    it('returns overallStatus: partial and exitCode: 2 when request budget limits execution', async () => {
      const result = await runMultiSourceSync({
        horizon: 'near-term',
        live: false,
        persist: false,
        sources: ['ticketmaster'],
        states: ['CO', 'UT'],
        syncFavoriteArtists: false,
        syncFestivals: false,
        maxRequestsPerRun: 1, // Only 1 request allowed; 2nd region will be partial/skipped
      });

      expect(result.overallStatus).toBe('partial');
      expect(result.exitCode).toBe(2);
      expect(result.reports[0].status).toBe('success');
      expect(result.reports[1].status).toBe('partial');
      expect(result.reports[1].hasIncompleteCoverage).toBe(true);
    });

    it('rejects invalid maxRequestsPerRun (<= 0, non-integer)', async () => {
      await expect(
        runMultiSourceSync({
          horizon: 'near-term',
          live: false,
          persist: false,
          maxRequestsPerRun: 0,
        }),
      ).rejects.toThrow(/positive integer/i);

      await expect(
        runMultiSourceSync({
          horizon: 'near-term',
          live: false,
          persist: false,
          maxRequestsPerRun: -10,
        }),
      ).rejects.toThrow(/positive integer/i);
    });

    it('suppresses stdout completely when silent: true is provided', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const result = await runMultiSourceSync({
          horizon: 'near-term',
          live: false,
          persist: false,
          sources: ['ticketmaster', 'venues'],
          states: ['CO'],
          syncFavoriteArtists: false,
          syncFestivals: false,
          silent: true,
        });

        expect(result.overallStatus).toBe('success');
        expect(logSpy).not.toHaveBeenCalled();
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe('Durable Missed-Run Recovery & Horizon SLA Coordination', () => {
    it('detects overdue mid-term horizon when elapsed time exceeds 96h SLA', () => {
      const now = new Date('2026-11-20T12:00:00Z');
      const syncHistory = {
        'near-term': new Date('2026-11-20T06:00:00Z'), // 6h ago (< 24h SLA)
        'mid-term': new Date('2026-11-15T12:00:00Z'), // 5 days ago (120h > 96h SLA) -> OVERDUE!
        'long-term': new Date('2026-11-18T10:00:00Z'), // 2 days ago (< 192h SLA)
      };

      const due = determineDueHorizons('near-term', syncHistory, now, true);
      expect(due).toEqual(['near-term', 'mid-term']);
    });

    it('returns only requested horizon when recoverMissed is false', () => {
      const now = new Date('2026-11-20T12:00:00Z');
      const syncHistory = {
        'near-term': new Date('2026-11-20T06:00:00Z'),
        'mid-term': new Date('2026-11-15T12:00:00Z'), // Overdue
        'long-term': null, // Overdue
      };

      const due = determineDueHorizons('near-term', syncHistory, now, false);
      expect(due).toEqual(['near-term']);
    });

    it('returns all overdue horizons when horizon: auto is requested', () => {
      const now = new Date('2026-11-20T12:00:00Z');
      const syncHistory = {
        'near-term': new Date('2026-11-19T00:00:00Z'), // 36h ago (> 24h SLA) -> Overdue
        'mid-term': new Date('2026-11-15T12:00:00Z'), // 120h ago (> 96h SLA) -> Overdue
        'long-term': new Date('2026-11-18T10:00:00Z'), // 48h ago (< 192h SLA) -> Fresh
      };

      const due = determineDueHorizons('auto', syncHistory, now);
      expect(due).toEqual(['near-term', 'mid-term']);
    });

    it('defaults to near-term when horizon: auto is requested and all horizons are fresh', () => {
      const now = new Date('2026-11-20T12:00:00Z');
      const syncHistory = {
        'near-term': new Date('2026-11-20T08:00:00Z'), // 4h ago
        'mid-term': new Date('2026-11-19T08:00:00Z'), // 28h ago
        'long-term': new Date('2026-11-18T10:00:00Z'), // 50h ago
      };

      const due = determineDueHorizons('auto', syncHistory, now);
      expect(due).toEqual(['near-term']);
    });

    it('records durable checkpoints and retrieves sync history from raw_ingests', async () => {
      const rawRepo = new MemoryRawIngestRepository();
      const tmSourceId = 'b0000000-0000-0000-0000-000000000003';

      // Initially empty
      const initialHistory = await getHorizonSyncHistory(rawRepo, tmSourceId);
      expect(initialHistory['near-term']).toBeNull();
      expect(initialHistory['mid-term']).toBeNull();
      expect(initialHistory['long-term']).toBeNull();

      // Record near-term checkpoint
      const t1 = new Date('2026-11-20T06:00:00Z');
      await recordHorizonCheckpoint(rawRepo, tmSourceId, 'near-term', t1);

      const history1 = await getHorizonSyncHistory(rawRepo, tmSourceId);
      expect(history1['near-term']?.toISOString()).toBe(t1.toISOString());
      expect(history1['mid-term']).toBeNull();

      // Record mid-term checkpoint
      const t2 = new Date('2026-11-20T08:00:00Z');
      await recordHorizonCheckpoint(rawRepo, tmSourceId, 'mid-term', t2);

      const history2 = await getHorizonSyncHistory(rawRepo, tmSourceId);
      expect(history2['near-term']?.toISOString()).toBe(t1.toISOString());
      expect(history2['mid-term']?.toISOString()).toBe(t2.toISOString());
      expect(history2['long-term']).toBeNull();

      // Record full checkpoint (marks all 3 horizons)
      const t3 = new Date('2026-11-20T10:00:00Z');
      await recordHorizonCheckpoint(rawRepo, tmSourceId, 'full', t3);

      const history3 = await getHorizonSyncHistory(rawRepo, tmSourceId);
      expect(history3['near-term']?.toISOString()).toBe(t3.toISOString());
      expect(history3['mid-term']?.toISOString()).toBe(t3.toISOString());
      expect(history3['long-term']?.toISOString()).toBe(t3.toISOString());
    });

    it('executes multi-horizon recovery cleanly in fixture mode', async () => {
      const result = await runMultiSourceSync({
        horizon: 'auto',
        live: false,
        persist: false,
        sources: ['ticketmaster'],
        states: ['CO'],
        syncFavoriteArtists: false,
        syncFestivals: false,
        silent: true,
      });

      expect(result.overallStatus).toBe('success');
      expect(result.exitCode).toBe(0);
      expect(result.horizonsExecuted).toBeDefined();
      expect(result.horizonsExecuted?.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Checkpoint False-Success & History Truncation Remediations (PR #20 Final Fixes)', () => {
    const tmSourceId = 'b0000000-0000-0000-0000-000000000003';

    it('does not recognize partial or incomplete horizon checkpoints as valid recovery history', async () => {
      const rawRepo = new MemoryRawIngestRepository();

      // Record a partial checkpoint with incomplete coverage
      await recordHorizonCheckpoint(rawRepo, tmSourceId, 'near-term', {
        status: 'partial',
        hasIncompleteCoverage: true,
        statesCompleted: ['CO'],
        statesIncomplete: ['UT'],
        statesFailed: [],
        fetchedAt: new Date('2026-11-20T10:00:00Z'),
      });

      const history = await getHorizonSyncHistory(rawRepo, tmSourceId);
      // Partial status must fail closed so overdue horizon remains eligible for recovery
      expect(history['near-term']).toBeNull();
    });

    it('does not recognize failed horizon checkpoints as valid recovery history', async () => {
      const rawRepo = new MemoryRawIngestRepository();

      // Record a failed checkpoint
      await recordHorizonCheckpoint(rawRepo, tmSourceId, 'mid-term', {
        status: 'failed',
        hasIncompleteCoverage: true,
        statesCompleted: [],
        statesFailed: ['CO', 'UT'],
        fetchedAt: new Date('2026-11-20T10:00:00Z'),
      });

      const history = await getHorizonSyncHistory(rawRepo, tmSourceId);
      expect(history['mid-term']).toBeNull();
    });

    it('fails closed on malformed checkpoint content', async () => {
      const rawRepo = new MemoryRawIngestRepository();

      await rawRepo.create({
        sourceId: tmSourceId,
        sourceUrl: 'encore://sync-checkpoint/ticketmaster/long-term',
        acquisitionMethod: 'api',
        fetchedAt: new Date('2026-11-20T10:00:00Z').toISOString(),
        contentHash: 'malformed_hash',
        contentType: 'application/json',
        rawContent: '{ corrupted: true, json: invalid ',
        externalStorageRef: null,
        httpStatus: 200,
        parserVersion: '1.0.0',
      });

      const history = await getHorizonSyncHistory(rawRepo, tmSourceId);
      expect(history['long-term']).toBeNull();
    });

    it('verifies all requested states are completed before accepting a horizon checkpoint', async () => {
      const rawRepo = new MemoryRawIngestRepository();
      const validDate = new Date('2026-11-20T12:00:00Z');

      // Checkpoint only completed CO
      await recordHorizonCheckpoint(rawRepo, tmSourceId, 'near-term', {
        status: 'success',
        hasIncompleteCoverage: false,
        statesCompleted: ['CO'],
        statesIncomplete: [],
        statesFailed: [],
        fetchedAt: validDate,
      });

      // Querying for only CO should accept this checkpoint
      const coHistory = await getHorizonSyncHistory(rawRepo, tmSourceId, [
        'CO',
      ]);
      expect(coHistory['near-term']?.toISOString()).toBe(
        validDate.toISOString(),
      );

      // Querying for CO and UT must reject this checkpoint because UT was not completed
      const multiStateHistory = await getHorizonSyncHistory(
        rawRepo,
        tmSourceId,
        ['CO', 'UT'],
      );
      expect(multiStateHistory['near-term']).toBeNull();
    });

    it('rejects checkpoints with empty statesCompleted when states are requested (prevents validation bypass)', async () => {
      const rawRepo = new MemoryRawIngestRepository();
      const validDate = new Date('2026-11-20T12:00:00Z');

      // Checkpoint with empty statesCompleted (e.g. legacy checkpoint or default empty array)
      await recordHorizonCheckpoint(rawRepo, tmSourceId, 'near-term', {
        status: 'success',
        hasIncompleteCoverage: false,
        statesCompleted: [],
        fetchedAt: validDate,
      });

      // Querying for ['CO'] must reject this checkpoint because CO was not completed
      const history = await getHorizonSyncHistory(rawRepo, tmSourceId, ['CO']);
      expect(history['near-term']).toBeNull();
    });

    it('prevents raw-ingest history truncation: retrieves checkpoint even with 150+ raw event pages ahead of it', async () => {
      const rawRepo = new MemoryRawIngestRepository();
      const checkpointDate = new Date('2026-11-20T08:00:00Z');

      // Record a valid near-term checkpoint
      await recordHorizonCheckpoint(rawRepo, tmSourceId, 'near-term', {
        status: 'success',
        hasIncompleteCoverage: false,
        statesCompleted: ['CO'],
        fetchedAt: checkpointDate,
      });

      // Now simulate a heavy ingestion run that creates 150 raw event ingests with newer timestamps
      for (let i = 0; i < 150; i++) {
        const fetchTime = new Date(checkpointDate.getTime() + (i + 1) * 1000);
        await rawRepo.create({
          sourceId: tmSourceId,
          sourceUrl: `https://app.ticketmaster.com/discovery/v2/events.json?stateCode=CO&page=${i}`,
          acquisitionMethod: 'api',
          fetchedAt: fetchTime.toISOString(),
          contentHash: `hash_${i}`,
          contentType: 'application/json',
          rawContent: JSON.stringify({
            _embedded: { events: [] },
            page: { number: i },
          }),
          externalStorageRef: null,
          httpStatus: 200,
          parserVersion: '1.0.0',
        });
      }

      // getHorizonSyncHistory must use the urlPrefix filter to bypass the 150 raw API ingests
      // and successfully find the checkpoint
      const history = await getHorizonSyncHistory(rawRepo, tmSourceId);
      expect(history['near-term']?.toISOString()).toBe(
        checkpointDate.toISOString(),
      );
    });

    it('records and queries state-level checkpoints independently', async () => {
      const rawRepo = new MemoryRawIngestRepository();
      const coDate = new Date('2026-11-20T09:00:00Z');
      const utDate = new Date('2026-11-20T09:15:00Z');

      await recordStateCheckpoint(rawRepo, tmSourceId, 'near-term', 'CO', {
        status: 'success',
        hasIncompleteCoverage: false,
        fetchedAt: coDate,
        eventsFetched: 42,
      });

      await recordStateCheckpoint(rawRepo, tmSourceId, 'near-term', 'UT', {
        status: 'failed',
        hasIncompleteCoverage: true,
        fetchedAt: utDate,
        eventsFetched: 0,
      });

      const coStatus = await getStateSyncHistory(
        rawRepo,
        tmSourceId,
        'near-term',
        'CO',
      );
      expect(coStatus.isSuccess).toBe(true);
      expect(coStatus.hasIncompleteCoverage).toBe(false);
      expect(coStatus.lastSyncAt?.toISOString()).toBe(coDate.toISOString());

      const utStatus = await getStateSyncHistory(
        rawRepo,
        tmSourceId,
        'near-term',
        'UT',
      );
      expect(utStatus.isSuccess).toBe(false);
      expect(utStatus.hasIncompleteCoverage).toBe(true);
      expect(utStatus.lastSyncAt).toBeNull();
    });

    it('fans out state checkpoints to near-term, mid-term, and long-term when horizon is full', async () => {
      const rawRepo = new MemoryRawIngestRepository();
      const date = new Date('2026-11-20T14:00:00Z');

      await recordStateCheckpoint(rawRepo, tmSourceId, 'full', 'CO', {
        status: 'success',
        hasIncompleteCoverage: false,
        fetchedAt: date,
      });

      const nearHist = await getStateSyncHistory(
        rawRepo,
        tmSourceId,
        'near-term',
        'CO',
      );
      const midHist = await getStateSyncHistory(
        rawRepo,
        tmSourceId,
        'mid-term',
        'CO',
      );
      const longHist = await getStateSyncHistory(
        rawRepo,
        tmSourceId,
        'long-term',
        'CO',
      );

      expect(nearHist.isSuccess).toBe(true);
      expect(nearHist.lastSyncAt?.toISOString()).toBe(date.toISOString());
      expect(midHist.isSuccess).toBe(true);
      expect(midHist.lastSyncAt?.toISOString()).toBe(date.toISOString());
      expect(longHist.isSuccess).toBe(true);
      expect(longHist.lastSyncAt?.toISOString()).toBe(date.toISOString());
    });

    it('deduplicates duplicate states passed to runMultiSourceSync', async () => {
      const result = await runMultiSourceSync({
        horizon: 'near-term',
        live: false,
        persist: false,
        states: ['CO', 'CO', 'co'],
        sources: ['ticketmaster'],
        syncFavoriteArtists: false,
        syncFestivals: false,
        silent: true,
      });

      expect(result.regionsCovered).toEqual(['CO']);
      expect(result.reports).toHaveLength(1);
    });

    it('skips fresh states and synchronizes overdue states in multi-state recovery run', async () => {
      const rawRepo = new MemoryRawIngestRepository();
      const tmSourceId = 'b0000000-0000-0000-0000-000000000003';

      // Pre-seed CO as already freshly synced
      await recordStateCheckpoint(rawRepo, tmSourceId, 'near-term', 'CO', {
        status: 'success',
        hasIncompleteCoverage: false,
        fetchedAt: new Date(),
        eventsFetched: 20,
      });

      // Run multi-source sync for CO and UT with recovery enabled
      const result = await runMultiSourceSync({
        horizon: 'near-term',
        live: false,
        persist: true,
        rawIngestRepo: rawRepo,
        states: ['CO', 'UT'],
        sources: ['ticketmaster'],
        syncFavoriteArtists: false,
        syncFestivals: false,
        recoverMissed: true,
        force: false,
        silent: true,
      });

      // CO should have been skipped as fresh
      const coReport = result.reports.find(
        (r) => r.stateCode === 'CO' && r.horizon === 'near-term',
      );
      expect(coReport).toBeDefined();
      expect(coReport?.status).toBe('skipped');
      expect(coReport?.skippedFresh).toBe(true);

      // UT should have been executed
      const utReport = result.reports.find(
        (r) => r.stateCode === 'UT' && r.horizon === 'near-term',
      );
      expect(utReport).toBeDefined();
      expect(utReport?.status).toBe('success');

      // Both states are now complete, so the horizon checkpoint should be recorded as success
      const horizonHistory = await getHorizonSyncHistory(rawRepo, tmSourceId, [
        'CO',
        'UT',
      ]);
      expect(horizonHistory['near-term']).not.toBeNull();
    });

    it('records partial status and leaves horizon uncheckpointed when run budget is exhausted', async () => {
      const rawRepo = new MemoryRawIngestRepository();
      const tmSourceId = 'b0000000-0000-0000-0000-000000000003';

      // Run with budget limit of 1 request across 2 states
      const result = await runMultiSourceSync({
        horizon: 'near-term',
        live: false,
        persist: true,
        rawIngestRepo: rawRepo,
        states: ['CO', 'UT'],
        sources: ['ticketmaster'],
        syncFavoriteArtists: false,
        syncFestivals: false,
        maxRequestsPerRun: 1,
        silent: true,
      });

      expect(result.overallStatus).toBe('partial');
      expect(result.exitCode).toBe(2);

      // Verify that the horizon was NOT checkpointed as successful
      const horizonHistory = await getHorizonSyncHistory(rawRepo, tmSourceId, [
        'CO',
        'UT',
      ]);
      expect(horizonHistory['near-term']).toBeNull();
    });

    it('preserves actual last-success timestamp on skipped refresh and never makes concert data appear newer', async () => {
      const rawRepo = new MemoryRawIngestRepository();
      const tmSourceId = 'b0000000-0000-0000-0000-000000000003';

      // Pre-seed CO with a timestamp from 4 hours ago
      const originalTime = new Date(Date.now() - 4 * 60 * 60 * 1000);
      await recordStateCheckpoint(rawRepo, tmSourceId, 'near-term', 'CO', {
        status: 'success',
        hasIncompleteCoverage: false,
        fetchedAt: originalTime,
        eventsFetched: 15,
      });

      // Run sync with recovery enabled (4h < 24h SLA -> state will be skipped)
      const result = await runMultiSourceSync({
        horizon: 'near-term',
        live: false,
        persist: true,
        rawIngestRepo: rawRepo,
        states: ['CO'],
        sources: ['ticketmaster'],
        syncFavoriteArtists: false,
        syncFestivals: false,
        recoverMissed: true,
        force: false,
        silent: true,
      });

      expect(result.reports[0].status).toBe('skipped');
      expect(result.reports[0].skippedFresh).toBe(true);

      // Verify state-level checkpoint retained the exact original timestamp
      const stateHistory = await getStateSyncHistory(
        rawRepo,
        tmSourceId,
        'near-term',
        'CO',
      );
      expect(stateHistory.lastSyncAt?.toISOString()).toBe(
        originalTime.toISOString(),
      );

      // Verify derived horizon freshness is bounded by the actual last-success timestamp
      const horizonHistory = await getHorizonSyncHistory(rawRepo, tmSourceId, [
        'CO',
      ]);
      expect(horizonHistory['near-term']?.toISOString()).toBe(
        originalTime.toISOString(),
      );
    });

    it('derives horizon freshness conservatively as the oldest last-success timestamp among mixed refreshed and skipped states', async () => {
      const rawRepo = new MemoryRawIngestRepository();
      const tmSourceId = 'b0000000-0000-0000-0000-000000000003';

      // CO was synced 6 hours ago (fresh for 24h SLA)
      const coSyncTime = new Date(Date.now() - 6 * 60 * 60 * 1000);
      await recordStateCheckpoint(rawRepo, tmSourceId, 'near-term', 'CO', {
        status: 'success',
        hasIncompleteCoverage: false,
        fetchedAt: coSyncTime,
        eventsFetched: 15,
      });

      // UT has never been synced (overdue)
      // Run sync for both CO and UT
      const runStartTime = new Date();
      const result = await runMultiSourceSync({
        horizon: 'near-term',
        live: false,
        persist: true,
        rawIngestRepo: rawRepo,
        states: ['CO', 'UT'],
        sources: ['ticketmaster'],
        syncFavoriteArtists: false,
        syncFestivals: false,
        recoverMissed: true,
        force: false,
        silent: true,
      });

      const coReport = result.reports.find((r) => r.stateCode === 'CO');
      const utReport = result.reports.find((r) => r.stateCode === 'UT');
      expect(coReport?.skippedFresh).toBe(true);
      expect(utReport?.status).toBe('success');

      // State-level checkpoints preserve their respective actual timestamps
      const coStateHist = await getStateSyncHistory(
        rawRepo,
        tmSourceId,
        'near-term',
        'CO',
      );
      const utStateHist = await getStateSyncHistory(
        rawRepo,
        tmSourceId,
        'near-term',
        'UT',
      );
      expect(coStateHist.lastSyncAt?.toISOString()).toBe(
        coSyncTime.toISOString(),
      );
      expect(utStateHist.lastSyncAt!.getTime()).toBeGreaterThanOrEqual(
        runStartTime.getTime(),
      );

      // Crucial assertion: Horizon freshness across CO and UT must be conservatively derived
      // from the OLDEST covered state (CO), NOT the newly refreshed UT timestamp!
      const horizonHistory = await getHorizonSyncHistory(rawRepo, tmSourceId, [
        'CO',
        'UT',
      ]);
      expect(horizonHistory['near-term']?.toISOString()).toBe(
        coSyncTime.toISOString(),
      );
    });
  });
});
