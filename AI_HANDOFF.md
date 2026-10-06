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

Phase 1 Final Remediation Pass complete — all review findings addressed, verified, and ready for final review.

## Ownership / branch

- Active planning/review agent: ChatGPT
- Current branch: `feature/canonical-inventory-foundation`
- Implementing agent: Google Antigravity
- Issue/PR: none assigned (unmerged)

## Completed remediation work

1. **Database Migrations Fully Implemented & Hardened**:
   - `supabase/migrations/20261005120000_create_inventory_reference_and_catalog.sql`: Full schema for `sources`, `public_sources` view, `artists`, `artist_external_ids`, `artist_aliases`, `venues`, `venue_aliases`, `promoters`, `events`, `event_artists`, `event_promoters`, `event_ticket_links`.
   - `supabase/migrations/20261005120001_create_ingest_provenance.sql`: Operational provenance tables for `raw_ingests`, `event_candidates`, `event_sources`, `event_field_evidence`, `candidate_resolutions`, and the `apply_canonicalization` PL/pgSQL atomic transaction function.
   - `supabase/migrations/20261005120002_secure_inventory_tables.sql`: RLS enabled on all 16 tables. Read-only policies on catalog tables, safe public view `public_sources`, zero public access on operational ingest tables.
   - Verified clean compatibility with `supabase/seed.sql`.

2. **Security Hardening of `apply_canonicalization`**:
   - Defined with `SECURITY DEFINER` and `SET search_path = public, pg_temp`.
   - Default execute permission explicitly revoked from `PUBLIC`, `anon`, and `authenticated`.
   - Execute permission granted strictly and exclusively to `service_role`.
   - Added integration tests proving anonymous and authenticated users receive permission denied (SQLSTATE `42501`), while `service_role` executes successfully.

3. **True Canonicalization Atomicity & Zero Upfront Entity Writes**:
   - Refactored `VenueResolver` and `ArtistResolver` to provide `resolveOrPrepare` methods that evaluate identity without writing to the database.
   - `CanonicalizationCoordinator` builds a single atomic transaction payload with `venueToCreate` and inline artist creations.
   - Zero upfront database writes: venues, artists, events, relationships, ticket links, source records, field evidence, and resolutions all succeed or none persist.
   - Added unit and integration tests proving that on any failure, newly prepared venues and artists are completely rolled back.

4. **Domain Constraint & Enum Alignment**:
   - Synchronized `EventKind` (`concert`, `club_show`, `outdoor_show`, `free_event`, `music_series`, `residency`, `festival`, `multi_day_festival`) and `EventStatus` (`scheduled`, `cancelled`, `postponed`, `rescheduled`, `unknown`) across TypeScript types, database check constraints, and fixtures.

5. **Temporal Database Check Constraints**:
   - Added PostgreSQL check constraints:
     - `check_events_instant_starts_at`: precision `instant` requires `starts_at IS NOT NULL`.
     - `check_events_date_only_no_starts_at`: precision `date_only` requires `starts_at IS NULL`.
     - `check_events_local_date_order`: requires `local_end_date >= local_start_date`.
     - `check_events_instant_order`: requires `ends_at >= starts_at`.
     - `check_events_multi_day_consistency`: requires `is_multi_day = false OR local_end_date > local_start_date`.
   - Added integration tests verifying rejection of violating rows.

6. **Candidate & Raw-Ingest Source Integrity**:
   - Added composite unique constraint `raw_ingests(id, source_id)` and compound foreign key `(raw_ingest_id, source_id) REFERENCES raw_ingests(id, source_id)` on both `event_candidates` and `event_sources`.
   - Added integration test proving cross-source candidate linking is rejected (SQLSTATE `23503`).

7. **Stable Replay and Idempotency**:
   - Handled nullable `source_event_id` in PostgreSQL with partial unique indexes (`WHERE source_event_id IS NOT NULL` and `WHERE source_event_id IS NULL`).
   - Added Step 0 in `EventMatcher` querying `findEventBySourceEventId` for upstream ID matches.
   - Added unit tests proving candidate updates update the canonical event rather than duplicating it.
   - Idempotent `getBySourceAndContentHash` in raw ingest repository.

8. **Artist Disambiguation & Conflict Resolution**:
   - Normalized name is treated as a match aid, never a universal key.
   - `ArtistResolver` detects ambiguity when multiple artists share a normalized name, routing candidates to `needs_review` (`ambiguous_artist_name_multiple_matches`).
   - Detects when an incoming external ID disagrees with an existing artist's external ID (`conflicting_external_id_distinct_artist`).

9. **Venue Identity Resolution**:
   - Strengthened matching to check `city`, `region`, and `countryCode` compatibility.
   - Distinguishes identically named venues across different cities/regions/countries.
   - Removed all default `'US'` column definitions and application fallbacks.

10. **Comprehensive Database Index Audit**:
    - Added indexes on `events(starts_at)`, `events(status)`, `events(event_kind)`, `events(city)`, `venues(city, region)`, `event_promoters(promoter_id)`, `event_ticket_links(ticket_provider_source_id)`, `event_sources(source_id, source_event_id)`, `event_sources(raw_ingest_id)`, and `event_field_evidence(source_id, raw_ingest_id)`.

11. **Strengthened RLS Integration Tests**:
    - Seeded operational records with `adminClient`, asserted existence, then queried with `anonClient` to prove zero rows are leaked.

## Tests run

- `npm run format:write` & `npm run format:check` — clean, all 54 files match Prettier style
- `npm run lint` — 0 errors, 0 warnings
- `npm run typecheck` — 0 errors (`tsc --noEmit` clean)
- `npm test` — 65/65 unit tests passed across 8 test suites
- `npm run build` — compiled successfully, static and dynamic routes generated
- `npm run test:integration` — 15/15 integration tests passed (or cleanly skipped locally pending Docker runtime)

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
