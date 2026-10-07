# AI Handoff

Use this file only for the **current active handoff** between contributors/agents.
Replace its contents when a new major task begins. Durable product decisions belong
in `docs/12-decisions.md` or the active phase specification.

## Current phase

Phase 1 — Canonical Inventory and Ingestion Foundation (COMPLETE / Ready to Merge)

## Current task

Phase 1 Closeout — Handing off completed and independently reviewed Phase 1 for repository owner merge into `main`.

## Current phase specification

`docs/PHASE_1_IMPLEMENTATION.md` (includes authoritative `Final Phase 1 Invariant Matrix`)

## Status

Phase 1 is **COMPLETE and ready to merge**:
- Phase 1 pull request is **OPEN against `main`**
- Local unit tests: PASS (86/86 unit tests passing across 8 suites)
- Local integration tests: NOT RUN — Docker unavailable
- GitHub CI integration tests: **PASS — 21/21** (database-backed RLS and golden-path integration tests verified against live PostgreSQL stack in GitHub Actions)
- TypeScript typecheck: PASS (`tsc --noEmit` clean pre- and post-build)
- ESLint: PASS (0 errors, 0 warnings)
- Prettier format: PASS (`format:check` clean)
- Next.js production build: PASS
- Next immediate action: **Merge Phase 1 into `main`**

## Ownership / branch

- Active planning/review agent: ChatGPT
- Current branch: `feature/canonical-inventory-foundation`
- Implementing agent: Google Antigravity
- Issue/PR: Pull request open against `main` (unmerged)

## Completed CI closeout & convergence work

1. **Domain → RPC Snake-Case Payload Mapping (`mapEventUpdatesToCanonicalizationPayload`)**:
   - `CanonicalizationCoordinator` exports `mapEventUpdatesToCanonicalizationPayload` converting domain camelCase updates into snake_case PostgreSQL RPC keys (`local_start_date`, `starts_at`, etc.).
   - Explicit nulls are preserved; omitted/undefined properties are not fabricated as nulls.
   - Tested in `canonicalization-coordinator.test.ts` (3 unit tests) and exercised in `golden-path.test.ts`.

2. **Semantic Instant Equality & Non-Brittle Timezone Assertions**:
   - Compares `local_start_date` as `'2026-10-17'`, `timezone` as `'America/Denver'`, and `starts_at` semantically as an epoch timestamp (`new Date(updatedEvent.starts_at).getTime() === new Date(...).getTime()`), preventing timezone offset string mismatches.

3. **Artist External ID Precedence in `ArtistResolver`**:
   - External IDs are evaluated first. If an incoming observation carries an external ID that conflicts with the contextual artist's registered external IDs or points to a distinct artist, it returns `status: 'ambiguous'`, `reasons: ['conflicting_external_id_contextual_mismatch']`.
   - Tested in `entity-resolution.test.ts` (2 unit regression tests).

4. **Composite FK Delete Behavior (`ON DELETE RESTRICT`)**:
   - Changed composite FKs `fk_event_sources_candidate_source_raw` and `fk_event_field_evidence_candidate_source_raw` from `ON DELETE SET NULL` to `ON DELETE RESTRICT`, preventing PostgreSQL NOT NULL 23502 violations on `source_id`.

5. **Test Independence & CI Guard in `golden-path.test.ts`**:
   - Steps 1, 2, 3, 5 consolidated into single sequential `core golden path` test with local variables.
   - Step 8 creates an isolated `testEvent` instead of relying on earlier tests.
   - `ensureDbAvailable()` throws an Error in CI (`process.env.CI`), preventing silent test skips on pull requests.

6. **Field-Level Evidence on Initial Canonical Creation**:
   - `CanonicalizationCoordinator` emits explicit `event_field_evidence` rows on creation for all populated canonical fields: `title`, `event_kind`, `status`, `venue`, `city`, `region`, `country_code`, `timezone`, `local_start_date`, `local_end_date`, `starts_at`, `ends_at`, `start_time_precision`, `doors_at`, `primary_ticket_url`, alongside the general `canonical_event_created` marker. Null/unknown fields do not fabricate evidence.
   - Tested in `golden-path.test.ts` step 1 (>=10 field evidence rows verified in Supabase).

7. **Persisted Date-Only Candidates Without Fabricated Midnight**:
   - Candidate repositories and coordinator derive `start_time_precision: candidate.startTimePrecision ?? (candidate.startsAt ? 'instant' : 'date_only')`.
   - When `startsAt` is absent, candidate persists and reloads as `date_only`, and canonicalizes with `starts_at = null` without inventing midnight timestamps.
   - Tested in `golden-path.test.ts` step 6 (persisted -> reloaded -> canonicalized date-only candidate).

8. **Artist ID Precedence in EventMatcher (No Same-Name False Merges)**:
   - When candidate and existing event headliners carry canonical artist IDs, differing IDs strictly prevent merging, even if normalized artist names are identical (e.g. two artists named "Ghost").
   - Opening artist overlap checks are strictly preserved.
   - Tested in `entity-resolution.test.ts` and `golden-path.test.ts` step 7 (routes to `needs_review`).

9. **`createMany()` Idempotency on Batch Replay**:
   - `SupabaseEventCandidateRepository.createMany()` and `MemoryEventCandidateRepository.createMany()` delegate sequentially to `create()`, ensuring duplicate candidate inputs within a batch or across batch replays reuse existing rows with stable IDs.
   - Tested in `canonicalization-coordinator.test.ts` and `golden-path.test.ts` step 9.

10. **Final Phase 1 Invariant Matrix**:
    - Maintained complete 16-invariant matrix in `docs/PHASE_1_IMPLEMENTATION.md` detailing requirements, relevant files, DB enforcement, application enforcement, unit tests, integration tests, and convergence status.

## Tests run & local vs CI execution status

- `npm run format:write` & `npm run format:check` — clean, all files match Prettier style
- `npm run lint` — 0 errors, 0 warnings
- `npm run typecheck` — 0 errors (`tsc --noEmit` clean, pre- and post-build)
- `npm test` — 86/86 unit tests passed across 8 test suites
- `npm run build` — Next.js 15.5 production build compiled successfully
- `npm run test:integration` — 21 integration tests across 3 suites (`golden-path.test.ts` 5 tests, `catalog-rls.test.ts` 9 tests, `profiles-rls.test.ts` 7 tests).
  *Execution environment clarification*:
  - Local execution: `Local integration tests: NOT RUN — Docker unavailable` (tests gracefully skip when local Supabase container is not running).
  - CI execution: `GitHub CI integration tests: PASS — 21/21` (all 21 integration tests executed and passed against the live PostgreSQL / Supabase container stack in GitHub Actions).

## Accepted deferrals

1. N+1 catalog-query optimization (consolidated SQL joins/views deferred to future phase).
2. Advanced venue alias registry table and operator pipeline.
3. Manual-resolution operator UI for `needs_review` candidates.
4. Raw-ingest retention duration and deletion cron.
5. Object-storage provider selection and external storage threshold for raw payloads.

## Crucial Post-Phase-1 Sequence (Before Substantial Phase 2 Work)

> [!IMPORTANT]
> **EXPLICIT TASK SEQUENCE UPON MERGE:**
> After Phase 1 is merged into `main`, execute this explicit sequence before beginning substantial Phase 2 crawler or ingestion implementation:
>
> 1. **Repository & folder organization cleanup**
> 2. **AI-context & Markdown documentation optimization**
> 3. **Encore Project Hub / Learning Hub** (an interactive, developer/agent/operator hub for architecture documentation, entity inspection, ingestion pipeline visualization, and system onboarding)

### Non-blocking cleanup items to tackle in this post-Phase-1 task:

- Upgrade GitHub Actions versions producing the Node 20 runtime deprecation warning.
- Consider pinning the CI runner instead of relying indefinitely on `ubuntu-latest`.
- Ensure newly learned trusted artist external IDs can enrich already-matched canonical artists during entity resolution.
- Clean up Discover source attribution and unknown-venue display behavior in UI components.

## Recommended immediate steps

1. Repository owner merges the open Phase 1 pull request (`feature/canonical-inventory-foundation` into `main`).
2. Pull updated `main` locally and archive/clean up feature branch.
3. Begin the post-Phase-1 sequence starting with repository and documentation optimization.
