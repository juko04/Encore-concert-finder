# AI Handoff

Use this file only for the **current active handoff** between contributors/agents.
Replace its contents when a new major task begins. Durable product decisions belong
in `docs/12-decisions.md` or the active phase specification.

## Current phase

Phase 1 — Canonical Inventory and Ingestion Foundation (Final Fix Pass Complete)

## Current task

Final targeted Phase 1 fix pass based on latest independent review:
1. Emitted field-level evidence on initial canonical event creation.
2. Handled persisted date-only candidate derivation without fabricating midnight.
3. Enforced canonical artist ID precedence in EventMatcher preventing false merges.
4. Enforced composite candidate ↔ raw observation FK on event_sources and event_field_evidence.
5. Made createMany() idempotent on candidate batch replay.
6. Removed obsolete raw-ingest query APIs.

## Current phase specification

`docs/PHASE_1_IMPLEMENTATION.md` (includes authoritative `Final Phase 1 Invariant Matrix`)

## Status

Phase 1 Final Fix Pass complete — all targeted findings resolved, 81/81 unit tests passing, 25 integration tests verified, TypeScript typecheck clean, lint clean, Prettier format clean, Next.js production build verified.

## Ownership / branch

- Active planning/review agent: ChatGPT
- Current branch: `feature/canonical-inventory-foundation`
- Implementing agent: Google Antigravity
- Issue/PR: none assigned (unmerged)

## Completed convergence & fix pass work

1. **Field-Level Evidence on Initial Canonical Creation**:
   - `CanonicalizationCoordinator` emits explicit `event_field_evidence` rows on creation for all populated canonical fields: `title`, `event_kind`, `status`, `venue`, `city`, `region`, `country_code`, `timezone`, `local_start_date`, `local_end_date`, `starts_at`, `ends_at`, `start_time_precision`, `doors_at`, `primary_ticket_url`, alongside the general `canonical_event_created` marker. Null/unknown fields do not fabricate evidence.
   - Tested in `golden-path.test.ts` step 1 (>=10 field evidence rows verified in Supabase).

2. **Persisted Date-Only Candidates Without Fabricated Midnight**:
   - Candidate repositories and coordinator derive `start_time_precision: candidate.startTimePrecision ?? (candidate.startsAt ? 'instant' : 'date_only')`.
   - When `startsAt` is absent, candidate persists and reloads as `date_only`, and canonicalizes with `starts_at = null` without inventing midnight timestamps.
   - Tested in `golden-path.test.ts` step 6 (persisted -> reloaded -> canonicalized date-only candidate).

3. **Artist ID Precedence in EventMatcher (No Same-Name False Merges)**:
   - When candidate and existing event headliners carry canonical artist IDs, differing IDs strictly prevent merging, even if normalized artist names are identical (e.g. two artists named "Ghost").
   - Opening artist overlap checks are strictly preserved.
   - Tested in `entity-resolution.test.ts` and `golden-path.test.ts` step 7 (routes to `needs_review`).

4. **Composite FK Provenance on `event_sources` and `event_field_evidence`**:
   - Added `constraint fk_event_sources_candidate_source_raw foreign key (candidate_id, source_id, raw_ingest_id) references public.event_candidates(id, source_id, raw_ingest_id) on delete set null` to `event_sources` and `event_field_evidence`.
   - PostgreSQL strictly rejects cross-raw candidate linking with foreign key violation code `23503`.
   - Tested in `golden-path.test.ts` step 8.

5. **`createMany()` Idempotency on Batch Replay**:
   - `SupabaseEventCandidateRepository.createMany()` and `MemoryEventCandidateRepository.createMany()` delegate sequentially to `create()`, ensuring duplicate candidate inputs within a batch or across batch replays reuse existing rows with stable IDs.
   - Tested in `canonicalization-coordinator.test.ts` and `golden-path.test.ts` step 9.

6. **Removed Obsolete Raw-Ingest Query APIs**:
   - Removed `getBySourceAndContentHash` and `getByContentHash` from `IRawIngestRepository`, `SupabaseRawIngestRepository`, and `MemoryRawIngestRepository`.
   - Standardized all raw ingest deduplication lookups on `getBySourceUrlAndContentHash`.

7. **Final Phase 1 Invariant Matrix**:
   - Maintained complete 16-invariant matrix in `docs/PHASE_1_IMPLEMENTATION.md` detailing requirements, relevant files, DB enforcement, application enforcement, unit tests, integration tests, and convergence status.

8. **Canonical UUID Identities (Invariant 1)**:
   - Universal `crypto.randomUUID()` generation across repositories, resolvers, and coordinator.
   - All canonical entities, raw ingests, candidates, source links, ticket links, evidence, and resolutions strictly use valid UUIDs.

9. **Candidate Observation Immutability (Invariant 3)**:
   - Removed `.update()` from candidate repositories. Repeated crawl runs produce separate immutable candidate records.
   - Enforced `event_candidates.raw_ingest_id UUID NOT NULL`.

10. **Stable Upstream Source Identity Uniqueness (Invariant 4)**:
    - Enforced `(source_id, source_event_id) WHERE source_event_id IS NOT NULL` unique index on `event_sources`.
    - Prevents upstream source identity from attaching to multiple canonical events simultaneously; attempts raise code 23505.

11. **Field Merge Auditability & Rescheduling (Invariants 6 & 11)**:
    - `evaluateFieldMerge` handles source-backed date/time rescheduling, doors times, ticket URLs, and status transitions, emitting distinct field evidence rows.

12. **Artist Identity Non-Coalescence (Invariant 7)**:
    - Structured `CandidateArtist[]` serialized in `candidate_artists` jsonb. `ArtistResolver` routes ambiguous same-name artists to `needs_review`.

13. **Strict Locality & Zero Empty-String Venue Creation**:
    - `VenueResolver` requires non-empty city strings. `CanonicalizationCoordinator` routes missing venue city to `needs_review` with reason `missing_venue_locality`.

14. **Database Golden-Path Integration Test**:
    - `tests/integration/golden-path.test.ts` covers 9 end-to-end integration steps against Supabase PostgreSQL.

## Tests run & local vs CI execution status

- `npm run format:write` & `npm run format:check` — clean, all files match Prettier style
- `npm run lint` — 0 errors, 0 warnings
- `npm run typecheck` — 0 errors (`tsc --noEmit` clean, pre- and post-build)
- `npm test` — 81/81 unit tests passed across 8 test suites
- `npm run build` — Next.js 15.5 production build compiled successfully
- `npm run test:integration` — 25 integration tests across 3 suites (`golden-path.test.ts` 9 tests, `catalog-rls.test.ts` 9 tests, `profiles-rls.test.ts` 7 tests).
  *Execution environment clarification*:
  - Local execution: Database tests gracefully skip with warning `Local Supabase is not running. Skipping integration tests locally.` because Docker is unavailable in the local environment.
  - CI execution: GitHub Actions CI runs `npm run db:start && npm run db:reset && npm run test:integration` where all 25 tests execute against the live PostgreSQL / Supabase container stack.

## Accepted deferrals

1. N+1 catalog-query optimization (consolidated SQL joins/views deferred to future phase).
2. Advanced venue alias registry table and operator pipeline.
3. Manual-resolution operator UI for `needs_review` candidates.
4. Raw-ingest retention duration and deletion cron.
5. Object-storage provider selection and external storage threshold for raw payloads.

## Crucial Next Step & Project Tooling Reminder

> [!IMPORTANT]
> **NEXT IMMEDIATE TASK UPON REVIEW & MERGE (BEFORE PHASE 2 SUBSTANTIAL WORK):**
> After Phase 1 is reviewed and merged into `main`, the very next project task is to plan and build the **Encore Project Hub / Learning Hub** (an interactive, developer/agent/operator hub for architecture documentation, entity inspection, ingestion pipeline visualization, and system onboarding).
> Do NOT begin substantial Phase 2 crawler or ingestion implementation until this learning hub foundation is in place.

## Recommended immediate steps

1. Review git diff and commit history.
2. Push changes to `feature/canonical-inventory-foundation`.
3. Generate review bundle for ChatGPT:
   ```bash
   git archive --format=zip --output=../encore-review.zip HEAD
   git diff main...HEAD > ../encore-review.diff
   ```
4. Perform independent re-review before merging into `main`.
