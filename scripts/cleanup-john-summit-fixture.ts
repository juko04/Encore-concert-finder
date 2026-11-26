#!/usr/bin/env node

/**
 * Cleanup Synthetic Fixture: John Summit
 *
 * Idempotently removes the synthetic concert fixture, raw ingests, event candidates,
 * and fixture associations, while strictly preserving genuine artists and venues.
 *
 * Invariants Preserved:
 * - Invariant 6: Strict Destination Guard (127.0.0.1 / localhost local Supabase only)
 * - Invariant 12: Isolation & Complete Removal of Synthetic Data with zero collateral damage
 *   to real catalog artists or venues.
 *
 * Usage:
 *   npx vite-node --config vitest.config.ts scripts/cleanup-john-summit-fixture.ts
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { loadEnvLocal } from '@/lib/utils/load-env-local';

export const SYNTHETIC_SOURCE_SLUG = 'synthetic_fixture_test_john_summit';
export const SYNTHETIC_EVENT_TITLE = 'TEST EVENT — John Summit (NOT REAL)';
export const SYNTHETIC_SOURCE_EVENT_ID = 'synthetic_john_summit_20261125';
export const SYNTHETIC_SOURCE_URL =
  'https://synthetic.encore.test/events/john-summit-20261125';

export interface CleanupResult {
  deletedEvents: number;
  deletedCandidates: number;
  deletedRawIngests: number;
  deletedSources: number;
}

function resolveSupabaseAdmin(): { client: SupabaseClient; url: string } {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required to clean up John Summit fixture.',
    );
  }

  // Invariant 6: Strict destination safety check
  assertSafeDatabaseTarget(url, false, 'cleanup-john-summit-fixture', true);

  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return { client, url };
}

/**
 * Idempotently removes the synthetic John Summit concert fixture and associated provenance records.
 * Adheres strictly to Invariant 12: Preserves canonical artists and venues without modification.
 */
export async function cleanupJohnSummitFixture(
  client?: SupabaseClient,
): Promise<CleanupResult> {
  const adminClient = client ?? resolveSupabaseAdmin().client;

  // 1. Resolve synthetic source ID if present
  const { data: sourceRow } = await adminClient
    .from('sources')
    .select('id')
    .eq('slug', SYNTHETIC_SOURCE_SLUG)
    .maybeSingle();

  const sourceId = sourceRow?.id;

  // 2. Identify all synthetic events by title or source association
  const syntheticEventIds = new Set<string>();

  const { data: eventsByTitle } = await adminClient
    .from('events')
    .select('id')
    .eq('name', SYNTHETIC_EVENT_TITLE);

  if (eventsByTitle) {
    for (const ev of eventsByTitle) {
      syntheticEventIds.add(ev.id);
    }
  }

  if (sourceId) {
    const { data: eventsBySource } = await adminClient
      .from('event_sources')
      .select('event_id')
      .eq('source_id', sourceId);

    if (eventsBySource) {
      for (const ev of eventsBySource) {
        syntheticEventIds.add(ev.event_id);
      }
    }
  }

  const eventIdList = Array.from(syntheticEventIds);

  // 3. Remove event_sources links (FK restrict protection before deleting candidates & raw ingests)
  if (eventIdList.length > 0) {
    await adminClient
      .from('event_sources')
      .delete()
      .in('event_id', eventIdList);
  }

  if (sourceId) {
    await adminClient.from('event_sources').delete().eq('source_id', sourceId);
  }

  // 4. Remove event_artists links
  if (eventIdList.length > 0) {
    await adminClient
      .from('event_artists')
      .delete()
      .in('event_id', eventIdList);

    await adminClient
      .from('event_ticket_links')
      .delete()
      .in('event_id', eventIdList);

    await adminClient
      .from('event_promoters')
      .delete()
      .in('event_id', eventIdList);

    await adminClient
      .from('event_field_evidence')
      .delete()
      .in('event_id', eventIdList);

    await adminClient
      .from('candidate_resolutions')
      .delete()
      .in('canonical_event_id', eventIdList);
  }

  // 5. Delete synthetic canonical events
  let deletedEvents = 0;
  if (eventIdList.length > 0) {
    const { error: evDelErr } = await adminClient
      .from('events')
      .delete()
      .in('id', eventIdList);

    if (evDelErr) {
      throw new Error(`Failed to delete synthetic events: ${evDelErr.message}`);
    }
    deletedEvents = eventIdList.length;
  }

  // Also clean up by title directly in case any unlinked synthetic event remains
  await adminClient.from('events').delete().eq('name', SYNTHETIC_EVENT_TITLE);

  // 6. Delete event_candidates
  let deletedCandidates = 0;
  if (sourceId) {
    const { error: candDelErr } = await adminClient
      .from('event_candidates')
      .delete()
      .eq('source_id', sourceId);

    if (candDelErr) {
      throw new Error(
        `Failed to delete synthetic event_candidates: ${candDelErr.message}`,
      );
    }
    deletedCandidates++;
  }

  await adminClient
    .from('event_candidates')
    .delete()
    .eq('source_event_id', SYNTHETIC_SOURCE_EVENT_ID);

  // 7. Delete raw_ingests
  let deletedRawIngests = 0;
  if (sourceId) {
    const { error: rawDelErr } = await adminClient
      .from('raw_ingests')
      .delete()
      .eq('source_id', sourceId);

    if (rawDelErr) {
      throw new Error(
        `Failed to delete synthetic raw_ingests: ${rawDelErr.message}`,
      );
    }
    deletedRawIngests++;
  }

  await adminClient
    .from('raw_ingests')
    .delete()
    .eq('source_url', SYNTHETIC_SOURCE_URL);

  // 8. Delete synthetic source
  let deletedSources = 0;
  if (sourceId) {
    const { error: srcDelErr } = await adminClient
      .from('sources')
      .delete()
      .eq('id', sourceId);

    if (srcDelErr) {
      throw new Error(
        `Failed to delete synthetic source: ${srcDelErr.message}`,
      );
    }
    deletedSources = 1;
  }

  // Invariant 12: Genuine artists and venues are strictly preserved.
  return {
    deletedEvents,
    deletedCandidates,
    deletedRawIngests,
    deletedSources,
  };
}

// CLI entrypoint
const isCliEntry =
  !process.env.VITEST &&
  !process.env.PLAYWRIGHT_TEST &&
  Boolean(process.argv[1]?.includes('cleanup-john-summit-fixture'));

if (isCliEntry) {
  cleanupJohnSummitFixture()
    .then((result) => {
      console.log('✓ Successfully cleaned up John Summit synthetic fixture:');
      console.log(`  Deleted Events:       ${result.deletedEvents}`);
      console.log(`  Deleted Candidates:   ${result.deletedCandidates}`);
      console.log(`  Deleted Raw Ingests:  ${result.deletedRawIngests}`);
      console.log(`  Deleted Sources:      ${result.deletedSources}`);
      console.log('  Canonical artists and venues strictly preserved.');
    })
    .catch((err) => {
      console.error('✗ Failed to clean up John Summit fixture:', err);
      process.exit(1);
    });
}
