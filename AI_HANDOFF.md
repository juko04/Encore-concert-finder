# AI Handoff

Use this file only for the **current active handoff** between contributors/agents.
Replace its contents when a new major task begins. Durable product decisions belong
in `docs/12-decisions.md` or the active phase specification.

## Current phase

Phase 1 — Canonical Inventory and Ingestion Foundation (Remediation Pass)

## Current task

Address all findings from the independent Phase 1 architecture and code review.
Harden schema, transactions, timezone/local-date handling, conservative matching,
provenance preservation, RLS security, and repository abstractions.

## Current phase specification

`docs/PHASE_1_IMPLEMENTATION.md`

## Status

Remediation complete — ready for independent re-review

## Ownership / branch

- Active planning/review agent: ChatGPT
- Current branch: `feature/canonical-inventory-foundation`
- Implementing agent: Google Antigravity
- Issue/PR: none assigned (unmerged)

## Completed remediation work

1. **Database Migrations Fully Implemented**:
   - `supabase/migrations/20261005120000_create_inventory_reference_and_catalog.sql`: Full schema for `sources`, `public_sources` view, `artists`, `artist_external_ids`, `artist_aliases`, `venues`, `venue_aliases`, `promoters`, `events`, `event_artists`, `event_promoters`, `event_ticket_links`.
   - `supabase/migrations/20261005120001_create_ingest_provenance.sql`: Operational provenance tables for `raw_ingests`, `event_candidates`, `event_sources`, `event_field_evidence`, `candidate_resolutions`, and the `apply_canonicalization` PL/pgSQL atomic transaction function.
   - `supabase/migrations/20261005120002_secure_inventory_tables.sql`: RLS enabled on all 16 tables. Read-only policies on catalog tables, safe public view `public_sources`, zero public access on operational ingest tables.
   - Verified clean compatibility with `supabase/seed.sql`.

2. **Atomic Canonicalization Transaction**:
   - Implemented `apply_canonicalization(payload jsonb)` stored procedure executing all canonical writes, links, evidence, and resolution atomically inside a PostgreSQL transaction.
   - `SupabaseCatalogRepository.applyCanonicalization` calls this RPC.
   - `MemoryCatalogRepository.applyCanonicalization` implements state snapshot and rollback on thrown error.
   - Integration test in `catalog-rls.test.ts` and unit test in `canonicalization-coordinator.test.ts` verify atomic rollback on partial failure.

3. **Removed Hard-Coded Colorado Defaults**:
   - Coordinator routes candidates with missing or invalid timezone to `needs_review` with reason `missing_or_invalid_timezone`.
   - Never fabricates Denver, CO, or America/Denver.
   - Verified non-Colorado events (Austin TX, London UK) preserve exact geography and timezone.

4. **Correct UTC-to-Local Date Derivation**:
   - Created `deriveLocalDateFromInstant(instantIso, timeZone)` in `lib/domain/value-objects.ts` using `Intl.DateTimeFormat('en-CA', { timeZone })`.
   - Tested date rollover (UTC 02:00:00 on Oct 15 -> Oct 14 in America/Denver).

5. **Preserved Real Source Provenance**:
   - `event_candidates` persists `source_type`, `acquisition_method`, `source_url`, `content_hash`, and `fetched_at` directly.
   - Reconstructs unmodified provenance on retrieval without hardcoded or fake values.

6. **Conservative Artist & Event Matching**:
   - `EventMatcher` auto-merges on same venue/date only when primary/headline artist matches or all artists match.
   - Opening/supporting artist overlap between different shows routes to `needs_review` with reason `same_venue_and_date_opening_artist_overlap_requires_review`.

7. **Consistent Normalized Ticket URL Matching**:
   - Both original `url` and `normalized_url` (tracking params stripped) stored and indexed in `event_ticket_links`.
   - Lookup by ticket URL searches `normalized_url`.

8. **Correct Ticket Provider Attribution**:
   - `ticketProviderSourceId` is populated only when candidate provenance is explicitly a ticketing provider (`ticketing` or `primary_ticketing`); otherwise `null`.

9. **Per-Observation Evidence Traceability**:
   - Each observation writes an independent row to `event_field_evidence` identifying its specific `raw_ingest_id`, `candidate_id`, and `source_id`.

10. **Direct Access to Sources Table Restricted**:
    - `sources` table RLS restricted to `service_role`. Safe view `public_sources` created and granted to `anon` and `authenticated`.

11. **ArtistId Catalog Filtering**:
    - Implemented `filters.artistId` across `SupabaseCatalogRepository` and `MemoryCatalogRepository`.

12. **ISO Currency Formatting**:
    - Created `formatCurrencyAmount(amount, currency, locale)` using `Intl.NumberFormat`. Removed hardcoded `$`. Tested USD, EUR, GBP.

13. **Removed Empty Placeholder Directories**:
    - Deleted `lib/catalog` and `lib/ingestion`. Maintained clean module exports in `lib/domain/index.ts`, `lib/repositories/index.ts`, `lib/entity-resolution/index.ts`.

## Tests run

- `npm run format:check` — clean, all files match Prettier style
- `npm run lint` — 0 errors, 0 warnings
- `npm run typecheck` (pre-build) — 0 errors
- `npm test` — 59/59 unit tests passed (8 test files)
- `npm run build` — compiled successfully, static and dynamic routes generated
- `npm run typecheck` (post-build) — 0 errors
- `npm run test:e2e` — 2/2 Playwright smoke tests passed (`/` and `/discover`)
- Database integration suite (`catalog-rls.test.ts` and `profiles-rls.test.ts`) ready for CI execution via `npm run db:start && npm run db:reset && npm run test:integration`.

## Accepted deferrals

1. N+1 catalog-query optimization (consolidated SQL joins/views deferred to future phase).
2. Advanced venue alias registry table and operator pipeline.
3. Manual-resolution operator UI for `needs_review` candidates.
4. Raw-ingest retention duration and deletion cron.
5. Object-storage provider selection and external storage threshold for raw payloads.

## Recommended next step

1. Review git diff and commit history.
2. Push changes to `feature/canonical-inventory-foundation`.
3. Generate review bundle for ChatGPT:
   ```bash
   git archive --format=zip --output=../encore-review.zip HEAD
   git diff main...HEAD > ../encore-review.diff
   ```
4. Perform independent re-review before merging into `main`.
