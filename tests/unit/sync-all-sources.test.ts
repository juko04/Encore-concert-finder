import { describe, expect, it, vi } from 'vitest';
import {
  calculateHorizonDates,
  runMultiSourceSync,
} from '@/scripts/sync-all-sources';
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
});
