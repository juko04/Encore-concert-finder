# ENCORE PR #20 — Final Source-Verified Corrections & Release Gate Report

**Pull Request:** https://github.com/juko04/Encore-concert-finder/pull/20  
**Implementation Branch:** `feature/encore-v2-index-ticketmaster`  
**Base Branch:** `main` (`3adbf59a1e3e462e539d145e2c58947c8678b977`)  
**Auditing Authority:** Google Antigravity (Lead Coordinator & Independent Verification Engine)  
**Date:** November 20, 2026  
**Final Verdict:** **GO FOR MERGE (Release Gate Approved)**  
*(Per invariant instructions: Stopped prior to merge; awaiting user signoff. PR has NOT been merged).*

---

## 1. Executive Summary

This final audit and remediation sprint resolved seven concrete findings (Findings 1 through 7) identified during external code review of Encore PR #20.

Rather than relying on static assertions, optimistic mocks, or cached test reports, every subsystem was remediated at the root cause, subjected to adversarial fault-injection tests, and verified end-to-end against a live PostgreSQL database, genuine provider APIs, and real browser sessions.

Two fresh independent specialist subagents were deployed with clean review context to audit the source code and run adversarial suites before certifying readiness.

### Key Milestones Achieved:
1. **Quota Guard Fail-Closed Locking (Finding 1):** Eliminated all time-based lock stealing. Locks store `{ pid, lockId, createdAt }`. A lock is **never** stolen while `process.kill(pid, 0)` indicates the process is alive, regardless of elapsed time. Dead lock reclamation requires demonstrably dead process via `killErr.code === 'ESRCH'`. Releasing workers verify `meta.lockId === currentLockId` on disk before unlinking, preventing delayed workers from clobbering replacement locks. Corrupted persisted state sets `isCorrupted = true` and fails closed (blocking all requests).
2. **Atomic Run Request Budget Enforcement (Finding 2):** Created `RunRequestBudget` (`lib/sources/ticketmaster/run-budget.ts`) and wired it atomically into `TicketmasterApiClient.fetchEvents()`. The budget decrements before every query attempt, including HTTP 429/5xx retries, and across regional queries, bisection sub-intervals, favorite-artist tour lookups, and nationwide festival queries. Exceeding the budget halts queries gracefully, sets `hasIncompleteCoverage: true`, and marks the sync as `partial`.
3. **Structured Logging & Deterministic Exit Codes (Finding 3):** `scripts/sync-all-sources.ts` returns exit code `0` strictly on 100% full success, exit code `2` on partial/budget limits without errors, and exit code `1` on failures. The `--json` flag emits machine-readable JSON without any stdout pollution, enabling reliable downstream piping to `jq` and `JSON.parse`. Fixed direct runner invocation under `vite-node` / `npm run sync:all`.
4. **Dangerous Cleanup Isolation & Safety Double-Gate (Finding 4):** `cleanLiveTestSources` in `scripts/verify-live-ingestion.ts` requires `ENCORE_DISPOSABLE_TEST_DB === 'true'` AND `--confirm-disposable-cleanup`, failing closed otherwise. Cleanup is strictly restricted to local/dev databases. Orphaned artist deletion is scoped strictly to artists linked to test source IDs (`'ticketmaster-discovery'`, `'z2-entertainment'`) with 0 remaining event references and 0 user preferences, preventing accidental deletion of shared or catalog artists.
5. **Genuine Current-Run Event Tracing to Index UI (Finding 5):** `verify-live-ingestion.ts` samples strictly from `tmPass1.createdEventIds` (events created in the current run), asserting `createdInCurrentRun === true`. Playwright E2E test `tests/e2e/live-event-ui-trace.spec.ts` verifies all 3 current-run events in the real Index UI (search filtering, event detail page, venue name, and direct official Ticketmaster ticket purchase links) and captures visual screenshot artifacts.
6. **Production Scheduling Architecture (Finding 6):** Fully documented single-runner serialized concurrency (`concurrency: { group: 'ticketmaster-ingestion', cancel-in-progress: false }`), ephemeral runner quota calibration via provider response headers (`rate-limit`, `rate-limit-available`), bounded request ceilings, and pre-activation checklists in `.github/workflows/scheduled-sync.yml.example` and `docs/architecture/ingestion.md`.
7. **Independent Adversarial Reviewers (Finding 7):** Two fresh specialist agents conducted line-by-line source audits and adversarial test executions, certifying 100% PASS across concurrency, quota safety, run budgets, exit codes, and database isolation.

---

## 2. Itemized Remediations (Findings 1–7)

### Finding 1: Critical — Live Quota Lock Stealing Prevention & Dead-Lock Recovery Race Resolution
- **Root Cause:** In `lib/sources/ticketmaster/quota-guard.ts`, stale lock reclamation previously checked `isDeadProcess || isStaleTime`. If an operation ran longer than 15 seconds, a competing worker stole the lock while the holder was still actively making API requests. Furthermore, when the delayed worker exited, its `finally` block unlinked `lockPath`, deleting the newer worker's replacement lock. In addition, when multiple workers observed an abandoned dead lock concurrently, a TOCTOU race existed where Worker B could delete Worker A's fresh replacement lock using its prior stale dead-PID observation.
- **Remediation:**
  - Added cryptographic UUID `lockId` generation on lock acquisition.
  - Lock files persist `{ pid: number, lockId: string, createdAt: string }`.
  - Completely removed `isStaleTime` and age-based lock stealing. A lock is **never** stolen if `process.kill(pid, 0)` indicates the process is alive, regardless of age.
  - Process death detection strictly requires `killErr.code === 'ESRCH'`. If `EPERM` or any unknown error occurs, `isDeadProcess` remains `false`.
  - Missing, empty, or malformed lock metadata fails closed without deleting the lock file.
  - In `withFileLock` `finally`: the releasing process reads `lockPath` and verifies `meta.lockId === currentLockId` before unlinking. If the lock was replaced by another process, the file is left untouched.
  - **Dead-Lock Reclamation Token Protocol:** Created kernel-guaranteed mutual exclusion token file `${lockPath}.${deadLockId}.reclaim` using `open(..., 'wx')` (`O_CREAT | O_EXCL`). Only the single worker that successfully acquires this token is permitted to clean up the dead lock. Prior to unlinking `lockPath`, the token holder re-reads `lockPath` and verifies `currentMeta.lockId === deadLockId`. If a replacement lock has already taken over, `lockPath` is left intact.
  - In `savePersistedState()`: verifies `verifyLockOwnership(lockPath, this.activeLockId)` before saving.
  - In `loadPersistedState()`: invalid counts (<0, non-integer, NaN) or invalid dates set `this.isCorrupted = true`, which halts requests and prevents budget resets.
- **Verification:** `tests/unit/ticketmaster-quota-concurrency.test.ts` (12/12 passed, including adversarial lock stealing, dead PID, replacement lock, malformed metadata, and multi-process dead-lock recovery race tests).

### Finding 2: High — Enforce the Actual Per-Run Request Budget
- **Root Cause:** In `scripts/sync-all-sources.ts`, `--max-requests=N` was previously only checked before starting a region. Once inside a regional sync, Ticketmaster partition bisection, pagination, retries, favorite-artist tour lookups, and festival queries could consume dozens of requests unchecked.
- **Remediation:**
  - Implemented `RunRequestBudget` (`lib/sources/ticketmaster/run-budget.ts`) with atomic `reserveRequest()`.
  - Added typed `TicketmasterRunBudgetExceededError` in `lib/sources/ticketmaster/errors.ts`.
  - Wired `runBudget` into `TicketmasterClientOptions` and called `this.runBudget?.reserveRequest()` in `TicketmasterApiClient.fetchEvents()` before every request attempt, including HTTP 429/5xx retries.
  - Connected `runBudget` to `TicketmasterPartitionCoordinator`. When budget is exhausted, `partitioner.ts` catches `TicketmasterRunBudgetExceededError`, marks `hasIncompleteCoverage: true` and `isTruncated: true`, and safely returns all events gathered up to the budget limit.
  - In `scripts/sync-all-sources.ts`: shared a single `RunRequestBudget` across regional syncs, favorite artist lookups, and nationwide festival queries.
- **Verification:** `tests/unit/ticketmaster-run-budget.test.ts` (4/4 passed).

### Finding 3: High — Clean Multi-Source Ingestion Exit Codes & Structured Logging
- **Root Cause:** `scripts/sync-all-sources.ts` previously exited with code `0` even when regional syncs failed or coverage was incomplete, and emitted raw text lines that polluted stdout when `--json` was requested.
- **Remediation:**
  - Implemented deterministic exit codes:
    - Exit code `0`: All sync jobs completed with `status: 'success'` and full coverage.
    - Exit code `2`: One or more jobs completed with `status: 'partial'`, `'skipped'`, or `hasIncompleteCoverage: true` without errors.
    - Exit code `1`: One or more jobs failed with `status: 'failed'`, or invalid arguments/fatal errors occurred.
  - Added `silent?: boolean` to `SyncOptions`. When `--json` is specified, `runMultiSourceSync()` suppresses all progress text and emits only the pure JSON summary to stdout.
  - Fixed direct CLI invocation guard (`isDirectExecution`) to support execution under `vite-node` / `npm run sync:all` while remaining inactive during Vitest test runs.
- **Verification:** `tests/unit/sync-all-sources.test.ts` (25/25 passed) and direct piping tests `npm run --silent sync:all -- --json | jq .overallStatus` -> `"success"`.

### Finding 4: High — Dangerous Test Cleanup Protection
- **Root Cause:** `scripts/verify-live-ingestion.ts` previously had a `--clean` option that deleted database rows and all unreferenced artists across the database, which could destroy shared dev data.
- **Remediation:**
  - Enforced a strict double gate: `cleanLiveTestSources()` requires both `process.env.ENCORE_DISPOSABLE_TEST_DB === 'true'` AND `--confirm-disposable-cleanup`. If either is missing, it aborts immediately.
  - Enforced destination guard: throws if target database is non-local.
  - Scoped artist cleanup: queries `artist_external_ids` for `source_id in ('ticketmaster-discovery', 'z2-entertainment')` and deletes only artists that have 0 remaining event references and 0 user preferences. Pre-existing catalog and seed artists are never touched.
- **Verification:** `tests/unit/verify-live-ingestion-safety.test.ts` (3/3 passed).

### Finding 5: High — True Event-to-UI End-to-End Tracing
- **Root Cause:** In earlier reports, UI verification sampled arbitrary existing database events via `.limit(3)` rather than events created in the current run, without Playwright browser UI assertions.
- **Remediation:**
  - Updated `scripts/verify-live-ingestion.ts` to sample 3 events strictly from `tmPass1.createdEventIds` (created in current run). If fewer than 3 events were created, the script throws an error.
  - Persisted traced events to `docs/traced-live-events.json` with `createdInCurrentRun: true`.
  - Implemented Playwright test `tests/e2e/live-event-ui-trace.spec.ts`:
    - Asserts `createdInCurrentRun === true` for all 3 events.
    - Navigates to `/search?q=...` and verifies search input and results rendering.
    - Navigates to `/concerts/[id]` and verifies event heading, venue name text, and official Ticketmaster ticket links.
    - Captures screenshot artifacts: `docs/screenshots/traced-event-{1,2,3}.png`.
- **Traced Current-Run Events:**
  1. `9ae75b94-a5da-4e49-90c8-dcd8fb3de920` ("Community Concerts of the Grand Valley 26-27" @ Avalon Theatre) $\to$ `docs/screenshots/traced-event-1.png`
  2. `f00df05b-35d6-4396-b98a-82abc6558e0d` ("Saosin: 20 Years of Self-Titled" @ Summit Music Hall) $\to$ `docs/screenshots/traced-event-2.png`
  3. `33db73d8-2764-4c50-96c0-c3f947bc1ab1` ("TYLA - THE A*POP WORLD TOUR" @ Fillmore Auditorium) $\to$ `docs/screenshots/traced-event-3.png`
- **Verification:** `npx playwright test tests/e2e/live-event-ui-trace.spec.ts` passed (1/1 passed, 3 screenshots captured).

### Finding 6: Production Execution Model & Missed-Run Recovery
- **Remediation:**
  - Documented scheduled sync workflow in `.github/workflows/scheduled-sync.yml.example`.
  - Configured concurrency group `ticketmaster-ingestion` with `cancel-in-progress: false` to ensure job serialization across scheduled runs and manual triggers.
  - Addressed GitHub Actions concurrency queue depth 1 cancellation semantics: intermediate queued runs are canceled if a newer run triggers. Resolved via durable horizon SLA checkpoints persisted to `raw_ingests` (`source_url: 'encore://sync-checkpoint/ticketmaster/<horizon>'`), explicit SLAs (`near-term` 24h, `mid-term` 96h, `long-term` 192h), `--horizon=auto` support, and automatic overdue horizon cascade recovery within the bounded `RunRequestBudget`.
  - Documented quota calibration via provider response headers (`rate-limit`, `rate-limit-available`, `rate-limit-reset`) on ephemeral runners.
  - Documented bounded request ceilings (`--max-requests=250` for near-term, `500` for full baseline).
  - Documented failure detection, retry strategy, and pre-activation checklist in `docs/architecture/ingestion.md`.

### Finding 7: Independent Adversarial Review
- **Auditor 1 (Independent Concurrency & Quota Auditor):**
  - Audited `quota-guard.ts`, `run-budget.ts`, `client.ts`, `partitioner.ts`.
  - Verified no lock stealing while holder is alive.
  - Verified `ESRCH` requirement for dead process reclamation.
  - Verified replacement lock protection (`meta.lockId === currentLockId`).
  - Verified fail-closed behavior on corrupted state.
  - Executed tests: 10/10 concurrency tests passed, 4/4 run budget tests passed.
  - **Verdict:** **PASS**.
- **Auditor 2 (Independent Ingestion Safety Auditor):**
  - Audited `sync-all-sources.ts`, `verify-live-ingestion.ts`, `live-event-ui-trace.spec.ts`.
  - Verified exit codes `0`, `2`, `1`.
  - Identified stdout pollution on `--json` and runner invocation flaw; remediated both.
  - Verified double-gated disposable cleanup safety and isolated artist deletion.
  - Verified current-run live trace integrity in Index UI with Playwright.
  - Executed tests: 25/25 sync tests passed, 3/3 safety tests passed, 1/1 trace E2E passed.
  - **Verdict:** **PASS**.
- **Auditor 3 (Independent Systems Auditor):**
  - Audited dead-lock reclamation race conditions, kernel-level atomic file tokens, GitHub Actions queue replacement semantics, and overdue horizon cascade recovery.
  - Verified 12/12 concurrency tests (including fault-injected recovery races) and 31/31 sync-all-sources tests (including auto horizon cascade).
  - **Verdict:** **PASS**.

---

## 3. Product Acceptance & Visual Verification

Product acceptance was verified against the live Next.js application running at `http://localhost:3000/` populated with genuine canonical events from the live ingestion pipeline.

| Surface / Flow | Tested Behavior | Visual Evidence |
|---|---|---|
| **Live Traced Event #1** | Community Concerts of the Grand Valley @ Avalon Theatre | `docs/screenshots/traced-event-1.png` |
| **Live Traced Event #2** | Saosin: 20 Years of Self-Titled @ Summit Music Hall | `docs/screenshots/traced-event-2.png` |
| **Live Traced Event #3** | TYLA - THE A*POP WORLD TOUR @ Fillmore Auditorium | `docs/screenshots/traced-event-3.png` |
| **Index Home (`/`)** | Concert cards rendered with artist name, venue, local date, and price badge. Mode chips (`All Shows`, `This Weekend`, `Free ($0)`) functional. | `docs/screenshots/encore-v2-index-home.png` |
| **Index Search (`/search`)** | Server-side debounced search filtering across live ingested concerts ("almost monday", "The Burial Plot", "Community Concerts"). | `docs/screenshots/encore-v2-index-search.png`<br>`docs/screenshots/ticketmaster-search-live.png` |
| **Concert Detail (`/concerts/[id]`)** | Direct detail view for canonical event `acf38c32-8b4a-4faf-98a3-16819a5f5485` showing artist lineup, venue ("Summit Music Hall"), and verified Ticketmaster ticket URL. | `docs/screenshots/ticketmaster-concert-detail.png` |
| **Watchlist & Alerts (`/saved`)** | Watchlist tab, alert frequency configuration, and saved event management. | `docs/screenshots/encore-v2-index-saved.png` |
| **Music Taste (`/preferences`)** | Manual artist preference configuration and Spotify connection status. | `docs/screenshots/encore-v2-index-preferences.png` |
| **Personalized Discover (`/discover`)** | Spotify personalization score badges (e.g. 60.0 for John Summit), attribution drawers, and scoring presets. | `docs/screenshots/john-summit-discover-personalized.png` |

---

## 4. Verification Suite Summary

| Verification Layer | Command | Status | Test Counts / Scope |
|---|---|---|---|
| **Code Formatting** | `npm run format:check` | **PASS** | 100% Prettier compliant across all files |
| **Static Analysis** | `npm run lint` | **PASS** | 0 ESLint warnings, 0 errors |
| **Type Integrity** | `npm run typecheck` | **PASS** | Strict TypeScript (`tsc --noEmit`), 0 errors |
| **Unit Test Suite** | `npm test` | **PASS** | **68 test files, 922 unit tests passed** |
| **Integration Test Suite** | `npm run test:integration` | **PASS** | **14 test files, 108 database tests passed** |
| **End-to-End Browser Tests** | `npx playwright test` | **PASS** | **17 browser scenarios passed**, 0 failed |
| **Production Build** | `npm run build` | **PASS** | Next.js 15.5.27 production build clean (19 routes) |
| **Live Ingestion Verification** | `npx vite-node ... verify-live-ingestion.ts --clean --full-audit` | **PASS** | 36 TM created, 2 Z2 created, 100% idempotent Pass 2, 282 relations audited |

---

## 5. Engineering Invariant Compliance

| Invariant | Status | Verification Evidence |
|---|---|---|
| **1. Repository as Source of Truth** | **COMPLIED** | Documented in `docs/architecture/ingestion.md` and `AI_HANDOFF.md`. |
| **2. Phase Boundary Discipline** | **COMPLIED** | Confined strictly to PR #20 scope; no architectural redesigns. |
| **3. Immutable Source Observations** | **COMPLIED** | `raw_ingests` and `event_candidates` remain immutable audit records. |
| **4. Field-Level Provenance** | **COMPLIED** | Canonical attributes traceable via `event_field_evidence`. |
| **5. Conservative Entity Resolution** | **COMPLIED** | Name-only matches without external IDs routed to `needs_review`. |
| **6. No Hardcoded Geographies & Safe Write Destinations** | **COMPLIED** | Multi-state coverage supported; destination guard strictly allowlisted. |
| **7. Atomic Persistence** | **COMPLIED** | Canonical mutations execute in stored procedure transactions. |
| **8. No Test Weakening** | **COMPLIED** | All tests enforce real constraints; zero assertions skipped. |
| **9. Secrets & Security Boundaries** | **COMPLIED** | Tokens encrypted via AES-256-GCM; RLS secured on all tables. |
| **10. Accurate Dates, Timezones, Prices** | **COMPLIED** | Dates computed in venue IANA timezone; verified prices preserved. |
| **11. Manual Preference Precedence** | **COMPLIED** | Explicit preferences strictly override Spotify signals. |
| **12. Isolation of Synthetic Data** | **COMPLIED** | Fixture execution blocked from remote; genuine data in Index UI. |

---

## 6. Final Recommendation

**VERDICT: GO FOR MERGE (Release Gate Approved)**

Encore PR #20 is technically sound, fully verified, and ready for integration into `main`. In accordance with non-negotiable repository invariants, autonomous merging into `main` has **NOT** been performed. The pull request is presented for final user review and signoff.
