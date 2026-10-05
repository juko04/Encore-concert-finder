# AI Handoff

Use this file only for the **current active handoff** between contributors/agents.
Replace its contents when a new major task begins. Durable product decisions belong
in `docs/12-decisions.md` or the active phase specification.

## Current phase

Phase 1 — Canonical Inventory and Ingestion Foundation

## Current task

Implement Phase 1 only as specified by docs/PHASE_1_IMPLEMENTATION.md.
Build canonical inventory and ingestion foundation, migrations, repositories,
normalization, entity resolution, fixtures, tests, and read-only catalog path.

## Current phase specification

`docs/PHASE_1_IMPLEMENTATION.md`

## Status

Ready for ChatGPT review

## Ownership / branch

- Active planning agent: ChatGPT
- Current branch: `feature/canonical-inventory-foundation`
- Implementing agent: Google Antigravity
- Issue/PR: none assigned

## Completed work

- Finalized Phase 1 decisions in `docs/PHASE_1_IMPLEMENTATION.md` and related docs (`docs/12-decisions.md`, `docs/03-data-model.md`).
- Implemented forward-only Supabase migrations:
  - `20261005120000_create_inventory_reference_and_catalog.sql` (`sources`, `artists`, `artist_external_ids`, `venues`, `promoters`, `events`, `event_artists`, `event_promoters`, `event_ticket_links`).
  - `20261005120001_create_ingest_provenance.sql` (`raw_ingests`, `event_candidates`, `event_sources`, `event_field_evidence`, `candidate_resolutions`).
  - `20261005120002_secure_inventory_tables.sql` (RLS enabled across all tables; read-only public catalog policies; zero public policies on operational ingestion tables).
  - Seed source added in `supabase/seed.sql`.
- Built value objects and normalization in `lib/domain/value-objects.ts`:
  - Conservative URL normalizer: lowercases host/scheme, removes default ports 80/443, removes trailing slashes, strips fragments, removes `utm_*`, `gclid`, and `fbclid` while preserving and deterministically sorting unknown parameters.
  - Name normalizer: trims, collapses whitespace, strips leading articles and punctuation.
  - IANA timezone validator: validates IANA names, rejects abbreviations (MST, EST, etc.).
  - ISO-4217 currency and price validation.
- Implemented domain entities and server-only repository interfaces/classes:
  - `lib/domain/catalog.ts`, `lib/domain/source.ts`, `lib/domain/event-candidate.ts`.
  - Repository interfaces in `lib/repositories/interfaces.ts`.
  - Memory repositories in `lib/repositories/memory-repositories.ts` for fast, offline unit testing.
  - Supabase PostgreSQL repositories in `lib/repositories/` (`catalog-repository.ts`, `source-repository.ts`, `raw-ingest-repository.ts`, `event-candidate-repository.ts`) with `import 'server-only'`.
- Built entity resolution and canonicalization coordinator in `lib/entity-resolution/`:
  - `ArtistResolver`: creates or matches artists by normalized name and external provider IDs.
  - `VenueResolver`: matches venues by normalized name and city with bidirectional suffix/alias handling ("Red Rocks" <-> "Red Rocks Amphitheatre").
  - `EventMatcher`: conservative match by exact ticket URL or same venue/date with overlapping artists; flags conflicting/ambiguous shows as `needs_review`.
  - `FieldMerge`: upgrades `date_only` to `instant` precision when time is learned; updates `status` to `cancelled`/`postponed` without deleting the event; preserves evidence.
  - `CanonicalizationCoordinator`: atomic resolution, field evidence persistence, and idempotent replay.
- Created deterministic fixtures (`tests/fixtures/phase-1-fixtures.json`) covering single shows, date-only shows, DST boundary, residencies, free events, venue aliases, two-source merges, cancellations, and ambiguous cases.
- Created read-only Discover experience:
  - `components/catalog/EventCard.tsx` with date/time, price, ticket link, status, and source attribution (no recommendation scores).
  - `app/discover/page.tsx` server-rendered page backed by `CatalogRepository`.
- Built comprehensive test suite:
  - 61 unit tests across 8 test suites passing in ~1s.
  - Server-only boundary regression test in `tests/unit/server-boundary.test.ts`.
  - Database integration tests in `tests/integration/catalog-rls.test.ts`.
  - Playwright browser smoke tests in `tests/e2e/smoke.spec.ts`.

## Tests run

- `npm run format:check` — clean, all files match Prettier style
- `npm run lint` — 0 errors, 0 warnings
- `npm run typecheck` (pre-build) — 0 errors
- `npm test` — 61/61 unit tests passed (8 test files)
- `npm run build` — compiled successfully, static and dynamic routes generated
- `npm run typecheck` (post-build) — 0 errors
- `npm run test:e2e` — 2/2 smoke tests passed

## Known issues / unresolved decisions

- Determine raw-ingest retention duration, the exact small-payload size threshold, object-storage provider, and deletion procedure before high-volume ingestion.
- A future operational/admin phase must define the human workflow and UI for aliases and `needs_review` candidate resolutions.

## Recommended next step

1. Generate review bundle:
   `git archive --format=zip --output=../encore-review.zip HEAD`
   `git diff main...HEAD > ../encore-review.diff`
2. Provide the diff / bundle to ChatGPT for independent Phase 1 architecture and implementation review.
3. Address any review findings before merging into `main`.
