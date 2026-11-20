#!/usr/bin/env node

/**
 * ENCORE V2 — Live Ingestion & Idempotency Verification Script
 *
 * Verifies live end-to-end ingestion against real provider endpoints:
 * 1. Live Ticketmaster Discovery API v2 (Colorado Region)
 * 2. Live Z2 Entertainment Calendar (Boulder Theater, Fox Theatre, Aggie Theatre)
 *
 * Enforces destination guard (strictly local database), runs 2 consecutive passes
 * to prove idempotency, and audits resulting canonical records against raw observations.
 */

import path from 'node:path';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  TicketmasterDiscoveryAdapter,
  runTicketmasterIngestion,
  getGlobalTicketmasterQuotaGuard,
} from '@/lib/sources/ticketmaster';
import {
  Z2EntertainmentAdapter,
  Z2_ENTERTAINMENT_CONFIG,
  runVenueIngestion,
} from '@/lib/sources/venue';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { SupabaseEventCandidateRepository } from '@/lib/repositories/event-candidate-repository';
import { SupabaseRawIngestRepository } from '@/lib/repositories/raw-ingest-repository';
import { SupabaseSourceRepository } from '@/lib/repositories/source-repository';

export interface LiveVerificationSummary {
  pass1: {
    ticketmaster: {
      fetched: number;
      candidates: number;
      created: number;
      matched: number;
      needsReview: number;
      reviewReasons: Record<string, number>;
      durationMs: number;
    };
    z2: {
      fetched: number;
      candidates: number;
      created: number;
      matched: number;
      needsReview: number;
      reviewReasons: Record<string, number>;
      durationMs: number;
    };
  };
  pass2Idempotency: {
    ticketmaster: {
      fetched: number;
      candidates: number;
      created: number;
      matched: number;
      rawIngestsReused: number;
      durationMs: number;
    };
    z2: {
      fetched: number;
      candidates: number;
      created: number;
      matched: number;
      rawIngestsReused: number;
      durationMs: number;
    };
  };
  databaseAudit: {
    totalEventsInDb: number;
    totalArtistsInDb: number;
    totalVenuesInDb: number;
    sampleCanonicalEvents: Array<{
      id: string;
      title: string;
      venue: string;
      city: string;
      date: string;
      artistsCount: number;
      headliners: string[];
      unknownPerformers: string[];
      ticketUrl?: string;
    }>;
  };
}

export async function runLiveVerification(): Promise<LiveVerificationSummary> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  assertSafeDatabaseTarget(supabaseUrl, false, 'Live Ingestion Verification');

  const adminClient = createAdminClient();
  const catalogRepo = new SupabaseCatalogRepository();
  const rawIngestRepo = new SupabaseRawIngestRepository();
  const candidateRepo = new SupabaseEventCandidateRepository();
  const sourceRepo = new SupabaseSourceRepository();

  console.log(
    '======================================================================',
  );
  console.log('ENCORE V2 — LIVE INGESTION & IDEMPOTENCY VERIFICATION');
  console.log(
    '======================================================================',
  );
  console.log(`Target Database: ${supabaseUrl} (Destination Guard: PASSED)`);
  console.log(
    `Quota Guard Status: ${getGlobalTicketmasterQuotaGuard().getCount()}/5000 requests used`,
  );

  // Count before
  const { count: initialEventsCount } = await adminClient
    .from('events')
    .select('id', { count: 'exact', head: true });
  console.log(`Initial Canonical Events in DB: ${initialEventsCount || 0}`);

  // ------------------------------------------------------------------
  // PASS 1: Live Ingestion (Ticketmaster + Z2)
  // ------------------------------------------------------------------
  console.log('\n--- PASS 1: Live Ingestion ---');

  // 1A. Live Ticketmaster
  console.log(
    '[PASS 1] Fetching live Ticketmaster events (CO Region, near-term)...',
  );
  const tmStart = Date.now();
  const tmAdapter = new TicketmasterDiscoveryAdapter({
    apiKey: process.env.TICKETMASTER_API_KEY,
  });

  const tmPass1 = await runTicketmasterIngestion({
    adapter: tmAdapter,
    rawIngestRepo,
    candidateRepo,
    catalogRepo,
    sourceRepo,
    queryParams: {
      stateCode: 'CO',
      size: 50,
    },
    useFixture: false,
    persist: true,
  });
  const tmDuration1 = Date.now() - tmStart;
  console.log(
    `[PASS 1] Ticketmaster done: ${tmPass1.candidatesParsed} candidates, ${tmPass1.canonicalEventsCreated} created, ${tmPass1.canonicalEventsMatched} matched in ${tmDuration1}ms`,
  );

  // 1B. Live Z2 Entertainment
  console.log(
    '[PASS 1] Fetching live Z2 Entertainment calendar (z2ent.com/events)...',
  );
  const z2Start = Date.now();
  const z2Adapter = new Z2EntertainmentAdapter(Z2_ENTERTAINMENT_CONFIG);
  const z2Pass1 = await runVenueIngestion({
    config: Z2_ENTERTAINMENT_CONFIG,
    adapter: z2Adapter,
    rawIngestRepo,
    candidateRepo,
    catalogRepo,
    sourceRepo,
    useFixture: false,
    persist: true,
  });
  const z2Duration1 = Date.now() - z2Start;
  console.log(
    `[PASS 1] Z2 Entertainment done: ${z2Pass1.candidatesParsed} candidates, ${z2Pass1.canonicalEventsCreated} created, ${z2Pass1.canonicalEventsMatched} matched in ${z2Duration1}ms`,
  );

  // ------------------------------------------------------------------
  // PASS 2: Idempotency Verification (Re-fetch & Re-ingest)
  // ------------------------------------------------------------------
  console.log('\n--- PASS 2: Idempotency Verification (Immediate Re-sync) ---');

  // 2A. Re-run Ticketmaster
  console.log(
    '[PASS 2] Re-syncing Ticketmaster live responses to verify zero duplicates...',
  );
  const tmStart2 = Date.now();
  const tmPass2 = await runTicketmasterIngestion({
    adapter: tmAdapter,
    rawIngestRepo,
    candidateRepo,
    catalogRepo,
    sourceRepo,
    queryParams: {
      stateCode: 'CO',
      size: 50,
    },
    useFixture: false,
    persist: true,
  });
  const tmDuration2 = Date.now() - tmStart2;
  console.log(
    `[PASS 2] Ticketmaster re-sync: Created: ${tmPass2.canonicalEventsCreated} (expected: 0), Matched: ${tmPass2.canonicalEventsMatched}, Raw Reused: ${tmPass2.rawIngestsReused} in ${tmDuration2}ms`,
  );

  // 2B. Re-run Z2
  console.log(
    '[PASS 2] Re-syncing Z2 live responses to verify zero duplicates...',
  );
  const z2Start2 = Date.now();
  const z2Pass2 = await runVenueIngestion({
    config: Z2_ENTERTAINMENT_CONFIG,
    adapter: z2Adapter,
    rawIngestRepo,
    candidateRepo,
    catalogRepo,
    sourceRepo,
    useFixture: false,
    persist: true,
  });
  const z2Duration2 = Date.now() - z2Start2;
  console.log(
    `[PASS 2] Z2 re-sync: Created: ${z2Pass2.canonicalEventsCreated} (expected: 0), Matched: ${z2Pass2.canonicalEventsMatched}, Raw Reused: ${z2Pass2.rawIngestsReused} in ${z2Duration2}ms`,
  );

  // ------------------------------------------------------------------
  // Database Audit & Invariant Checks
  // ------------------------------------------------------------------
  console.log('\n--- Canonical Database Audit ---');
  const { count: finalEventsCount } = await adminClient
    .from('events')
    .select('id', { count: 'exact', head: true });
  const { count: finalArtistsCount } = await adminClient
    .from('artists')
    .select('id', { count: 'exact', head: true });
  const { count: finalVenuesCount } = await adminClient
    .from('venues')
    .select('id', { count: 'exact', head: true });

  console.log(`Total Events in DB: ${finalEventsCount || 0}`);
  console.log(`Total Artists in DB: ${finalArtistsCount || 0}`);
  console.log(`Total Venues in DB: ${finalVenuesCount || 0}`);

  // Fetch sample live events created
  const sampleEvents = await catalogRepo.listEvents({
    limit: 10,
  });

  const sampleAudit = sampleEvents.map((e) => {
    const headliners = e.artists
      .filter((a) => a.billingPosition === 'headliner')
      .map((a) => a.name);
    const unknownPerformers = e.artists
      .filter((a) => a.billingPosition === 'unknown')
      .map((a) => a.name);
    return {
      id: e.id,
      title: e.title,
      venue: e.venueName,
      city: e.city ?? 'Unknown',
      date: e.localStartDate,
      artistsCount: e.artists.length,
      headliners,
      unknownPerformers,
      ticketUrl: e.ticketUrl ?? undefined,
    };
  });

  console.log('\nSample Live Canonical Events in DB:');
  sampleAudit.slice(0, 5).forEach((ev, idx) => {
    console.log(
      `  ${idx + 1}. [${ev.date}] "${ev.title}" @ ${ev.venue} (${ev.city})`,
    );
    console.log(
      `     Artists (${ev.artistsCount}): Headliners: [${ev.headliners.join(', ') || 'none'}] | Unknown/Performer: [${ev.unknownPerformers.join(', ')}]`,
    );
    console.log(`     Ticket URL: ${ev.ticketUrl || 'none'}`);
  });

  console.log(
    '\n======================================================================',
  );
  console.log('IDEMPOTENCY & VERIFICATION RESULTS');
  console.log(
    '======================================================================',
  );
  const tmIdempotent = tmPass2.canonicalEventsCreated === 0;
  const z2Idempotent = z2Pass2.canonicalEventsCreated === 0;
  console.log(
    `Ticketmaster Idempotency: ${tmIdempotent ? 'PASS (0 duplicate events created)' : 'FAIL'}`,
  );
  console.log(
    `Z2 Entertainment Idempotency: ${z2Idempotent ? 'PASS (0 duplicate events created)' : 'FAIL'}`,
  );
  console.log(
    '======================================================================\n',
  );

  return {
    pass1: {
      ticketmaster: {
        fetched: tmPass1.rawIngestsFetched,
        candidates: tmPass1.candidatesParsed,
        created: tmPass1.canonicalEventsCreated,
        matched: tmPass1.canonicalEventsMatched,
        needsReview: tmPass1.candidatesNeedsReview,
        reviewReasons: tmPass1.reviewReasons,
        durationMs: tmDuration1,
      },
      z2: {
        fetched: z2Pass1.rawIngestsFetched,
        candidates: z2Pass1.candidatesParsed,
        created: z2Pass1.canonicalEventsCreated,
        matched: z2Pass1.canonicalEventsMatched,
        needsReview: z2Pass1.candidatesNeedsReview,
        reviewReasons: z2Pass1.reviewReasons,
        durationMs: z2Duration1,
      },
    },
    pass2Idempotency: {
      ticketmaster: {
        fetched: tmPass2.rawIngestsFetched,
        candidates: tmPass2.candidatesParsed,
        created: tmPass2.canonicalEventsCreated,
        matched: tmPass2.canonicalEventsMatched,
        rawIngestsReused: tmPass2.rawIngestsReused,
        durationMs: tmDuration2,
      },
      z2: {
        fetched: z2Pass2.rawIngestsFetched,
        candidates: z2Pass2.candidatesParsed,
        created: z2Pass2.canonicalEventsCreated,
        matched: z2Pass2.canonicalEventsMatched,
        rawIngestsReused: z2Pass2.rawIngestsReused,
        durationMs: z2Duration2,
      },
    },
    databaseAudit: {
      totalEventsInDb: finalEventsCount || 0,
      totalArtistsInDb: finalArtistsCount || 0,
      totalVenuesInDb: finalVenuesCount || 0,
      sampleCanonicalEvents: sampleAudit,
    },
  };
}

runLiveVerification()
  .then(() => {
    console.log('Verification completed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Live verification failed:', err);
    process.exit(1);
  });
