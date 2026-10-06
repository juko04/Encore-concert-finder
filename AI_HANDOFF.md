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
   - Added `'unknown'` to `PromoterRelationshipType` check constraint and domain enum; removed `'co_promoter'`.
   - Explicitly constrained `min_price` and `max_price` to `numeric(12,2)`.
   - Added composite index on `raw_ingests(source_id, fetched_at desc)`.

9. **Currency Display Integrity in UI (Invariant 14)**:
   - Removed default `'USD'` fallback in `components/catalog/EventCard.tsx`.
   - Unknown currencies render numerical prices without appending USD or `$`.

10. **Multi-Event Page Crawl & Raw URL Separation**:
    - `raw_ingests` compound unique constraint changed to `(source_id, source_url, content_hash)`. Identical payloads across different URLs persist cleanly.
    - Added `candidate_fingerprint text` to `event_candidates` and unique partial indexes on `(raw_ingest_id, source_event_id)` and `(raw_ingest_id, candidate_fingerprint)`. Multi-event page crawls persist distinct candidates under a single raw ingest without collisions.

11. **Candidate Artist Survival & External ID Round-Trip**:
    - Added `candidate_artists jsonb NOT NULL DEFAULT '[]'::jsonb` to `event_candidates`.
    - Repositories serialize `CandidateArtist[]` to/from JSONB, preserving structured artist data and external IDs from crawler adapter -> candidate table -> entity resolution -> `artist_external_ids`.

12. **Strict Locality & Zero Empty-String Venue Creation**:
    - `VenueResolver` requires non-empty city strings and throws on empty string.
    - `CanonicalizationCoordinator` detects missing or whitespace-only venue city and safely routes candidates to `needs_review` with reason `missing_venue_locality`. Zero empty-string venues are created.

13. **Upstream Source Event Reassignment Rejection**:
    - Stored procedure `apply_canonicalization` and repository enforce upstream stable identity immutability: attempting to reassign `(source_id, source_event_id)` to a different canonical event raises exception with SQLSTATE `23505`.

14. **Database Golden-Path Integration Test**:
    - Added `tests/integration/golden-path.test.ts` executing the complete real pipeline against Supabase: multi-event crawl page -> raw ingest -> distinct candidates -> canonicalization -> artist external IDs -> rescheduled observation -> immutable candidate observation -> field evidence accumulation without deleting historical evidence -> upstream identity conflict rejection (23505) -> raw ingest URL separation.

## Tests run & local vs CI execution status

- `npm run format:write` & `npm run format:check` — clean, all files match Prettier style
- `npm run lint` — 0 errors, 0 warnings
- `npm run typecheck` — 0 errors (`tsc --noEmit` clean, pre- and post-build)
- `npm test` — 79/79 unit tests passed across 8 test suites
- `npm run build` — Next.js 15.5 production build compiled successfully
- `npm run test:integration` — 21 integration tests across 3 suites (`golden-path.test.ts`, `catalog-rls.test.ts`, `profiles-rls.test.ts`).
  *Execution environment clarification*:
  - Local execution: Database tests gracefully skip with warning `Local Supabase is not running. Skipping integration tests locally.` because Docker is unavailable in the local environment.
  - CI execution: GitHub Actions CI runs `npm run db:start && npm run db:reset && npm run test:integration` where all 21 tests execute against the live PostgreSQL / Supabase container stack.

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
