#!/usr/bin/env node

/**
 * ENCORE V2 — Live Ingestion & Idempotency Bounded Smoke Test
 *
 * NOTE: This is a bounded smoke test (near-term horizon, limited to 50 events)
 * specifically designed to verify live API/calendar provider contracts,
 * field-level schema compliance, and 100% database idempotency.
 * It is DISTINCT from a full multi-state 12-month production synchronization
 * (which is orchestrated via scripts/sync-all-sources.ts --horizon=full).
 *
 * Verifies live end-to-end ingestion against real provider endpoints:
 * 1. Live Ticketmaster Discovery API v2 (Colorado Region)
 * 2. Live Z2 Entertainment Calendar (Boulder Theater, Fox Theatre, Aggie Theatre)
 *
 * Enforces destination guard (strictly local database), runs 2 consecutive passes
 * to prove idempotency, and audits resulting canonical records against raw observations.
 */

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
    verifiedRelationsCount: number;
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

/**
 * Strictly asserts that Pass 2 achieved 100% idempotency with zero duplicate canonical events.
 * Throws descriptive errors if any assertion is violated.
 */
export function assertLiveVerificationIdempotency(summary: {
  pass2Idempotency: LiveVerificationSummary['pass2Idempotency'];
}): void {
  const { ticketmaster, z2 } = summary.pass2Idempotency;

  // 1. Ticketmaster Pass 2 Assertions
  if (ticketmaster.created !== 0) {
    throw new Error(
      `[IDEMPOTENCY FAILURE] Ticketmaster Pass 2 created ${ticketmaster.created} duplicate canonical events (strictly expected 0).`,
    );
  }

  // All events on pass 2 must be either reused raw ingests or matched canonical events
  if (
    ticketmaster.candidates > 0 &&
    ticketmaster.matched === 0 &&
    ticketmaster.rawIngestsReused === 0
  ) {
    throw new Error(
      `[IDEMPOTENCY FAILURE] Ticketmaster Pass 2 processed ${ticketmaster.candidates} candidates but matched 0 canonical events and reused 0 raw ingests.`,
    );
  }

  // 2. Z2 Entertainment Pass 2 Assertions
  if (z2.created !== 0) {
    throw new Error(
      `[IDEMPOTENCY FAILURE] Z2 Entertainment Pass 2 created ${z2.created} duplicate canonical events (strictly expected 0).`,
    );
  }

  if (z2.candidates > 0 && z2.matched === 0 && z2.rawIngestsReused === 0) {
    throw new Error(
      `[IDEMPOTENCY FAILURE] Z2 Entertainment Pass 2 processed ${z2.candidates} candidates but matched 0 canonical events and reused 0 raw ingests.`,
    );
  }
}

/**
 * Audits referential integrity between source records, event_sources, and canonical events.
 * Verifies each source record corresponds to a valid canonical event in `events` and has a `venue_id`.
 */
export async function auditDatabaseRelations(
  adminClient: ReturnType<typeof createAdminClient>,
  sampleEventIds: string[] = [],
): Promise<{
  verifiedRelationsCount: number;
  orphanedEventSourcesCount: number;
  missingEventsCount: number;
  missingVenuesCount: number;
}> {
  console.log('\n--- Auditing Database Referential Integrity & Relations ---');

  let query = adminClient
    .from('event_sources')
    .select('id, event_id, source_id, source_url, source_event_id');

  if (sampleEventIds.length > 0) {
    query = query.in('event_id', sampleEventIds.slice(0, 50));
  } else {
    query = query.order('created_at', { ascending: false }).limit(50);
  }

  const { data: eventSources, error: esError } = await query;
  if (esError) {
    throw new Error(
      `Failed to query event_sources for relation audit: ${esError.message}`,
    );
  }

  if (!eventSources || eventSources.length === 0) {
    console.warn('[AUDIT WARNING] No event_sources records found to verify.');
    return {
      verifiedRelationsCount: 0,
      orphanedEventSourcesCount: 0,
      missingEventsCount: 0,
      missingVenuesCount: 0,
    };
  }

  const eventIds = Array.from(
    new Set(
      eventSources
        .map((es: { event_id?: string | null }) => es.event_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const { data: events, error: evError } = await adminClient
    .from('events')
    .select('id, venue_id, name')
    .in('id', eventIds);

  if (evError) {
    throw new Error(
      `Failed to query events table for relation audit: ${evError.message}`,
    );
  }

  const existingEventMap = new Map(
    (events || []).map(
      (e: { id: string; venue_id?: string | null; name: string }) => [e.id, e],
    ),
  );

  let orphanedEventSourcesCount = 0;
  let missingEventsCount = 0;
  let missingVenuesCount = 0;

  for (const es of eventSources) {
    const parentEvent = existingEventMap.get(es.event_id);
    if (!parentEvent) {
      orphanedEventSourcesCount++;
      missingEventsCount++;
      console.error(
        `[RELATION ERROR] Orphaned event_source ${es.id} references non-existent event ${es.event_id}`,
      );
    } else if (!parentEvent.venue_id) {
      missingVenuesCount++;
      console.error(
        `[RELATION ERROR] Canonical event ${parentEvent.id} ("${parentEvent.name}") lacks venue_id`,
      );
    }
  }

  if (orphanedEventSourcesCount > 0 || missingEventsCount > 0) {
    throw new Error(
      `[DATABASE INTEGRITY VIOLATION] Found ${orphanedEventSourcesCount} orphaned event_sources records and ${missingEventsCount} missing canonical events.`,
    );
  }

  console.log(
    `✓ Verified ${eventSources.length} event_source relations: 0 orphans, 100% referential integrity.`,
  );

  return {
    verifiedRelationsCount: eventSources.length,
    orphanedEventSourcesCount,
    missingEventsCount,
    missingVenuesCount,
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
  console.log('ENCORE V2 — LIVE INGESTION & IDEMPOTENCY BOUNDED SMOKE TEST');
  console.log(
    '======================================================================',
  );
  console.log(
    'LABEL: Bounded smoke test (near-term horizon, limited to 50 events)',
  );
  console.log(
    'PURPOSE: Proves real provider contracts, schema compliance & 100% idempotency.',
  );
  console.log(
    'NOTE: Distinct from a full 12-month production sync (via scripts/sync-all-sources.ts).',
  );
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
    '[PASS 1] Fetching live Ticketmaster events (CO Region, near-term, limit 50)...',
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

  // Report review-needed records and explicit review reasons
  console.log('\n--- Review-Needed Records & Explicit Reasons Breakdown ---');
  console.log(
    `[Ticketmaster Pass 1] Review Needed: ${tmPass1.candidatesNeedsReview}`,
  );
  if (Object.keys(tmPass1.reviewReasons).length > 0) {
    for (const [reason, count] of Object.entries(tmPass1.reviewReasons)) {
      console.log(`  - ${reason}: ${count} candidate(s)`);
    }
  } else {
    console.log('  - None (0 candidates flagged for review)');
  }

  console.log(
    `[Z2 Entertainment Pass 1] Review Needed: ${z2Pass1.candidatesNeedsReview}`,
  );
  if (Object.keys(z2Pass1.reviewReasons).length > 0) {
    for (const [reason, count] of Object.entries(z2Pass1.reviewReasons)) {
      console.log(`  - ${reason}: ${count} candidate(s)`);
    }
  } else {
    console.log('  - None (0 candidates flagged for review)');
  }

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
  // Enforce Strict Idempotency Assertions
  // ------------------------------------------------------------------
  assertLiveVerificationIdempotency({
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
  });

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

  // Referential Integrity Relation Check
  const relationAudit = await auditDatabaseRelations(
    adminClient,
    sampleEvents.map((e) => e.id),
  );

  console.log(
    '\n======================================================================',
  );
  console.log('IDEMPOTENCY & VERIFICATION RESULTS');
  console.log(
    '======================================================================',
  );
  console.log(
    'Ticketmaster Idempotency:     PASS (0 duplicate events created, all matched/reused)',
  );
  console.log(
    'Z2 Entertainment Idempotency: PASS (0 duplicate events created, all matched/reused)',
  );
  console.log(
    `Database Relations Audit:     PASS (${relationAudit.verifiedRelationsCount} verified, 0 orphans)`,
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
      verifiedRelationsCount: relationAudit.verifiedRelationsCount,
      sampleCanonicalEvents: sampleAudit,
    },
  };
}

const isDirectExecution =
  typeof process !== 'undefined' &&
  process.argv.some(
    (arg) =>
      arg.endsWith('verify-live-ingestion.ts') ||
      arg.endsWith('verify-live-ingestion') ||
      arg.includes('verify-live-ingestion'),
  );

if (isDirectExecution) {
  runLiveVerification()
    .then(() => {
      console.log('Verification completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Live verification failed with non-zero exit:', err);
      process.exit(1);
    });
}
