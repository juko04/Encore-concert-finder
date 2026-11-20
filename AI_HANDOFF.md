# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Encore PR #20 — Final Source-Verified Corrections & Release Gate (COMPLETED)**.
- **Active Branch:** `feature/encore-v2-index-ticketmaster`
- **Base Branch:** `main` (`3adbf59a1e3e462e539d145e2c58947c8678b977`)
- **PR URL:** https://github.com/juko04/Encore-concert-finder/pull/20
- **Active Implementing Lead:** Google Antigravity
- **Current Status:** **READY FOR MERGE (Release Gate Approved)**. All findings remediated, certified by independent adversarial auditors, verified against live Supabase database with genuine current-run events traced to the Index UI, and full verification suite 100% green. Zero merge blockers remaining.

---

## Resolved Issue Register (Findings & Hardening)

1. **Finding 1 (Critical — Live Quota Lock Stealing Prevention & Recovery Race Resolution):**
   - Eliminated all time-based lock stealing. Locks store `{ pid, lockId, createdAt }`. A lock is **never** stolen while `process.kill(pid, 0)` indicates the process is alive.
   - Process death detection strictly requires `killErr.code === 'ESRCH'`.
   - Releasing processes verify `meta.lockId === currentLockId` before unlinking, preventing delayed workers from clobbering replacement locks.
   - **Multi-Worker Dead-Lock Reclamation Race Fixed:** Implemented kernel-guaranteed atomic reclamation token files (`${lockPath}.${deadLockId}.reclaim` opened with `O_CREAT | O_EXCL` / `'wx'`) and strict re-verification of `currentMeta.lockId === deadLockId` immediately before unlinking. This prevents Worker B from unlinking Worker A's fresh replacement lock based on an earlier stale dead-lock observation.
   - Persisted state validation marks corrupted files as `isCorrupted = true`, failing closed without resetting daily counters.
2. **Finding 2 (High — Enforce Actual Per-Run Request Budget):**
   - Created `RunRequestBudget` (`lib/sources/ticketmaster/run-budget.ts`) with atomic `reserveRequest()`.
   - Added typed `TicketmasterRunBudgetExceededError`.
   - Wired `runBudget` into `TicketmasterApiClient.fetchEvents()` to decrement before every request attempt, including HTTP 429/5xx retries.
   - Connected `runBudget` to `TicketmasterPartitionCoordinator` and `scripts/sync-all-sources.ts`, sharing a single budget across regional syncs, bisections, favorite-artist tours, and nationwide festivals.
3. **Finding 3 (High — Multi-Source Ingestion Exit Codes & Structured Logging):**
   - Standardized deterministic exit codes: `0` (full success), `2` (partial/budget limits without errors), `1` (fatal errors / invalid arguments).
   - Added `silent?: boolean` to `SyncOptions` to suppress all progress text when `--json` is enabled, emitting only pure, machine-readable JSON to stdout for clean `jq` piping.
   - Fixed direct CLI invocation guard (`isDirectExecution`) to execute properly under `vite-node` / `npm run sync:all` while ignoring Vitest test runs.
4. **Finding 4 (High — Dangerous Test Cleanup Protection):**
   - Enforced a strict double gate in `scripts/verify-live-ingestion.ts`: requires both `ENCORE_DISPOSABLE_TEST_DB === 'true'` AND `--confirm-disposable-cleanup`, failing closed otherwise.
   - Restricted cleanup to local development databases.
   - Scoped artist cleanup strictly to test source IDs (`'ticketmaster-discovery'`, `'z2-entertainment'`) with 0 remaining event references and 0 user preferences, preventing deletion of shared catalog artists.
5. **Finding 5 (High — True Event-to-UI End-to-End Tracing):**
   - Sampled 3 events strictly from `tmPass1.createdEventIds` (created in current run) and persisted to `docs/traced-live-events.json` with `createdInCurrentRun: true`.
   - Implemented Playwright test `tests/e2e/live-event-ui-trace.spec.ts` verifying all 3 events in the real Index UI (search filtering, event detail page, venue name, and direct official Ticketmaster ticket purchase links) and captured screenshot artifacts (`docs/screenshots/traced-event-{1,2,3}.png`).
6. **Finding 6 (Production Execution Model & GitHub Actions Queue Replacement Resilience):**
   - Documented single-runner serialized concurrency group (`ticketmaster-ingestion`) with `cancel-in-progress: false` in `.github/workflows/scheduled-sync.yml.example` and `docs/architecture/ingestion.md`.
   - Addressed GitHub Actions concurrency queue depth 1 cancellation semantics: intermediate queued runs are canceled if a newer run triggers. Resolved via durable horizon SLA checkpoints persisted to `raw_ingests` (`source_url: 'encore://sync-checkpoint/ticketmaster/<horizon>'`), explicit SLAs (`near-term` 24h, `mid-term` 96h, `long-term` 192h), `--horizon=auto` support, and automatic overdue horizon cascade recovery within the bounded `RunRequestBudget`.
   - Documented ephemeral runner quota calibration via provider response headers (`rate-limit`, `rate-limit-available`, `rate-limit-reset`) and bounded request ceilings.
7. **Finding 7 (Independent Adversarial Reviewers):**
   - Auditor 1 (`f318a858-a338-41aa-86e7-cfb599943445`): Audited concurrency, quota locking, and run budget enforcement (100% PASS).
   - Auditor 2 (`2449dc23-bac8-416d-a4ff-99be8f6fb9fe`): Audited exit codes, structured output, cleanup safety, and UI tracing (100% PASS after stdout and runner fixes).
   - Auditor 3 (`bd63023f-dc10-4ed2-a263-3ac0812eb27c`): Audited dead-lock reclamation race conditions, atomic token acquisition, queue replacement SLAs, and multi-process fault injection (100% PASS).

---

## Verification Suite Results (All Passed)

- `npm run format:check`: **PASS** (100% Prettier compliant)
- `npm run lint`: **PASS** (0 ESLint errors, 0 warnings)
- `npm run typecheck`: **PASS** (Strict TypeScript `tsc --noEmit`, 0 errors)
- `npm test`: **PASS** (**68/68 test files, 922/922 unit tests passed**)
- `npm run test:integration`: **PASS** (**14/14 test files, 108/108 database integration tests passed**)
- `npm run build`: **PASS** (Next.js 15.5.27 production build clean, 19/19 routes compiled)
- `npx playwright test`: **PASS** (**17/17 Playwright browser tests passed, including current-run UI trace**)
- `scripts/verify-live-ingestion.ts --clean --full-audit`: **PASS** (36 TM created, 2 Z2 created; Pass 2: 0 duplicates; 282 relations audited with 0 orphans)
- **GitHub Actions Remote CI:** **PASS** (Run `44804316574` on commit `b7a80d4` completed 100% green in 11m33s)

---

## Next Immediate Action

Submit final verification report and evidence manifest for user signoff. Do NOT autonomously merge into `main`.
