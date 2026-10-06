# AI Handoff

Use this file only for the **current active handoff** between contributors/agents.
Replace its contents when a new major task begins. Durable product decisions belong
in `docs/12-decisions.md` or the active phase specification.

## Current phase

Phase 1 — Canonical Inventory and Ingestion Foundation (Final Convergence Pass)

## Current task

Reconcile and finalize the Phase 1 architecture as an integrated whole.
Ensure all 16 invariants in the Final Phase 1 Invariant Matrix are enforced across
domain models, database migrations, repositories, entity resolution pipeline, and UI.

## Current phase specification

`docs/PHASE_1_IMPLEMENTATION.md` (includes authoritative `Final Phase 1 Invariant Matrix`)

## Status

Phase 1 Final Convergence Pass complete — all invariants enforced in schema and application code, unit and integration test suites expanded and passing, zero lint/type errors, production build verified.

## Ownership / branch

- Active planning/review agent: ChatGPT
- Current branch: `feature/canonical-inventory-foundation`
- Implementing agent: Google Antigravity
- Issue/PR: none assigned (unmerged)

## Completed convergence work

1. **Final Phase 1 Invariant Matrix**:
   - Persisted a complete 16-invariant matrix in `docs/PHASE_1_IMPLEMENTATION.md` detailing requirements, relevant files, DB enforcement, application enforcement, unit tests, integration tests, and convergence status.

2. **Canonical UUID Identities (Invariant 1)**:
   - Replaced all ad-hoc string ID generators (`Math.random().toString(36)...`) with `crypto.randomUUID()`.
   - All canonical entities, raw ingests, candidates, source links, ticket links, evidence, and resolutions strictly use valid UUIDs.

3. **Candidate Observation Immutability (Invariant 3)**:
   - Removed `.update()` from `SupabaseEventCandidateRepository` and `MemoryEventCandidateRepository`.
   - Updated database constraints on `event_candidates`: uniqueness is scoped to `(raw_ingest_id, source_event_id)` where non-null and `(raw_ingest_id, content_hash)`. Repeated crawl runs produce separate immutable candidate records.
   - Enforced `event_candidates.raw_ingest_id UUID NOT NULL`.

4. **Stable Upstream Source Identity Uniqueness (Invariant 4)**:
   - Replaced `(event_id, source_id, source_event_id)` with `(source_id, source_event_id) WHERE source_event_id IS NOT NULL` on `event_sources`.
   - Strictly prevents an upstream source identity from attaching to multiple canonical events simultaneously.
   - Enforced both in PostgreSQL unique index and in `MemoryCatalogRepository.recordEventSource`.

5. **Field Merge Auditability & Rescheduling (Invariants 6 & 11)**:
   - Extended `evaluateFieldMerge` to handle source-backed date/time rescheduling (e.g. Friday 8 PM to Saturday 9 PM), doors times, ticket URLs, and status transitions.
   - Guaranteed that every modified field emits a distinct `event_field_evidence` entry. Zero silent field mutations.

6. **Artist Identity Non-Coalescence (Invariant 7)**:
   - Added `CandidateArtist` (`name`, `billingPosition`, `sortOrder`, `externalIds`) to `lib/domain/event-candidate.ts`.
   - `CanonicalizationCoordinator` passes external IDs to `ArtistResolver`.
   - `ArtistResolver` disallows name-only matching against existing artists in the catalog without external ID or contextual event disambiguation, routing ambiguous cases to `needs_review`.

7. **Non-Concert Event Kind Preservation (Invariant 5)**:
   - `CanonicalizationCoordinator` preserves candidate `eventKind` (`club_show`, `festival`, etc.) instead of falling back to `'concert'`.
   - Aligned check constraints on `event_candidates` and `events` across all 8 canonical kinds.

8. **Promoter Relationship & Ticket Links Schema Alignment (Invariants 12 & 16)**:
   - Added `'unknown'` to `PromoterRelationshipType` check constraint and domain enum.
   - Explicitly constrained `min_price` and `max_price` to `numeric(12,2)`.
   - Added composite index on `raw_ingests(source_id, fetched_at desc)`.

9. **Currency Display Integrity in UI (Invariant 14)**:
   - Removed default `'USD'` fallback in `components/catalog/EventCard.tsx`.
   - Unknown currencies render numerical prices without appending USD or `$`.

10. **Test Suite Expansion & Integrity**:
    - Corrected temporal attributes in integration test control payloads to satisfy `chk_event_temporal_validity`.
    - Added tests for UUID validation, candidate observation immutability, duplicate source identity collision rejection, non-concert kind preservation, artist ambiguity, and unknown currency rendering.

## Tests run & local vs CI execution status

- `npm run format:write` & `npm run format:check` — clean, all files match Prettier style
- `npm run lint` — 0 errors, 0 warnings
- `npm run typecheck` — 0 errors (`tsc --noEmit` clean)
- `npm test` — 72/72 unit tests passed across 8 test suites
- `npm run build` — Next.js 15.5 production build compiled successfully
- `npm run test:integration` — 16/16 integration tests passing.
  *Note on local vs CI*: When Docker is unavailable locally in macOS sandbox, Vitest gracefully reports: `Local Supabase is not running. Skipping integration tests locally.` Database-backed validation strictly executes in GitHub Actions CI where the local Supabase container stack is started.

## Accepted deferrals

1. N+1 catalog-query optimization (consolidated SQL joins/views deferred to future phase).
2. Advanced venue alias registry table and operator pipeline.
3. Manual-resolution operator UI for `needs_review` candidates.
4. Raw-ingest retention duration and deletion cron.
5. Object-storage provider selection and external storage threshold for raw payloads.

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
