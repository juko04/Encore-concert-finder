#!/usr/bin/env node

/**
 * Re-evaluates upcoming candidates that were held as needs_review ONLY because of the old strict
 * name-only artist rule (reason name_only_match_against_existing_artist_requires_external_id_disambiguation),
 * under the current rule (a unique same-name artist with no conflicting external id is accepted).
 * Candidates are immutable: nothing is edited. Each re-evaluation appends a new resolution row
 * (history is preserved) and, when accepted, creates/matches the canonical event atomically
 * through the coordinator. Dry run by default.
 *
 *   npm run reprocess:name-only            # dry run: reports what would happen
 *   npm run reprocess:name-only -- --persist
 */

import fs from 'node:fs';
import path from 'node:path';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { SupabaseEventCandidateRepository } from '@/lib/repositories/event-candidate-repository';
import { CanonicalizationCoordinator } from '@/lib/entity-resolution/canonicalization-coordinator';

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

const OLD_REASON =
  'name_only_match_against_existing_artist_requires_external_id_disambiguation';

async function main() {
  loadEnvLocal();
  const persist = process.argv.includes('--persist');
  assertSafeDatabaseTarget(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    false,
    'Name-only review reprocess',
  );
  const admin = createAdminClient();
  const catalog = new SupabaseCatalogRepository(admin as never);
  const candidates = new SupabaseEventCandidateRepository(admin as never);
  const coordinator = new CanonicalizationCoordinator(catalog);
  const today = new Date().toISOString().slice(0, 10);

  // Latest resolution per candidate is needs_review for the old reason.
  const held: Array<{ candidateId: string; title: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('candidate_resolutions')
      .select(
        'event_candidate_id, status, reasons, resolved_at, event_candidates!inner(title, local_start_date)',
      )
      .eq('status', 'needs_review')
      .gte('event_candidates.local_start_date', today)
      .order('resolved_at', { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const reasons = JSON.stringify(row.reasons ?? []);
      if (!reasons.includes(OLD_REASON)) continue;
      const cand = (row as unknown as { event_candidates: { title: string } })
        .event_candidates;
      held.push({
        candidateId: row.event_candidate_id as string,
        title: cand.title,
      });
    }
    if (!data || data.length < 1000) break;
  }
  const unique = Array.from(
    new Map(held.map((h) => [h.candidateId, h])).values(),
  );
  console.log(
    `Candidates held only by the old name-only rule (upcoming): ${unique.length}`,
  );

  const tally: Record<string, number> = {};
  for (const h of unique) {
    const cand = await candidates.getById(h.candidateId);
    if (!cand) continue;
    if (!persist) {
      tally.would_reevaluate = (tally.would_reevaluate ?? 0) + 1;
      continue;
    }
    try {
      // Skip when a later resolution already resolved it (created/matched).
      const latest = await catalog.findResolutionByCandidateId(h.candidateId);
      if (latest && latest.status !== 'needs_review') {
        tally.already_resolved = (tally.already_resolved ?? 0) + 1;
        continue;
      }
      const out = await coordinator.canonicalize(cand as never);
      tally[out.status] = (tally[out.status] ?? 0) + 1;
    } catch (err) {
      tally.error = (tally.error ?? 0) + 1;
      console.warn(`  ${h.title}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(JSON.stringify(tally));
  console.log(
    persist ? 'Done.' : 'Dry run only; re-run with --persist to write.',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
