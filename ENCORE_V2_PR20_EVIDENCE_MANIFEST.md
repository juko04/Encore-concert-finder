# ENCORE PR #20 — Evidence Manifest & Audit Trail

**Repository:** `juko04/Encore-concert-finder`  
**Pull Request:** https://github.com/juko04/Encore-concert-finder/pull/20  
**Feature Branch:** `feature/encore-v2-index-ticketmaster`  
**Base Commit:** `3adbf59a1e3e462e539d145e2c58947c8678b977` (`origin/main`)  
**Audit Date:** November 20, 2026  

---

## 1. Git State & File Change Inventory

### Base & Branch Comparison:
- **Base Branch:** `origin/main` (`3adbf59a1e3e462e539d145e2c58947c8678b977`)
- **Verified PR Head Branch:** `feature/encore-v2-index-ticketmaster`
- **Verification Suites:** 100% Green locally (914 Unit, 108 Integration, 17 E2E)

### Remediated Files in this Cycle:
| File Path | Description of Changes | Finding Addressed |
|---|---|---|
| `lib/sources/ticketmaster/quota-guard.ts` | Eliminated time-based lock stealing; added UUID `lockId` verification; required `killErr.code === 'ESRCH'` for dead PID reclamation; verified `meta.lockId === currentLockId` before unlinking in `finally`; verified lock ownership in `savePersistedState`; fail-closed corruption handling without resetting daily budget. | Finding 1 (Critical) |
| `lib/sources/ticketmaster/errors.ts` | Added `TicketmasterQuotaLockError`, `TicketmasterQuotaCorruptionError`, `TicketmasterQuotaPersistenceError`, and `TicketmasterRunBudgetExceededError`. | Findings 1 & 2 |
| `lib/sources/ticketmaster/run-budget.ts` | Implemented `RunRequestBudget` with atomic `reserveRequest()`, tracking consumed requests and remaining balance. | Finding 2 (High) |
| `lib/sources/ticketmaster/client.ts` | Added `runBudget` to `TicketmasterClientOptions` and atomically invoked `reserveRequest()` before every request attempt, including HTTP 429/5xx retries. | Finding 2 (High) |
| `lib/sources/ticketmaster/partitioner.ts` | Catch `TicketmasterRunBudgetExceededError` in leaf and pagination fetches, mark `hasIncompleteCoverage: true` and `isTruncated: true`, and return events gathered up to budget. | Finding 2 (High) |
| `lib/sources/ticketmaster/ingestion-pipeline.ts` | Connected `runBudget` through pipeline options to client and fixture modes. | Finding 2 (High) |
| `lib/sources/ticketmaster/adapter.ts` | Passed `runBudget` to client and exposed `getClient()`. | Finding 2 (High) |
| `lib/sources/ticketmaster/index.ts` | Re-exported `RunRequestBudget` and `TicketmasterRunBudgetExceededError`. | Finding 2 (High) |
| `scripts/sync-all-sources.ts` | Validated `--max-requests` as positive integer; shared single `RunRequestBudget` across regional sync, favorite-artist tours, and nationwide festivals; implemented exit codes `0` (success), `2` (partial/budget limits), `1` (error); added `silent?: boolean` to suppress stdout pollution when `--json` is enabled; fixed `isDirectExecution` runner guard. | Findings 2 & 3 |
| `scripts/verify-live-ingestion.ts` | Double-gated test cleanup requiring `ENCORE_DISPOSABLE_TEST_DB === 'true'` AND `--confirm-disposable-cleanup`; enforced destination guard; isolated artist cleanup strictly to test source external IDs with 0 remaining event or preference references; sampled 3 events strictly from current-run created events (`createdInCurrentRun: true`) and persisted to `docs/traced-live-events.json`. | Findings 4 & 5 |
| `tests/e2e/live-event-ui-trace.spec.ts` | Playwright E2E browser test asserting 3 genuine current-run Ticketmaster events render in Index search and concert detail UI, and captures screenshots to `docs/screenshots/traced-event-{1,2,3}.png`. | Finding 5 (High) |
| `.github/workflows/scheduled-sync.yml.example` | Documented concurrency group `ticketmaster-ingestion` serialization, ephemeral runner quota reconciliation from provider headers (`rate-limit`), bounded request ceilings, exit codes, and artifact upload. | Finding 6 |
| `docs/architecture/ingestion.md` | Documented production scheduling architecture, single-runner serialized concurrency model, rolling horizons, and provider rate-limit header feedback. | Finding 6 |
| `tests/unit/ticketmaster-quota-concurrency.test.ts` | Concurrency and adversarial tests verifying no lock stealing while holder is alive, ESRCH dead PID reclamation, replacement lock protection, and corrupted state fail-closed behavior (10/10 passed). | Finding 1 (Critical) |
| `tests/unit/ticketmaster-run-budget.test.ts` | Dedicated unit tests verifying `RunRequestBudget` construction, request reservation, client integration, and partitioner truncation (4/4 passed). | Finding 2 (High) |
| `tests/unit/sync-all-sources.test.ts` | Unit tests verifying exit codes `0`, `2`, `1`, budget bounds, and stdout suppression under `silent: true` (25/25 passed). | Finding 3 (High) |
| `tests/unit/verify-live-ingestion-safety.test.ts` | Unit tests verifying double-gated cleanup safety, non-local DB rejection, and isolated artist cleanup (3/3 passed). | Finding 4 (High) |

---

## 2. Command Execution Evidence

### 2.1 Code Style Formatting (`npm run format:check`)
```text
> encore-concert-finder@0.1.0 format:check
> prettier --check "**/*.{ts,tsx,js,jsx,json,md,yml,yaml,css}"

Checking formatting...
All matched files use Prettier code style!
```

### 2.2 Static Analysis (`npm run lint`)
```text
> encore-concert-finder@0.1.0 lint
> next lint

✔ No ESLint warnings or errors
```

### 2.3 Strict TypeScript Typecheck (`npm run typecheck`)
```text
> encore-concert-finder@0.1.0 typecheck
> tsc --noEmit
(Exit Code 0: Zero TypeScript errors)
```

### 2.4 Unit Test Suite (`npm test`)
```text
> encore-concert-finder@0.1.0 test
> vitest run

Test Files  68 passed (68)
     Tests  914 passed (914)
  Duration  28.22s
```

### 2.5 Database Integration Test Suite (`npm run test:integration`)
```text
> encore-concert-finder@0.1.0 test:integration
> vitest run --config vitest.integration.config.ts

Test Files  14 passed (14)
     Tests  108 passed (108)
  Duration  31.75s
```

### 2.6 Next.js Production Build (`npm run build`)
```text
> encore-concert-finder@0.1.0 build
> next build

   ▲ Next.js 15.5.27
   - Environments: .env.local

   Creating an optimized production build ...
 ✓ Compiled successfully in 1670ms
   Linting and checking validity of types     ✓ Linting and checking validity of types 
   Collecting page data     ✓ Collecting page data 
 ✓ Generating static pages (8/8)
   Collecting build traces     ✓ Collecting build traces 
   Finalizing page optimization     ✓ Finalizing page optimization 

Route (app)                                   Size  First Load JS
┌ ƒ /                                      4.08 kB         119 kB
├ ○ /_not-found                              994 B         104 kB
├ ƒ /api/artists/search                      144 B         103 kB
├ ƒ /api/catalog/search                      144 B         103 kB
├ ƒ /api/integrations/spotify/callback       144 B         103 kB
├ ƒ /api/integrations/spotify/connect        144 B         103 kB
├ ƒ /api/integrations/spotify/disconnect     144 B         103 kB
├ ƒ /api/integrations/spotify/top-artists    144 B         103 kB
├ ƒ /concerts/[id]                         5.76 kB         121 kB
├ ƒ /discover                              11.4 kB         118 kB
├ ƒ /discover/scoring-preview              4.68 kB         111 kB
├ ○ /hub                                   17.7 kB         124 kB
├ ƒ /login                                 1.84 kB         108 kB
├ ○ /manifest.webmanifest                    144 B         103 kB
├ ƒ /preferences                             178 B         119 kB
├ ƒ /profile/taste                           176 B         116 kB
├ ƒ /saved                                 1.85 kB         117 kB
├ ƒ /search                                5.95 kB         121 kB
└ ○ /taste                                   144 B         103 kB
+ First Load JS shared by all               103 kB
  ├ chunks/68a7d3be-6fcbf37722f36c7f.js    54.2 kB
  ├ chunks/899-8e84b14cf0169df2.js         46.6 kB
  └ other shared chunks (total)            1.92 kB

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

### 2.7 Browser E2E Suite (`npx playwright test`)
```text
Running 17 tests using 1 worker

  ✓   1 Guest Discover Flow: unauthenticated visitor views public discover with personalization callout (717ms)
  ✓   2 Guest Discover Flow: customizes preset, views why drawer, and settings persist across reload (4.4s)
  ✓   3 Encore V2 Index E2E Flow › Index Home: loads feed, switches view mode, captures visual snapshot (1.2s)
  ✓   4 Encore V2 Index E2E Flow › Index Search: navigates to /search, inputs keyword, applies filters (771ms)
  ✓   5 Encore V2 Index E2E Flow › Index Saved: navigates to /saved, verifies watchlist and alert tabs (309ms)
  ✓   6 Encore V2 Index E2E Flow › Index Preferences: navigates to /preferences, verifies taste and Spotify card (216ms)
  ✓   7 Encore V2: Live Ingestion Event-to-UI End-to-End Tracing (Finding 5) › verifies 3 genuine current-run Ticketmaster events render in Index search & concert detail UI (2.3s)
  ✓   8 Application Smoke Tests › successfully loads the landing page and displays Encore Index navigation and feed (486ms)
  ✓   9 Application Smoke Tests › successfully loads the discover catalog page (286ms)
  ✓  10 Application Smoke Tests › successfully loads the project hub page (227ms)
  ✓  11 Application Smoke Tests › successfully loads the authentication page (145ms)
  ✓  12 Application Smoke Tests › successfully loads the music taste profile page as guest (154ms)
  ✓  13 Application Smoke Tests › successfully follows redirect from /taste to /profile/taste (155ms)
  ✓  14 Application Smoke Tests › successfully loads the recommendation scoring preview inspector and toggles controls (333ms)
  ✓  15 Spotify John Summit Discover Flow: displays John Summit with 60.0 score badge, asserts Spotify attribution, and captures screenshot (2.0s)
  ✓  16 Spotify Taste Integration Flow: loads music taste page, connects in Spotify preview mode, and intentionally imports top artist into preferences (1.0s)
  ✓  17 User Preferences Lifecycle Flow: sign in, create preference, reload verify, update level, delete, sign out, and verify guest isolation (3.1s)

  17 passed (33.5s)
```

---

## 3. Live Ingestion Verification Output (`scripts/verify-live-ingestion.ts`)

```text
======================================================================
ENCORE V2 — LIVE INGESTION & IDEMPOTENCY BOUNDED SMOKE TEST
======================================================================
LABEL: Bounded smoke test (near-term horizon, limited to 50 events)
PURPOSE: Proves real provider contracts, genuine canonicalization & 100% idempotency.
NOTE: Distinct from a full 12-month production sync (via scripts/sync-all-sources.ts).
======================================================================
Target Database: http://127.0.0.1:54321 (Destination Guard: PASSED)
Quota Guard Status: 0/5000 requests used

--- Resetting Live Ingestion Test Records in Local DB ---
Cleaned prior test records for sources [b0000000-0000-0000-0000-000000000003, b0000000-0000-0000-0000-000000000010]: 82 candidates, 58 events, 2 raw ingests, 88 orphaned test artists.
Initial Canonical Events in DB: 244

--- PASS 1: Live Ingestion ---
[PASS 1] Fetching live Ticketmaster events (CO Region, near-term, limit 50)...
[PASS 1] Ticketmaster done: 50 candidates, 36 created, 1 matched in 2814ms
[PASS 1] Fetching live Z2 Entertainment calendar (z2ent.com/events)...
[PASS 1] Z2 Entertainment done: 32 candidates, 2 created, 0 matched in 1512ms

--- Review-Needed Records & Explicit Reasons Breakdown ---
[Ticketmaster Pass 1] Review Needed: 13
  - missing_artist_identity: 12 candidate(s)
  - same_venue_and_date_different_artists: 1 candidate(s)
[Z2 Entertainment Pass 1] Review Needed: 30
  - ambiguous_artist_identity: 30 candidate(s)
  - name_only_match_against_existing_artist_requires_external_id_disambiguation: 30 candidate(s)

--- PASS 2: Idempotency Verification (Immediate Re-sync) ---
[PASS 2] Re-syncing Ticketmaster live responses to verify zero duplicates...
[PASS 2] Ticketmaster re-sync: Created: 0 (expected: 0), Matched: 0, Raw Reused: 1 in 282ms
[PASS 2] Re-syncing Z2 live responses to verify zero duplicates...
[PASS 2] Z2 re-sync: Created: 0 (expected: 0), Matched: 0, Raw Reused: 1 in 311ms

--- Canonical Database Audit ---
Total Events in DB: 282
Total Artists in DB: 618
Total Venues in DB: 39

--- Auditing Database Referential Integrity & Relations ---
✓ [FULL AUDIT] Verified all 282 event_source relations in database: 0 orphans, 100% referential integrity.

======================================================================
TRACED TICKETMASTER EVENTS (PROVIDER ID -> CANONICAL DB RECORD -> UI)
======================================================================
Trace #1:
  Provider Event ID:  G5vzZ_Fnd44hW
  Canonical Event ID: 9ae75b94-a5da-4e49-90c8-dcd8fb3de920
  Title:              "Community Concerts of the Grand Valley 26-27"
  Venue:              Avalon Theatre
  Date:               2026-09-24
  Pricing:            Unknown
  Ticket URL:         https://www.ticketmaster.com/community-concerts-of-the-grand-valley-grand-junction-colorado-09-24-2026/event/1E00648A835556FD
  Index UI Route:     /concerts/9ae75b94-a5da-4e49-90c8-dcd8fb3de920
Trace #2:
  Provider Event ID:  G5vzZ_19koCIM
  Canonical Event ID: f00df05b-35d6-4396-b98a-82abc6558e0d
  Title:              "Saosin: 20 Years of Self-Titled"
  Venue:              Summit Music Hall
  Date:               2026-11-20
  Pricing:            Unknown
  Ticket URL:         https://www.ticketmaster.com/saosin-20-years-of-selftitled-denver-colorado-11-20-2026/event/1E0064A5C644EA37
  Index UI Route:     /concerts/f00df05b-35d6-4396-b98a-82abc6558e0d
Trace #3:
  Provider Event ID:  G5vzZ_2QDTig-
  Canonical Event ID: 33db73d8-2764-4c50-96c0-c3f947bc1ab1
  Title:              "TYLA - THE A*POP WORLD TOUR"
  Venue:              Fillmore Auditorium (Denver)
  Date:               2026-11-20
  Pricing:            Unknown
  Ticket URL:         https://www.ticketmaster.com/tyla-the-apop-world-tour-denver-colorado-11-20-2026/event/1E0064F6BBFECD61
  Index UI Route:     /concerts/33db73d8-2764-4c50-96c0-c3f947bc1ab1

======================================================================
IDEMPOTENCY & VERIFICATION RESULTS
======================================================================
Pass 1 Canonical Creation:    PASS (TM: 36 created, 1 matched | Z2: 2 created, 0 matched)
Ticketmaster Idempotency:     PASS (0 duplicate events created, all matched/reused)
Z2 Entertainment Idempotency: PASS (0 duplicate events created, all matched/reused)
Database Relations Audit:     PASS (282 verified, 0 orphans, fullAudit: true)
======================================================================

Verification completed successfully.
```

---

## 4. Visual Evidence & Artifacts

All screenshots were captured from the live application running against local Supabase:

1. `docs/screenshots/traced-event-1.png` — Real Index UI concert detail view for current-run Ticketmaster event "Community Concerts of the Grand Valley 26-27" @ Avalon Theatre.
2. `docs/screenshots/traced-event-2.png` — Real Index UI concert detail view for current-run Ticketmaster event "Saosin: 20 Years of Self-Titled" @ Summit Music Hall.
3. `docs/screenshots/traced-event-3.png` — Real Index UI concert detail view for current-run Ticketmaster event "TYLA - THE A*POP WORLD TOUR" @ Fillmore Auditorium.
4. `docs/screenshots/encore-v2-index-home.png` — Index home feed displaying concert cards, mode chips, and header branding.
5. `docs/screenshots/encore-v2-index-search.png` — Search interface with debounced keyword filtering.
6. `docs/screenshots/ticketmaster-search-live.png` — Search results showing canonical Ticketmaster concerts.
7. `docs/screenshots/ticketmaster-concert-detail.png` — Detail view for canonical event showing lineup, venue, date, and live Ticketmaster purchase link.
8. `docs/screenshots/encore-v2-index-saved.png` — Watchlist and notification frequency management.
9. `docs/screenshots/encore-v2-index-preferences.png` — Music taste preferences management and Spotify connection card.
10. `docs/screenshots/john-summit-card-detail.png` — Concert detail card for John Summit with personalization score.
11. `docs/screenshots/john-summit-discover-personalized.png` — Personalized Discover feed showing John Summit score badge (60.0).

---

## 5. Summary & Signoff

All verification gates have been satisfied with zero test weakenings, zero synthetic leaks into production, and 100% adherence to repository engineering invariants. PR #20 is ready for user signoff and merge into `main`.
