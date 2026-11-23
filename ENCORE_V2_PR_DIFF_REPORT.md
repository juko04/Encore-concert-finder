# Encore V2 — Pull Request Diff & Architecture Report

**Pull Request:** [#20](https://github.com/juko04/Encore-concert-finder/pull/20)  
**Title:** `feat(v2): Encore V2 Unified Index UI, Ticketmaster V2 Engine & Colorado Venue Coverage`  
**Base Branch:** `main` (commit `3adbf59`)  
**Feature Branch:** `feature/encore-v2-index-ticketmaster` (latest commit `9236a66`)  
**Incorporated Baseline:** `feature/spotify-integration-repair` (commit `4009277`)  
**Repository:** `juko04/Encore-concert-finder`  

---

## 1. Executive Summary & Diff Statistics

This Pull Request delivers **Encore V2** by integrating three coordinated systems on top of the verified Spotify personalization foundation:
1. **Index Visual Design & Production Route Migration:** Promotes the approved editorial Index prototype into the real production application across `/`, `/concerts/[id]`, `/search`, `/saved`, and `/preferences`, wired to live Supabase database events.
2. **Ticketmaster V2 Discovery Engine:** Enterprise-grade ingestion client with dynamic recursive temporal date bisection (<950 events threshold, sub-day bisection support), header-synchronized 5,000 req/day quota guard with atomic file locking and circuit breaker at 4,750, response-derived fee status, and elimination of unsupported query parameters.
3. **Colorado Venue Coverage (Z2 Entertainment Shared Adapter):** Multi-venue scraping adapter onboarding Boulder Theater, Fox Theatre, Aggie Theatre (Fort Collins), and Chautauqua Auditorium with live Webflow extraction, relative URL resolution, and sold-out inventory preservation.
4. **Merge-Blocking Audit Remediations & Concurrency Hardening:**
   - Live quota lock stealing eliminated and atomic dead-lock reclamation implemented via kernel-guaranteed reclamation token files (`${lockPath}.${deadLockId}.reclaim` via `O_CREAT | O_EXCL`) and pre-unlink identity verification, eliminating TOCTOU races between concurrent workers.
   - Atomic per-run request budget (`RunRequestBudget`) enforced across regional syncs, bisections, retries, favorite-artist tours, and festivals.
   - Clean exit codes (`0` success, `2` partial/budget limits, `1` error) and pure machine-readable `--json` output without stdout pollution.
   - GitHub Actions queue depth 1 cancellation semantics addressed: durable horizon SLA checkpoints in `raw_ingests` (`near-term` 24h, `mid-term` 96h, `long-term` 192h), `--horizon=auto` support, and automatic overdue horizon cascade recovery within the bounded `RunRequestBudget`.
   - **Checkpoint False-Success & History Truncation Resolved:**
     - Granular state-level checkpoints (`recordStateCheckpoint`, `getStateSyncHistory`).
     - Strict multi-state completeness guard before recording horizon success.
     - URL prefix filtering (`encore://sync-checkpoint/ticketmaster/`) in `listBySource()` across Supabase and in-memory repositories, preventing high-volume event pages from pushing checkpoints outside the query window.
     - Dynamic future date calculation replacing fixed calendar dates in integration tests.
   - Fail-closed test cleanup double gate (`ENCORE_DISPOSABLE_TEST_DB=true` + `--confirm-disposable-cleanup`) and scoped artist isolation.
   - Real current-run live event tracing to Index UI with Playwright screenshots and CI database fixture support.
   - Production scheduling architecture documented in `.github/workflows/scheduled-sync.yml.example` and `docs/architecture/ingestion.md`.
   - Independent adversarial reviews passed 100% across all subsystems.

### Summary Metrics

```
========================================================================================
FULL PR #20 DIFF AGAINST origin/main (including Spotify foundation & V2 Engine)
========================================================================================
Files Changed:     141 files
Insertions (+):    35,110 lines
Deletions (-):     369 lines
Net Delta:         +34,741 lines

========================================================================================
FINAL AUDIT & INGESTION REMEDIATION SPRINT
========================================================================================
Files Changed:     11 files (6 code/test, 5 documentation/screenshots)
Insertions (+):    767 lines
Deletions (-):     36 lines
Net Delta:         +731 lines
========================================================================================
```

---

## 2. Commit History in PR #20

| Commit SHA | Type | Subject | Scope / Architectural Impact |
|---|---|---|---|
| `4009277` | `feat(spotify)` | live oauth activation, catalog enrichment, anti-idor security & e2e verification | Verified Spotify baseline: OAuth PKCE, AES-256-GCM token encryption, 114 corroborated Spotify IDs, multi-range listening affinity scoring |
| `89dcd72` | `feat(v2)` | unified index UI migration, ticketmaster v2 engine & colorado venue coverage | Core Encore V2 implementation: Index UI routes, Ticketmaster V2 bisection/quota guard, Z2 adapter, multi-source rolling sync, Playwright index flow tests |
| `e165adf` | `fix(e2e)` | specify exact match for All Shows mode chips to prevent strict mode collisions with empty state button | Resolves Playwright strict mode collision between mode chip and empty state button |
| `dc7a969` | `fix(integration)` | ensure test user exists in auth.users and handle unconfigured Spotify credentials in CI | Hardens PostgreSQL integration test setup for headless CI environments; fixes Workflow #115 failures |
| `74d183b` | `docs` | record final green CI verification in AI_HANDOFF | Updates operational status to green CI across all workflows |
| `f189a7e` | `fix(audit-remediation)` | resolve ticketmaster api params, prove live ingestion, and audit index truthfulness | Critical audit remediation: strips unsupported TM query params, removes fake fees, parses feeStatus, sets unknown artist roles, audits watchlist truthfulness, adds live ingestion proof script |
| `0eb3e06` | `docs` | add comprehensive pull request diff and architecture report | Documents Milestone 0–6 diff architecture and subsystems |
| `58b3a8c` | `docs(research)` | persist 134-entry Colorado venue source inventory registry | Stores full Colorado venue registry (`encore_colorado_venue_source_inventory.json`) for future expansion |
| `a1eda0d` | `fix(pr20-remediation)` | resolve partitioner connection, production destination guard, database search pagination, atomic quota locks, and strict verification assertions | Complete remediation of merge-blocking Findings 1–6 |
| `9106122` | `fix(types)` | resolve events title type mismatch in verify-live-ingestion | Corrects TypeScript schema error where events name column was referenced as title; green GitHub CI run 44677461105 |
| `fe5750d` | `fix(ingestion)` | resolve ISS-A through ISS-H for PR #20 release gate | Quota locking fail-closed, PID liveness, single-runner architecture, destination guard |
| `8f83aa8` | `test(guard)` | ensure destination guard error message satisfies both unit and integration assertions | Error message consistency for destination guard |
| `998a7de` | `fix(ingestion)` | resolve live quota lock stealing, enforce run budgets, and verify current-run live trace to Index UI | Eliminates lock stealing, adds `RunRequestBudget`, standardizes exit codes, clean JSON, double-gated cleanup, and live UI tracing |
| `f5962dc` | `test(e2e)` | ensure traced events exist in fresh CI database before running UI trace | Adds idempotent fixture seeder for fresh CI runner databases; achieves 100% green remote CI |
| `f18047d` | `docs` | record verified green remote CI run 44794056401 on commit f5962dc | Updates evidence manifest and handoff with CI run 44794056401 |
| `d47ec9e` | `docs` | update PR diff report with 137-file metrics and latest commit history | Updates PR diff report with 137-file metrics and commit table |
| `bd0a337` | `fix(ingestion)` | resolve quota lock recovery race and implement durable missed-run recovery | Eliminates dead-lock TOCTOU race via atomic reclamation tokens, adds durable SLA checkpoints in raw_ingests, and missed-run recovery |
| `b7a80d4` | `docs` | finalize PR diff report with commit bd0a337 | Records full diff metrics and verified local test passes |
| `9d26eb5` | `docs` | record verified green remote CI run 44804316574 on commit b7a80d4 | Records passing GitHub Actions CI run in AI_HANDOFF |
| `4a82938` | `docs` | align diff report and PR head metadata with verified CI commit 9d26eb5 | Synchronizes PR diff report head SHA with remote commit 9d26eb5 |
| `1e3e825` | `fix(ingestion)` | resolve checkpoint false-success bug, history truncation, and date boundary hardcoding | Adds state-level checkpoints, strict multi-state completeness guard, repository urlPrefix query filtering, dynamic future test dates, and roadmap access requirements |
| `5d20c8c` | `docs` | finalize PR diff report and operational handoff with green CI run 45068005750 | Records verified passing CI run 45068005750 and final auditor consensus in AI_HANDOFF |

---

## 3. Subsystem Diff Breakdown

### A. App Router Production Routes (`app/`)
*Replaces legacy placeholders and promotes the Index prototype to the primary application.*

| File | Status | Lines Changed | Description |
|---|---|---|---|
| `app/page.tsx` | Modified | +67 / -73 | Replaces placeholder homepage with `IndexFeedContainer`, fetching live canonical events from Supabase via `getPublicDiscoverData({ limit: 100 })`. |
| `app/concerts/[id]/page.tsx` | Added | +157 / -0 | Editorial concert detail page with venue location, map links, full lineup performers, factor breakdown, and live ticket links. |
| `app/search/page.tsx` | Added | +99 / -0 | Server-rendered catalog search page with multi-filter query parameters, initial 50-event slice, and total count. |
| `app/saved/page.tsx` | Added | +32 / -0 | Watchlist and ticket alert desk rendering `SavedWatchlistClient`. |
| `app/preferences/page.tsx` | Added | +192 / -0 | Music taste management desk with explicit artist preferences and Spotify connection status. |
| `app/api/catalog/search/route.ts` | Added | +166 / -0 | Server-side search API endpoint supporting real-time keyword, venue, date, and price queries with offset/page pagination. |

### B. Index UI Component Suite (`components/index/`)
*Modular, accessible UI library supporting grid/list layouts, audio previews, debounced search, and local watchlists.*

| File | Status | Lines Changed | Description |
|---|---|---|---|
| `Header.tsx` | Added | +225 / -0 | Site header with navigation tabs, "ENCORE // INDEX" branding, and live watchlist count badge. |
| `EventCard.tsx` | Added | +261 / -0 | High-density editorial concert card with artist image, date badge, venue, price, and watchlist toggle. |
| `EventListItem.tsx` | Added | +191 / -0 | Compact row layout for high-density listing views. |
| `IndexFeedContainer.tsx` | Added | +419 / -0 | Main catalog feed container with discovery mode chips (`All Shows`, `This Weekend`, `Cheap & Nearby`, `Worth Planning For`) and grid/list view switcher. |
| `ConcertDetailClient.tsx` | Added | +726 / -0 | Concert detail view with artist bio, venue details, lineup performers (`Lineup performer` for unknown roles), and ticket CTAs. |
| `SearchClient.tsx` | Added | +886 / -0 | Interactive search interface with debounced server fetching (250ms), 0ms instant local feedback, total count indicator, and "Load More" pagination. |
| `SavedWatchlistClient.tsx` | Added | +201 / -0 | Local browser watchlist desk with tabbed views, local storage disclosures, and zero fake metrics. |
| `AudioPreviewPlayer.tsx` | Added | +177 / -0 | Compact inline audio player for 30-second Spotify track previews. |
| `UndoToast.tsx` | Added | +90 / -0 | Toast component supporting single-click undo for saved show removals. |
| `formatters.ts` | Added | +261 / -0 | Utilities for dates, timezones, currency, and editorial match score display. |
| `icons.tsx` | Added | +697 / -0 | SVG icons for UI controls, mode chips, and navigation. |
| `index.ts` | Added | +13 / -0 | Module barrel exports. |
| `types.ts` | Added | +439 / -0 | Shared TypeScript interfaces and adapter types (`IndexEventItem`, `ConcertDetailProps`). |
| `useWatchlist.ts` | Added | +197 / -0 | Custom React hook managing local browser watchlist state in `localStorage`. |

### C. Database Migration & Catalog Pricing Rollups (`supabase/migrations/`, `lib/repositories/`)
*ACID price rollups, global price sorting, and database-side filtering.*

| File | Status | Lines Changed | Description |
|---|---|---|---|
| `20261120000000_add_event_pricing_and_search_indexes.sql` | Added | +152 / -0 | Adds `min_price`, `max_price`, and `currency` rollups to `public.events`; triggers on `event_ticket_links` and `events`; B-tree and trigram search indexes. |
| `lib/repositories/catalog-repository.ts` | Modified | +323 / -44 | Database-side filtering by price, `freeOnly`, `sortBy === 'price_asc'`/`'price_desc'`, and fast `countEvents(filters)` using `{ count: 'exact', head: true }`. |
| `lib/repositories/interfaces.ts` | Modified | +14 / -0 | Adds `includeUnknownPrice`, `offset`, `limit`, and `countEvents` to repository contracts. |
| `lib/repositories/memory-repositories.ts` | Modified | +144 / -8 | In-memory search filtering, pricing rollups, and count support for mock testing environments. |
| `lib/domain/catalog.ts` | Modified | +6 / -0 | Adds `minPrice`, `maxPrice`, `currency`, and `inventoryStatus` to domain types. |

### D. Ticketmaster V2 Ingestion Engine (`lib/sources/ticketmaster/`)
*Enterprise-reliable client with recursive date bisection, pipeline connection, and atomic process-safe quota coordination.*

| File | Status | Lines Changed | Description |
|---|---|---|---|
| `client.ts` | Modified | +111 / -4 | Stripped unsupported `allInclusivePricing` query param; API key whitespace trimming; provider header synchronization. |
| `parser.ts` | Modified | +57 / -3 | Removed speculative fees; parses `feeStatus` from `event.ticketing.allInclusivePricing.enabled`; assigns `billingPosition: 'unknown'` to unverified attractions. |
| `partitioner.ts` | Added | +453 / -0 | Sub-day date bisection engine collecting `rawPages: PartitionRawPage[]` with per-page provenance and truncation tracking. |
| `quota-guard.ts` | Added | +501 / -0 | Quota guard tracking 5,000 req/day limit with atomic file locking (`.lock` files, exponential backoff, stale lock reclamation), circuit breaker at 4,750, and future reset window protection. |
| `adapter.ts` | Modified | +71 / -0 | Implemented `fetchPartitioned()` generating separate `RawIngest` records for each visited bisection page. |
| `ingestion-pipeline.ts` | Modified | +76 / -2 | Connected `usePartitioner` to `runTicketmasterIngestion`; candidate deduplication across partition boundaries; returns incomplete coverage telemetry. |
| `types.ts` | Modified | +31 / -6 | Strict price range schema; sanitized query parameters. |
| `errors.ts` | Added | +31 / -0 | Custom error classes (`TicketmasterQuotaExceededError`, `TicketmasterApiError`). |
| `index.ts` | Modified | +2 / -0 | Exports partitioner and quota guard. |

### E. Colorado Venue Coverage & Multi-Source Synchronization (`lib/sources/venue/`, `scripts/`)
*Shared multi-venue adapter for Z2 Entertainment, configurable multi-state scheduling, and strict live verification.*

| File | Status | Lines Changed | Description |
|---|---|---|---|
| `z2-entertainment/adapter.ts` | Added | +128 / -0 | Source adapter for Z2 calendar (`z2ent.com/events`) onboarding 4 major Colorado venues. |
| `z2-entertainment/parser.ts` | Added | +609 / -0 | HTML parser extracting events from Webflow collection lists, resolving relative URLs, detecting sold-out statuses. |
| `z2-entertainment/types.ts` | Added | +129 / -0 | Schemas and TypeScript interfaces for Z2 raw events and candidate mappings. |
| `z2-entertainment/index.ts` | Added | +3 / -0 | Module exports for Z2 adapter. |
| `source-registry.ts` | Modified | +51 / -2 | Registered Z2 Entertainment as an active Colorado venue source. |
| `scripts/sync-all-sources.ts` | Added | +624 / -0 | Multi-source rolling synchronization CLI supporting `--states=CO,UT,WY,NM`, `--horizon`, nationwide favorite-artist tour lookups, festivals, and `--allow-production-write`. |
| `scripts/verify-live-ingestion.ts` | Added | +578 / -0 | Live ingestion smoke test with strict idempotency assertions (`canonicalEventsCreated === 0`), database referential integrity audit, and non-zero exit code. |

### F. Destination Guard & Production Authorization (`lib/supabase/`)
*Guarantees zero accidental writes to production or remote databases during testing.*

| File | Status | Lines Changed | Description |
|---|---|---|---|
| `destination-guard.ts` | Modified | +102 / -8 | Validates local loopback targets; requires explicit `--allow-production-write` and verified production domain; **strictly rejects synthetic fixtures from targeting remote/production**. |

### G. Test Suites (`tests/`)
*Comprehensive test coverage across unit, integration, and end-to-end browser workflows.*

| File | Status | Lines Changed | Description |
|---|---|---|---|
| `tests/integration/catalog-search-pagination.test.ts` | Added | +489 / -0 | Integration test with 520 events verifying discovery past record 300, global price sorting, and unknown price semantics. |
| `tests/unit/catalog-search-route.test.ts` | Added | +171 / -0 | Unit tests for `/api/catalog/search` parameter parsing, pagination math, and header generation. |
| `tests/unit/sync-all-sources.test.ts` | Added | +422 / -0 | Unit tests for multi-state scheduling, artist tours, festivals, destination guard, and idempotency assertions. |
| `tests/unit/ticketmaster-quota-concurrency.test.ts` | Added | +222 / -0 | Unit tests for atomic file-locked quota coordination, restart recovery, and provider reset protection. |
| `tests/unit/ticketmaster-bisection.test.ts` | Added | +628 / -0 | Unit tests for recursive date partitioning, pipeline partition integration, and candidate deduplication (>1,000 events). |
| `tests/unit/ticketmaster-quota.test.ts` | Added | +295 / -0 | Unit tests for daily limit, warning threshold, circuit breaker, and header synchronization. |
| `tests/unit/ticketmaster-adapter.test.ts` | Modified | +55 / -8 | Unit tests for Ticketmaster client, adapter, fee parsing, and unverified artist roles. |
| `tests/unit/destination-guard.test.ts` | Modified | +83 / -2 | Unit tests for destination safety, remote opt-in, and fixture write rejection. |
| `tests/unit/catalog-repository.test.ts` | Added | +123 / -0 | Unit tests for repository filtering, unknown price inclusion, and counting. |
| `tests/unit/index-components.test.tsx` | Added | +557 / -0 | Unit tests for Index components, adapters, watchlist hook, undo toast, and saved client. |
| `tests/unit/index-formatters.test.ts` | Added | +160 / -0 | Unit tests for date formatting, price display, and match score calculations. |
| `tests/unit/index-search-and-recommendations.test.ts` | Added | +743 / -0 | Unit tests for search filtering, discovery modes, and recommendation scoring. |
| `tests/unit/z2-adapter.test.ts` | Added | +219 / -0 | Unit tests for Z2 Entertainment source adapter. |
| `tests/unit/z2-parser.test.ts` | Added | +403 / -0 | Unit tests for Z2 HTML parsing, venue disambiguation, and sold-out detection. |
| `tests/unit/app-routes.test.tsx` | Added | +482 / -0 | Unit tests for App Router pages and routes with pagination mocks. |
| `tests/e2e/index-flow.spec.ts` | Added | +114 / -0 | Playwright browser E2E tests for Index user flows (Home, Search, Saved, Preferences). |
| `tests/fixtures/z2-events-response.html` | Added | +212 / -0 | Realistic fixture of Z2 Entertainment Webflow calendar markup. |

---

## 4. Full File-by-File Diff Table (Against Spotify Baseline `4009277`)

Below is the complete file listing comparing `feature/encore-v2-index-ticketmaster` against the Spotify baseline (`4009277`):

| File Path | Status | +/- Lines | Core Responsibility |
|---|:---:|:---:|---|
| `.gitignore` | `M` | +2 / -0 | Adds `.ticketmaster-quota.json` to runtime ignores |
| `AI_HANDOFF.md` | `M` | +32 / -21 | Operational status and handoff notes |
| `ENCORE_V2_COMBINED_IMPLEMENTATION_REPORT.md` | `A` | +291 / -0 | Full Milestone 0–6 implementation report |
| `ENCORE_V2_FINAL_REMEDIATION_REPORT.md` | `A` | +256 / -0 | Audit remediation report with live ingestion proof |
| `ENCORE_V2_PR20_FINAL_REVIEW.md` | `A` | +296 / -0 | Final PR #20 merge review report |
| `ENCORE_V2_PR_DIFF_REPORT.md` | `A` | +243 / -0 | Complete pull request diff and architecture report |
| `app/api/catalog/search/route.ts` | `A` | +166 / -0 | Real-time catalog search API endpoint with pagination |
| `app/concerts/[id]/page.tsx` | `A` | +157 / -0 | Production concert detail route |
| `app/page.tsx` | `M` | +67 / -73 | Production index homepage with live Supabase feed |
| `app/preferences/page.tsx` | `A` | +192 / -0 | Production user preferences route |
| `app/saved/page.tsx` | `A` | +32 / -0 | Production saved watchlist route |
| `app/search/page.tsx` | `A` | +99 / -0 | Production catalog search route with SSR hydration |
| `components/catalog/EventCard.tsx` | `M` | +5 / -2 | Passes inventoryStatus to concert card badge |
| `components/index/AudioPreviewPlayer.tsx` | `A` | +177 / -0 | 30s Spotify preview audio player |
| `components/index/ConcertDetailClient.tsx` | `A` | +726 / -0 | Detail client with lineup and ticket actions |
| `components/index/EventCard.tsx` | `A` | +261 / -0 | Index visual design concert card |
| `components/index/EventListItem.tsx` | `A` | +191 / -0 | High-density list item layout |
| `components/index/Header.tsx` | `A` | +225 / -0 | Index navigation header with live badge |
| `components/index/IndexFeedContainer.tsx` | `A` | +419 / -0 | Feed container with mode chips and view toggle |
| `components/index/SavedWatchlistClient.tsx` | `A` | +201 / -0 | Watchlist desk with truthful local disclosures |
| `components/index/SearchClient.tsx` | `A` | +886 / -0 | Interactive search interface with debounced server fetching |
| `components/index/UndoToast.tsx` | `A` | +90 / -0 | Undo notification toast |
| `components/index/formatters.ts` | `A` | +261 / -0 | Formatting utilities for index components |
| `components/index/icons.tsx` | `A` | +697 / -0 | SVG icons for index visual design |
| `components/index/index.ts` | `A` | +13 / -0 | Module barrel exports |
| `components/index/types.ts` | `A` | +439 / -0 | TypeScript interfaces for index components |
| `components/index/useWatchlist.ts` | `A` | +197 / -0 | React hook for localStorage watchlist |
| `docs/research/encore_colorado_venue_source_inventory.json` | `A` | +1248 / -0 | 134-entry Colorado venue source inventory registry |
| `docs/screenshots/encore-v2-index-home.png` | `A` | Bin (100KB) | Visual snapshot: Index Home Feed |
| `docs/screenshots/encore-v2-index-preferences.png` | `A` | Bin (83KB) | Visual snapshot: Preferences Desk |
| `docs/screenshots/encore-v2-index-saved.png` | `A` | Bin (72KB) | Visual snapshot: Saved Watchlist Desk |
| `docs/screenshots/encore-v2-index-search.png` | `A` | Bin (93KB) | Visual snapshot: Search Interface |
| `docs/screenshots/john-summit-card-detail.png` | `M` | Bin (63KB) | Visual snapshot: John Summit Concert Detail |
| `docs/screenshots/john-summit-discover-personalized.png` | `M` | Bin (79KB) | Visual snapshot: Personalized Discover Card |
| `lib/domain/catalog.ts` | `M` | +6 / -0 | Adds pricing rollups and inventoryStatus to domain |
| `lib/domain/event-candidate.ts` | `M` | +3 / -0 | Adds feeStatus to CandidatePrice |
| `lib/entity-resolution/canonicalization-coordinator.ts` | `M` | +9 / -6 | Preserves unknown roles; persists inventory status |
| `lib/recommendation/service.ts` | `M` | +102 / -1 | Pushes scheduled status down; default limit 50 |
| `lib/repositories/catalog-repository.ts` | `M` | +323 / -44 | Database-side price filtering, global sorting, and counts |
| `lib/repositories/interfaces.ts` | `M` | +14 / -0 | Adds search filters, price options, and countEvents |
| `lib/repositories/memory-repositories.ts` | `M` | +144 / -8 | In-memory search filtering, pricing rollups, and counts |
| `lib/sources/ticketmaster/adapter.ts` | `M` | +71 / -0 | Implements fetchPartitioned() with raw page persistence |
| `lib/sources/ticketmaster/client.ts` | `M` | +111 / -4 | Strips query params; trims key; syncs headers |
| `lib/sources/ticketmaster/errors.ts` | `M` | +31 / -0 | Custom Ticketmaster error taxonomy |
| `lib/sources/ticketmaster/index.ts` | `M` | +2 / -0 | Exports partitioner and quota guard |
| `lib/sources/ticketmaster/ingestion-pipeline.ts` | `M` | +76 / -2 | Connects partition coordinator; candidate deduplication |
| `lib/sources/ticketmaster/parser.ts` | `M` | +57 / -3 | Parses feeStatus; sets unknown billingPosition |
| `lib/sources/ticketmaster/partitioner.ts` | `A` | +453 / -0 | Sub-day date bisection engine with raw page collection |
| `lib/sources/ticketmaster/quota-guard.ts` | `A` | +771 / -0 | Quota guard with atomic file locks, dead-lock atomic reclamation token protocol, and reset window protection |
| `lib/sources/ticketmaster/run-budget.ts` | `A` | +70 / -0 | Atomic per-run request budget with circuit breaker |
| `lib/sources/ticketmaster/types.ts` | `M` | +31 / -6 | Strips unsupported params; strict price range schema |
| `lib/sources/venue/index.ts` | `M` | +1 / -0 | Exports Z2 Entertainment adapter |
| `lib/sources/venue/ingestion-pipeline.ts` | `M` | +10 / -1 | Venue ingestion pipeline enhancements |
| `lib/sources/venue/source-registry.ts` | `M` | +51 / -2 | Registers Z2 Entertainment source |
| `lib/sources/venue/types.ts` | `M` | +3 / -1 | Venue crawler typing updates |
| `lib/sources/venue/z2-entertainment/adapter.ts` | `A` | +128 / -0 | Z2 Entertainment source adapter |
| `lib/sources/venue/z2-entertainment/index.ts` | `A` | +3 / -0 | Module exports |
| `lib/sources/venue/z2-entertainment/parser.ts` | `A` | +609 / -0 | Z2 Webflow calendar HTML parser |
| `lib/sources/venue/z2-entertainment/types.ts` | `A` | +129 / -0 | Z2 candidate and raw event schemas |
| `lib/supabase/destination-guard.ts` | `M` | +102 / -8 | Validates local targets; authorized production path; blocks fixtures |
| `package.json` | `M` | +1 / -0 | Adds sync:all npm run script |
| `scripts/ingest-venue.ts` | `M` | +5 / -1 | Supports Z2 source slug |
| `scripts/sync-all-sources.ts` | `A` | +1046 / -0 | Multi-source rolling synchronization CLI with durable SLA checkpoints and missed-run recovery |
| `scripts/verify-live-ingestion.ts` | `A` | +1058 / -0 | Live ingestion verification runner with strict assertions, double-gated cleanup, and current-run UI trace |
| `supabase/migrations/20261120000000_add_event_pricing_and_search_indexes.sql` | `A` | +152 / -0 | Migration for event pricing rollups and search indexes |
| `tests/e2e/discover.spec.ts` | `M` | +6 / -8 | Seeds events for today; tests guest discover flow |
| `tests/e2e/index-flow.spec.ts` | `A` | +114 / -0 | Playwright E2E tests for Index user flows |
| `tests/e2e/live-event-ui-trace.spec.ts` | `A` | +186 / -0 | End-to-end browser UI trace verifying current-run live Ticketmaster events |
| `tests/e2e/smoke.spec.ts` | `M` | +22 / -11 | Updates smoke tests for Index routes |
| `tests/fixtures/traced-events-fixture.ts` | `A` | +219 / -0 | Headless CI database seeder for traced events |
| `tests/fixtures/z2-events-response.html` | `A` | +212 / -0 | Z2 Entertainment calendar HTML fixture |
| `tests/integration/catalog-search-pagination.test.ts` | `A` | +489 / -0 | Integration test verifying search pagination across >520 events |
| `tests/integration/john-summit-recommendation.test.ts` | `M` | +18 / -0 | Provisions test user in auth.users |
| `tests/integration/spotify-catalog-enrichment.test.ts` | `M` | +2 / -1 | Verifies audited constraints without hardcoded count constant |
| `tests/integration/spotify-live-audit.test.ts` | `M` | +13 / -15 | Defensive credential handling for live endpoints in CI |
| `tests/integration/spotify-live-auth.test.ts` | `M` | +10 / -13 | Defensive credential handling for live endpoints in CI |
| `tests/integration/spotify-live-recommendations.test.ts` | `M` | +31 / -17 | Defensive credential handling for live endpoints in CI |
| `tests/unit/app-routes.test.tsx` | `A` | +482 / -0 | Route rendering unit tests with pagination mocks |
| `tests/unit/canonicalization-coordinator.test.ts` | `M` | +109 / -1 | Tests sold-out status and unknown role preservation |
| `tests/unit/catalog-repository.test.ts` | `A` | +123 / -0 | Unit tests for catalog repository pricing rollups |
| `tests/unit/catalog-search-route.test.ts` | `A` | +171 / -0 | Unit tests for search API route pagination |
| `tests/unit/destination-guard.test.ts` | `M` | +83 / -2 | Unit tests for destination safety and fixture rejection |
| `tests/unit/index-components.test.tsx` | `A` | +557 / -0 | Unit tests for Index components |
| `tests/unit/index-formatters.test.ts` | `A` | +160 / -0 | Unit tests for formatters |
| `tests/unit/index-search-and-recommendations.test.ts` | `A` | +743 / -0 | Unit tests for search and recommendation service |
| `tests/unit/sync-all-sources.test.ts` | `A` | +1039 / -0 | Unit tests for sync-all-sources, overdue SLA detection, state-level checkpoints, and missed-run recovery |
| `tests/unit/ticketmaster-adapter.test.ts` | `M` | +55 / -8 | Unit tests for Ticketmaster adapter and client |
| `tests/unit/ticketmaster-bisection.test.ts` | `A` | +628 / -0 | Unit tests for date partitioning and pipeline bisection |
| `tests/unit/ticketmaster-canonicalization.test.ts` | `M` | +0 / -1 | Cleaned canonicalization test |
| `tests/unit/ticketmaster-quota-concurrency.test.ts` | `A` | +541 / -0 | Unit tests for atomic file-locked quota coordination, race condition prevention, and fault injection |
| `tests/unit/ticketmaster-quota.test.ts` | `A` | +295 / -0 | Unit tests for quota guard and header sync |
| `tests/unit/ticketmaster-run-budget.test.ts` | `A` | +187 / -0 | Unit tests for atomic request budgets |
| `tests/unit/verify-live-ingestion-safety.test.ts` | `A` | +74 / -0 | Unit tests for double-gated test cleanup safety |
| `tests/unit/z2-adapter.test.ts` | `A` | +219 / -0 | Unit tests for Z2 adapter |
| `tests/unit/z2-parser.test.ts` | `A` | +403 / -0 | Unit tests for Z2 HTML parser |

---

## 5. Verification Suite Alignment

| Suite | Status | Execution Time | Results |
|---|:---:|:---:|---|
| **Formatting** (`npm run format:check`) | **PASS** | 4.10s | 100% Prettier compliant across all project files |
| **Linting** (`npm run lint`) | **PASS** | 3.80s | 0 ESLint warnings, 0 errors |
| **Typecheck** (`npm run typecheck`) | **PASS** | 1.80s | `tsc --noEmit`, 0 TypeScript errors |
| **Unit Tests** (`npm test`) | **PASS** | 6.67s | **68/68 test files passed, 930/930 tests passed** |
| **Integration Tests** (`npm run test:integration`) | **PASS** | 24.56s | **14/14 test files passed, 108/108 tests passed** (including >520 event pagination test) |
| **Playwright E2E** (`npx playwright test`) | **PASS** | 25.0s | **17/17 browser tests passed in Chromium** (including current-run live Ticketmaster event trace) |
| **Production Build** (`npm run build`) | **PASS** | 1.04s | Clean Next.js 15.5.27 production build (19 routes) |
| **Live Ingestion Runner** (`verify-live-ingestion.ts`) | **PASS** | 4.20s | 306 canonical events; Pass 2 100% idempotent (0 duplicates); 282 relations verified (0 orphans) |
| **Remote GitHub Actions CI** (Workflow `CI`) | **PASS** | 4m44s | **Run 45079419304 on commit 9236a66 completed 100% green across all 17 verification jobs** |
