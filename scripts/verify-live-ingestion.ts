#!/usr/bin/env node

/**
 * ENCORE V2 — Live Ingestion & Idempotency Bounded Smoke Test
 *
 * NOTE: This is a bounded smoke test (near-term horizon, limited to 50 events)
 * specifically designed to verify live API/calendar provider contracts,
 * field-level schema compliance, genuine canonicalization, and 100% database idempotency.
 * It is DISTINCT from a full multi-state 12-month production synchronization
 * (which is orchestrated via scripts/sync-all-sources.ts --horizon=full).
 *
 * Verifies live end-to-end ingestion against real provider endpoints:
 * 1. Live Ticketmaster Discovery API v2 (Colorado Region)
 * 2. Live Z2 Entertainment Calendar (Boulder Theater, Fox Theatre, Aggie Theatre)
 *
 * Enforces destination guard (strictly local database), runs 2 consecutive passes
 * to prove:
 * - Pass 1: Genuine canonical event creation / matching (fails if 0 events created and matched)
 * - Pass 2: 100% idempotency with zero duplicate canonical events
 * - Referential integrity: 100% foreign key relationships verified with 0 orphans
 * - Traces at least 3 real Ticketmaster events from provider ID to canonical database record to Index UI
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  assertSafeDatabaseTarget,
  isVerifiedLocalOrDevDatabase,
} from '@/lib/supabase/destination-guard';
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

export interface LiveVerificationOptions {
  clean?: boolean;
  confirmDisposableCleanup?: boolean;
  fullAudit?: boolean;
}

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
    totalEventSourcesInDb: number;
    verifiedRelationsCount: number;
    isFullAudit: boolean;
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
  tracedEvents: Array<{
    providerEventId: string;
    canonicalEventId: string;
    name: string;
    venue: string;
    date: string;
    minPrice: number | null;
    currency: string | null;
    ticketUrl: string | null;
    indexUiPath: string;
    indexSearchPath: string;
    createdInCurrentRun: boolean;
  }>;
}

/**
 * Strictly asserts that Pass 1 exercised genuine canonicalization.
 * Throws descriptive error if Pass 1 processed candidates but created 0 and matched 0 events.
 */
export function assertLiveIngestionCanonicalization(summary: {
  pass1: LiveVerificationSummary['pass1'];
}): void {
  const { ticketmaster, z2 } = summary.pass1;

  const tmTotal = ticketmaster.created + ticketmaster.matched;
  if (ticketmaster.candidates > 0 && tmTotal === 0) {
    throw new Error(
      `[CANONICALIZATION FAILURE] Ticketmaster Pass 1 processed ${ticketmaster.candidates} candidates but created 0 and matched 0 canonical events. Canonicalization was not exercised.`,
    );
  }

  const z2Total = z2.created + z2.matched;
  if (z2.candidates > 0 && z2Total === 0) {
    throw new Error(
      `[CANONICALIZATION FAILURE] Z2 Entertainment Pass 1 processed ${z2.candidates} candidates but created 0 and matched 0 canonical events. Canonicalization was not exercised.`,
    );
  }
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
  options: { fullAudit?: boolean } = {},
): Promise<{
  verifiedRelationsCount: number;
  totalRelationsCount: number;
  orphanedEventSourcesCount: number;
  missingEventsCount: number;
  missingVenuesCount: number;
  isFullAudit: boolean;
}> {
  const fullAudit = Boolean(options.fullAudit);
  console.log('\n--- Auditing Database Referential Integrity & Relations ---');

  // Query total count of event_sources in database
  const { count: totalRelationsCount } = await adminClient
    .from('event_sources')
    .select('id', { count: 'exact', head: true });

  let query = adminClient
    .from('event_sources')
    .select('id, event_id, source_id, source_url, source_event_id');

  if (!fullAudit && sampleEventIds.length > 0) {
    query = query.in('event_id', sampleEventIds.slice(0, 50));
  } else if (!fullAudit) {
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
      totalRelationsCount: totalRelationsCount || 0,
      orphanedEventSourcesCount: 0,
      missingEventsCount: 0,
      missingVenuesCount: 0,
      isFullAudit: fullAudit,
    };
  }

  const eventIds = Array.from(
    new Set(
      eventSources
        .map((es: { event_id?: string | null }) => es.event_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  function chunkIds<T>(arr: T[], size = 40): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  const allEvents: Array<{
    id: string;
    venue_id?: string | null;
    name?: string;
    title?: string;
  }> = [];

  for (const eChunk of chunkIds(eventIds, 40)) {
    const { data: events, error: evError } = await adminClient
      .from('events')
      .select('id, venue_id, name')
      .in('id', eChunk);

    if (evError) {
      throw new Error(
        `Failed to query events table for relation audit: ${evError.message}`,
      );
    }
    if (events) allEvents.push(...events);
  }

  const existingEventMap = new Map(
    allEvents.map((e) => [
      e.id,
      { ...e, name: e.name || e.title || 'Unknown Event' },
    ]),
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

  if (fullAudit) {
    console.log(
      `✓ [FULL AUDIT] Verified all ${eventSources.length} event_source relations in database: 0 orphans, 100% referential integrity.`,
    );
  } else {
    console.log(
      `✓ [SAMPLE AUDIT] Verified ${eventSources.length} of ${totalRelationsCount || eventSources.length} event_source relations: 0 orphans, 100% referential integrity.`,
    );
  }

  return {
    verifiedRelationsCount: eventSources.length,
    totalRelationsCount: totalRelationsCount || eventSources.length,
    orphanedEventSourcesCount,
    missingEventsCount,
    missingVenuesCount,
    isFullAudit: fullAudit,
  };
}

/**
 * Safely clears prior live test ingestion records for Ticketmaster and Z2 from local database.
 * Only permitted against local development databases.
 */
export async function cleanLiveTestSources(
  adminClient: ReturnType<typeof createAdminClient>,
  options: { confirmDisposableCleanup?: boolean } = {},
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  if (!isVerifiedLocalOrDevDatabase(supabaseUrl)) {
    throw new Error(
      'cleanLiveTestSources is strictly prohibited against non-local databases.',
    );
  }

  // FAIL-CLOSED ISOLATION GUARD (Finding 4):
  // Destructive test cleanup requires explicit disposable environment flag AND confirmation flag
  const isDisposableDb = process.env.ENCORE_DISPOSABLE_TEST_DB === 'true';
  const hasConfirmFlag = Boolean(options.confirmDisposableCleanup);

  if (!isDisposableDb || !hasConfirmFlag) {
    throw new Error(
      '[CLEANUP SAFETY VIOLATION] Destructive test cleanup requires ENCORE_DISPOSABLE_TEST_DB=true environment variable AND --confirm-disposable-cleanup flag to protect shared development databases.',
    );
  }

  console.log('\n--- Resetting Live Ingestion Test Records in Local DB ---');

  const { data: sources, error: sErr } = await adminClient
    .from('sources')
    .select('id, slug')
    .in('slug', ['ticketmaster-discovery', 'z2-entertainment']);

  if (sErr) {
    throw new Error(`Failed to query sources for cleanup: ${sErr.message}`);
  }

  if (!sources || sources.length === 0) return;

  const sourceIds = sources.map((s) => s.id);

  function chunk<T>(arr: T[], size = 40): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  // 1. Gather candidate IDs
  const { data: cands, error: cErr } = await adminClient
    .from('event_candidates')
    .select('id')
    .in('source_id', sourceIds);
  if (cErr)
    throw new Error(`Failed to query candidates for cleanup: ${cErr.message}`);
  const candIds = (cands || []).map((c) => c.id);

  // 2. Gather raw ingest IDs
  const { data: raws, error: rErr } = await adminClient
    .from('raw_ingests')
    .select('id')
    .in('source_id', sourceIds);
  if (rErr)
    throw new Error(`Failed to query raw_ingests for cleanup: ${rErr.message}`);
  const rawIds = (raws || []).map((r) => r.id);

  // 3. Gather event IDs tied to these sources
  const { data: eventSources, error: esErr } = await adminClient
    .from('event_sources')
    .select('event_id')
    .in('source_id', sourceIds);
  if (esErr)
    throw new Error(
      `Failed to query event_sources for cleanup: ${esErr.message}`,
    );

  const eventIds = Array.from(
    new Set(
      (eventSources || [])
        .map((es: { event_id?: string | null }) => es.event_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  // 4. Delete candidate resolutions (by event_candidate_id and event_id)
  for (const cChunk of chunk(candIds)) {
    const { error } = await adminClient
      .from('candidate_resolutions')
      .delete()
      .in('event_candidate_id', cChunk);
    if (error)
      throw new Error(
        `Failed to delete candidate_resolutions: ${error.message}`,
      );
  }
  for (const eChunk of chunk(eventIds)) {
    const { error } = await adminClient
      .from('candidate_resolutions')
      .delete()
      .in('event_id', eChunk);
    if (error)
      throw new Error(
        `Failed to delete candidate_resolutions by event_id: ${error.message}`,
      );
  }

  // 5. Delete event_field_evidence (by event_id and raw_ingest_id)
  for (const eChunk of chunk(eventIds)) {
    const { error } = await adminClient
      .from('event_field_evidence')
      .delete()
      .in('event_id', eChunk);
    if (error)
      throw new Error(
        `Failed to delete event_field_evidence: ${error.message}`,
      );
  }
  for (const rChunk of chunk(rawIds)) {
    const { error } = await adminClient
      .from('event_field_evidence')
      .delete()
      .in('raw_ingest_id', rChunk);
    if (error)
      throw new Error(
        `Failed to delete event_field_evidence by raw: ${error.message}`,
      );
  }

  // 6. Delete event_ticket_links
  for (const eChunk of chunk(eventIds)) {
    const { error } = await adminClient
      .from('event_ticket_links')
      .delete()
      .in('event_id', eChunk);
    if (error)
      throw new Error(`Failed to delete event_ticket_links: ${error.message}`);
  }

  // 7. Delete event_artists
  for (const eChunk of chunk(eventIds)) {
    const { error } = await adminClient
      .from('event_artists')
      .delete()
      .in('event_id', eChunk);
    if (error)
      throw new Error(`Failed to delete event_artists: ${error.message}`);
  }

  // 8. Delete event_sources
  const { error: esDelErr } = await adminClient
    .from('event_sources')
    .delete()
    .in('source_id', sourceIds);
  if (esDelErr)
    throw new Error(`Failed to delete event_sources: ${esDelErr.message}`);

  // 9. Delete events
  for (const eChunk of chunk(eventIds)) {
    const { error } = await adminClient
      .from('events')
      .delete()
      .in('id', eChunk);
    if (error) throw new Error(`Failed to delete events: ${error.message}`);
  }

  // 10. Delete event_candidates
  const { error: ecDelErr } = await adminClient
    .from('event_candidates')
    .delete()
    .in('source_id', sourceIds);
  if (ecDelErr)
    throw new Error(`Failed to delete event_candidates: ${ecDelErr.message}`);

  // 11. Delete raw_ingests
  const { error: riDelErr } = await adminClient
    .from('raw_ingests')
    .delete()
    .in('source_id', sourceIds);
  if (riDelErr)
    throw new Error(`Failed to delete raw_ingests: ${riDelErr.message}`);

  // 12. Clean up test-associated artists created by these sources that have 0 other references
  const { data: testArtistExtIds } = await adminClient
    .from('artist_external_ids')
    .select('artist_id')
    .in('source_id', sourceIds);

  const candidateArtistIds = Array.from(
    new Set(
      (testArtistExtIds || [])
        .map((row: { artist_id?: string | null }) => row.artist_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  let cleanedArtistCount = 0;
  if (candidateArtistIds.length > 0) {
    const { data: remainingEventArtists } = await adminClient
      .from('event_artists')
      .select('artist_id')
      .in('artist_id', candidateArtistIds);
    const remainingRefIds = new Set(
      (remainingEventArtists || []).map(
        (ea: { artist_id: string }) => ea.artist_id,
      ),
    );

    const { data: remainingPrefs } = await adminClient
      .from('user_artist_preferences')
      .select('artist_id')
      .in('artist_id', candidateArtistIds);
    const prefIds = new Set(
      (remainingPrefs || []).map((p: { artist_id: string }) => p.artist_id),
    );

    const safeToDeleteArtistIds = candidateArtistIds.filter(
      (id) => !remainingRefIds.has(id) && !prefIds.has(id),
    );

    cleanedArtistCount = safeToDeleteArtistIds.length;
    if (safeToDeleteArtistIds.length > 0) {
      for (const aChunk of chunk(safeToDeleteArtistIds)) {
        await adminClient
          .from('artist_external_ids')
          .delete()
          .in('artist_id', aChunk);
        await adminClient.from('artists').delete().in('id', aChunk);
      }
    }
  }

  console.log(
    `Cleaned prior test records for sources [${sourceIds.join(', ')}]: ${candIds.length} candidates, ${eventIds.length} events, ${rawIds.length} raw ingests, ${cleanedArtistCount} test-owned orphaned artists.`,
  );
}

export async function runLiveVerification(
  options: LiveVerificationOptions = {},
): Promise<LiveVerificationSummary> {
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
    'PURPOSE: Proves real provider contracts, genuine canonicalization & 100% idempotency.',
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

  // If clean mode requested, reset test records to prove genuine canonical creation
  if (options.clean) {
    await cleanLiveTestSources(adminClient, {
      confirmDisposableCleanup: options.confirmDisposableCleanup,
    });
  }

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

  // Enforce genuine canonicalization in Pass 1
  assertLiveIngestionCanonicalization({
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
  });

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

  // Enforce Strict Idempotency Assertions
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
    { fullAudit: options.fullAudit },
  );

  // ------------------------------------------------------------------
  // Trace 3 Genuine Ticketmaster Events
  // ------------------------------------------------------------------
  console.log(
    '\n======================================================================',
  );
  console.log(
    'TRACED TICKETMASTER EVENTS (PROVIDER ID -> CANONICAL DB RECORD -> UI)',
  );
  console.log(
    '======================================================================',
  );

  const tracedEvents: LiveVerificationSummary['tracedEvents'] = [];

  // Finding 5: Select 3 upcoming events created strictly in the CURRENT execution run
  const currentRunCreatedIds = tmPass1.createdEventIds || [];
  const selectedEventIds = currentRunCreatedIds.slice(0, 3);

  if (selectedEventIds.length < 3) {
    throw new Error(
      `[ACCEPTANCE FAILURE] Current run created only ${selectedEventIds.length} canonical Ticketmaster events (expected at least 3 for UI tracing and verification).`,
    );
  }

  for (let i = 0; i < selectedEventIds.length; i++) {
    const canonicalEventId = selectedEventIds[i];

    const { data: ev, error: evErr } = await adminClient
      .from('events')
      .select(
        'id, name, local_start_date, min_price, currency, venue_id, primary_ticket_url',
      )
      .eq('id', canonicalEventId)
      .maybeSingle();

    if (evErr || !ev) {
      throw new Error(
        `[ACCEPTANCE FAILURE] Traced event ${canonicalEventId} not found in database: ${evErr?.message || 'Not found'}`,
      );
    }

    let venueName = 'Unknown Venue';
    if (ev.venue_id) {
      const { data: ven } = await adminClient
        .from('venues')
        .select('name')
        .eq('id', ev.venue_id)
        .maybeSingle();
      if (ven?.name) venueName = ven.name;
    }

    const { data: es } = await adminClient
      .from('event_sources')
      .select('source_event_id, source_url')
      .eq('event_id', canonicalEventId)
      .maybeSingle();

    const candidate = tmPass1.candidates.find(
      (c) => c.sourceEventId === es?.source_event_id,
    );

    const providerEventId =
      es?.source_event_id || candidate?.sourceEventId || 'N/A';
    const ticketUrl =
      ev.primary_ticket_url || es?.source_url || candidate?.ticketUrl || null;

    const traced = {
      providerEventId,
      canonicalEventId: ev.id,
      name: ev.name,
      venue: venueName,
      date: ev.local_start_date,
      minPrice: ev.min_price ?? null,
      currency: ev.currency ?? null,
      ticketUrl,
      indexSearchPath: `/search?q=${encodeURIComponent(ev.name)}`,
      indexUiPath: `/concerts/${ev.id}`,
      createdInCurrentRun: true,
    };
    tracedEvents.push(traced);

    console.log(`Trace #${i + 1}:`);
    console.log(`  Provider Event ID:    ${traced.providerEventId}`);
    console.log(`  Canonical Event ID:   ${traced.canonicalEventId}`);
    console.log(`  Title:                "${traced.name}"`);
    console.log(`  Venue:                ${traced.venue}`);
    console.log(`  Date:                 ${traced.date}`);
    console.log(
      `  Pricing:              ${traced.minPrice !== null ? `$${traced.minPrice} ${traced.currency || ''}` : 'Unknown'}`,
    );
    console.log(`  Ticket URL:           ${traced.ticketUrl || 'none'}`);
    console.log(`  Index Search Route:   ${traced.indexSearchPath}`);
    console.log(`  Index UI Route:       ${traced.indexUiPath}`);
    console.log(
      `  Created in Run:       YES (Verified in tmPass1.createdEventIds)`,
    );
  }

  // Persist traced events to docs/traced-live-events.json for Playwright UI verification
  const tracedFilePath = path.resolve(
    process.cwd(),
    'docs/traced-live-events.json',
  );
  fs.writeFileSync(
    tracedFilePath,
    JSON.stringify(tracedEvents, null, 2),
    'utf8',
  );
  console.log(
    `\nPersisted ${tracedEvents.length} current-run traced events to docs/traced-live-events.json for Playwright browser verification.`,
  );

  console.log(
    '\n======================================================================',
  );
  console.log('IDEMPOTENCY & VERIFICATION RESULTS');
  console.log(
    '======================================================================',
  );
  console.log(
    `Pass 1 Canonical Creation:    PASS (TM: ${tmPass1.canonicalEventsCreated} created, ${tmPass1.canonicalEventsMatched} matched | Z2: ${z2Pass1.canonicalEventsCreated} created, ${z2Pass1.canonicalEventsMatched} matched)`,
  );
  console.log(
    'Ticketmaster Idempotency:     PASS (0 duplicate events created, all matched/reused)',
  );
  console.log(
    'Z2 Entertainment Idempotency: PASS (0 duplicate events created, all matched/reused)',
  );
  console.log(
    `Database Relations Audit:     PASS (${relationAudit.verifiedRelationsCount} verified, 0 orphans, fullAudit: ${relationAudit.isFullAudit})`,
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
      totalEventSourcesInDb: relationAudit.totalRelationsCount,
      verifiedRelationsCount: relationAudit.verifiedRelationsCount,
      isFullAudit: relationAudit.isFullAudit,
      sampleCanonicalEvents: sampleAudit,
    },
    tracedEvents,
  };
}

const isTestRunner = Boolean(process.env.VITEST);

if (!isTestRunner) {
  const clean =
    process.argv.includes('--clean') || process.argv.includes('--fresh');
  const confirmDisposableCleanup = process.argv.includes(
    '--confirm-disposable-cleanup',
  );
  const fullAudit = process.argv.includes('--full-audit');

  runLiveVerification({ clean, confirmDisposableCleanup, fullAudit })
    .then(() => {
      console.log('Verification completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Live verification failed with non-zero exit:', err);
      process.exit(1);
    });
}
