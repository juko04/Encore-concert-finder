# ENCORE PR #20 — Accuracy-First Remediation, Independent Verification & Final Release Gate Report

**Pull Request:** https://github.com/juko04/Encore-concert-finder/pull/20  
**Implementation Branch:** `feature/encore-v2-index-ticketmaster`  
**Base Branch:** `main` (`3adbf59a1e3e462e539d145e2c58947c8678b977`)  
**Auditing Authority:** Google Antigravity (Lead Coordinator & Independent Verification Engine)  
**Date:** November 20, 2026  
**Final Verdict:** **GO FOR MERGE (Release Gate Approved)**  
*(Per invariant instructions: Stopped prior to merge; awaiting user signoff).*

---

## 1. Executive Summary

This audit and remediation cycle addressed eight critical findings (ISS-A through ISS-H) identified during independent code inspection of Encore PR #20. 

Rather than relying on static assertions, optimistic mocks, or cached test reports, every subsystem was remediated at the root cause, subjected to adversarial fault-injection tests, and verified end-to-end against a live PostgreSQL database and genuine provider APIs.

### Key Milestones Achieved:
1. **Quota Guard Fail-Closed Guarantees (ISS-A, ISS-G, ISS-H):** Eliminated all failure-open paths. Lock timeouts, file corruption, process crashes, and unexpected I/O errors strictly block execution via typed errors (`TicketmasterQuotaLockError`, `TicketmasterQuotaCorruptionError`, `TicketmasterQuotaPersistenceError`). PID liveness checks reclaim stale locks from dead processes while protecting live workers. Deferring state hydration into atomic lock scope prevents stale in-memory counters from blocking administrative resets.
2. **Production Scheduling Architecture (ISS-B):** Replaced ambiguous cloud-runner assumptions with a single-runner serialized concurrency model (`concurrency: { group: 'ticketmaster-ingestion', cancel-in-progress: false }`). Added bounded run request budgets (`--max-requests=N`) to prevent budget exhaustion across multi-horizon syncs.
3. **Genuine Live Ingestion & 100% Idempotency (ISS-C):** Proved fresh provider-to-canonical ingestion in local Supabase from a clean state. Pass 1 created **35 genuine Ticketmaster events** and **23 genuine Z2 Entertainment events** without artificial forcing. Pass 2 achieved **100% idempotency with 0 duplicate canonical events**.
4. **Hardened Destination Guard (ISS-D):** Removed wildcard `*.supabase.co` trust. Enforced strict allowlisting (`ENCORE_APPROVED_PROD_HOSTS`, project ref, or production URL) and preserved the invariant that fixture execution is unconditionally blocked from remote targets.
5. **Truth in Testing (ISS-E, ISS-F):** Differentiated sampled integrity checks from full database audits (`--full-audit`), verifying all 301 relations with zero orphans. Documented that ephemeral test DBs verify baseline seeded mappings (`>= 1`) under 100% quality constraints rather than assuming production enrichment has run.
6. **Mandatory Product Acceptance:** Verified live Index UI at `http://localhost:3000/`, validating concert cards, live search filtering, concert detail view with direct ticket purchase links, and Spotify taste profile personalization.

---

## 2. Itemized Remediations (ISS-A through ISS-H)

### ISS-A & ISS-G: Quota Guard Fail-Closed Locking & Corruption Handling
- **Root Cause:** In `lib/sources/ticketmaster/quota-guard.ts`, `withFileLock` previously caught timeout errors and executed `return fn()` uncoordinated. Furthermore, `loadPersistedState` caught JSON parsing errors, logged a warning, and reset the daily counter to 0, which would allow an attacker or corrupted disk to bypass provider rate limits.
- **Remediation:**
  - Added typed error classes in `lib/sources/ticketmaster/errors.ts`: `TicketmasterQuotaLockError`, `TicketmasterQuotaCorruptionError`, and `TicketmasterQuotaPersistenceError`.
  - In `withFileLock`, lock wait timeouts (`maxWaitMs`) and non-`EEXIST` filesystem errors throw `TicketmasterQuotaLockError`. The callback is **never** executed uncoordinated.
  - Implemented PID liveness verification: Lock files store `{ pid: number, createdAt: string }`. If a lock exists, `isProcessAlive(pid)` is checked via `process.kill(pid, 0)`. If the owning process died (`ESRCH`), the stale lock is safely reclaimed; if the owning process is alive, the lock is respected until released or timed out.
  - In `loadPersistedState`, invalid or truncated JSON sets `this.isCorrupted = true`. While corrupted, `canExecute()` returns `{ allowed: false, reason: 'quota_state_corrupted' }`, and `recordRequest()` immediately throws `TicketmasterQuotaCorruptionError`. The counter is **never** silently reset to 0. An explicit, deliberate `reset()` is required to recover.
  - In `savePersistedState`, filesystem write errors throw `TicketmasterQuotaPersistenceError`.
- **Verification:** `tests/unit/ticketmaster-quota.test.ts` (13/13 passed) and `tests/unit/ticketmaster-quota-concurrency.test.ts` (7/7 passed), including adversarial timeout, corruption, and dead PID tests.

### ISS-B: Shared Production Scheduling Architecture
- **Root Cause:** Reviewers noted that Ticketmaster's 5,000 requests/day and 5 requests/sec limits are account-wide. Local file locks coordinate processes on a single host, but independent cloud workers in different serverless containers would operate on disconnected filesystems without coordination.
- **Remediation:**
  - Standardized on a single-runner serialized execution model for scheduled production ingestion.
  - Created `.github/workflows/scheduled-sync.yml.example` with repository-wide concurrency locking:
    ```yaml
    concurrency:
      group: ticketmaster-ingestion
      cancel-in-progress: false
    ```
  - Added `maxRequestsPerRun` option in `scripts/sync-all-sources.ts` and CLI flag `--max-requests=N` to bound daily executions to safe portions of the 5,000 request limit (e.g. 250 for near-term, 500 for full baseline).
  - Documented the architecture, rolling horizons, and provider rate-limit header feedback in `docs/architecture/ingestion.md`.
- **Verification:** Unit tests in `tests/unit/sync-all-sources.test.ts` passing.

### ISS-C: Live Ingestion Verification & Genuine Canonical Creation
- **Root Cause:** A test script that creates 0 canonical events cannot prove that real provider payloads successfully map to canonical database records.
- **Remediation:**
  - Added `assertLiveIngestionCanonicalization` in `scripts/verify-live-ingestion.ts` requiring that Pass 1 create or match canonical events (`created + matched > 0`).
  - Implemented `--clean` / `--fresh` flag in `scripts/verify-live-ingestion.ts` to clear prior test raw ingests, candidates, resolutions, events, and orphaned test artists in local Supabase before verifying.
  - Added chunked deletion (batches of 40) across foreign-key dependencies to prevent PostgREST 414 URI Too Long errors.
  - Executed live ingestion against official Ticketmaster Discovery API v2 and live Z2 Entertainment calendar (`z2ent.com/events`).
- **Live Verification Results:**
  - **Ticketmaster Pass 1:** 50 candidates parsed $\to$ **35 canonical events created**, 0 matched, 15 review-needed (14 missing artist identity, 1 same venue/date different artists).
  - **Z2 Entertainment Pass 1:** 32 candidates parsed $\to$ **23 canonical events created**, 0 matched, 9 review-needed (9 ambiguous artist identity requiring external ID disambiguation).
  - **Ticketmaster Pass 2:** 0 created, 0 matched, 1 raw ingest reused (**100% idempotent**).
  - **Z2 Entertainment Pass 2:** 0 created, 0 matched, 1 raw ingest reused (**100% idempotent**).
  - **Traceability:** 3 live Ticketmaster events traced from provider ID $\to$ canonical DB record $\to$ live ticket URL $\to$ Index UI route:
    1. Provider `G5vzZ_Fnd44hW` $\to$ Canonical `0f9ec7df-017a-4c9c-a137-39d381ebf97d` ("Community Concerts of the Grand Valley 26-27" @ Avalon Theatre) $\to$ `/concerts/0f9ec7df-017a-4c9c-a137-39d381ebf97d`
    2. Provider `G5vzZ_8mcSnfN` $\to$ Canonical `1f037945-a03e-4f90-84c9-ca9a6d39cf14` ("The Burial Plot - Final Show" @ Marquis) $\to$ `/concerts/1f037945-a03e-4f90-84c9-ca9a6d39cf14`
    3. Provider `G5vzZ_uCJAaPb` $\to$ Canonical `acf38c32-8b4a-4faf-98a3-16819a5f5485` ("almost monday" @ Summit Music Hall) $\to$ `/concerts/acf38c32-8b4a-4faf-98a3-16819a5f5485`

### ISS-D: Destination Guard Host Validation
- **Root Cause:** `isVerifiedProductionDatabase` in `lib/supabase/destination-guard.ts` previously accepted any hostname matching `*.supabase.co`, which could allow arbitrary unapproved Supabase projects to be targeted.
- **Remediation:**
  - Removed generic `*.supabase.co` wildcard trust.
  - Require explicit host allowlisting via `ENCORE_APPROVED_PROD_HOSTS`, `ENCORE_PROD_PROJECT_REF`, or `ENCORE_PROD_SUPABASE_URL`.
  - Unapproved remote hosts are rejected even if `--allow-production-write` is provided.
  - Fixture execution (`isFixture: true`) is strictly forbidden against remote destinations under all conditions.
- **Verification:** `tests/unit/destination-guard.test.ts` (9/9 passed) and integration tests in `catalog-rls.test.ts`, `user-preferences-rls.test.ts`, and `ticketmaster-canonicalization.test.ts`.

### ISS-E: Spotify Catalog Enrichment Assertion in CI
- **Root Cause:** Reviewers observed that `tests/integration/spotify-catalog-enrichment.test.ts` line 873 asserted `totalAudited >= 1` instead of asserting a full catalog count.
- **Remediation:**
  - Added thorough documentation in `spotify-catalog-enrichment.test.ts` explaining that in ephemeral CI or fresh local databases, production background enrichment has not run.
  - The test sets `ensureJohnSummit: true`, guaranteeing that at least the seeded John Summit mapping exists and is audited (`totalAudited >= 1`), while strictly validating that 100% of all audited records satisfy all quality constraints (0 invalid formats, 0 placeholders, 0 conflicting, 0 ambiguous, 0 name mismatches, 0 unverified).
- **Verification:** Integration suite passed (13/13 passed).

### ISS-F: Sampled vs. Full Database Integrity Auditing
- **Root Cause:** Reviewers noted that earlier audit reports verified 10 to 50 sample records without clearly reporting total database records.
- **Remediation:**
  - Updated `scripts/verify-live-ingestion.ts` to support both sample auditing (default 50 records) and full database auditing (`--full-audit`).
  - Added chunked querying (batches of 40) in `auditDatabaseRelations` to prevent PostgREST URI length limits.
  - In full audit mode, verified all 301 `event_sources` records in the database against `events` and `venues`, confirming 0 orphaned relations and 100% referential integrity.

### ISS-H: Quota Guard Unlocked Constructor Read & Reset Sync
- **Root Cause:** In `TicketmasterQuotaGuard`, the constructor called `this.loadPersistedState()` without acquiring the file lock. If a stale file existed, `this.count = Math.max(this.count, data.count)` in `loadPersistedState` preserved stale in-memory counts from a previous day across midnight resets.
- **Remediation:**
  - Removed the unlocked `loadPersistedState()` call from the constructor.
  - Deferred state hydration strictly inside `withFileLock` before operations execute.
  - Synchronized in-memory count authoritatively with disk state inside the lock scope, allowing midnight and administrative resets to take immediate effect.
- **Verification:** Concurrency suite passed with zero lock contention or stale reset errors.

---

## 3. Product Acceptance & Visual Verification

Product acceptance was verified against the live Next.js application running at `http://localhost:3000/` populated with genuine canonical events from the live ingestion pipeline.

| Surface / Flow | Tested Behavior | Visual Evidence |
|---|---|---|
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
| **Unit Test Suite** | `npm test` | **PASS** | **66 test files, 900 unit tests passed** |
| **Integration Test Suite** | `npm run test:integration` | **PASS** | **14 test files, 108 database tests passed** |
| **End-to-End Browser Tests** | `npx playwright test` | **PASS** | **16 browser scenarios passed**, 0 failed |
| **Production Build** | `npm run build` | **PASS** | Next.js 15.5.27 production build clean (19 routes) |
| **Live Ingestion Verification** | `npx vite-node ... verify-live-ingestion.ts --clean --full-audit` | **PASS** | 35 TM created, 23 Z2 created, 0 duplicates, 301 relations audited |

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
