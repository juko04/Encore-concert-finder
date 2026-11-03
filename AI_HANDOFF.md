# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-personalized-discover`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR #12: Personalized Discover Experience — Final Focused Remediation.
- **PR #12 Final Focused Remediation Scope & Additions:**
  1. **Reliable High-Volume Integration Test Cleanup (`tests/integration/catalog-rls.test.ts`):** Wrapped fixture creation and assertions in `try/finally`; tracked all fixture IDs; implemented batched reverse-dependency deletion (`event_artists` and `events` in safe batches of 400, followed by `artists` and `venues`); added explicit assertions verifying zero orphaned rows remain; added companion resilience test verifying cleanup succeeds and leaves zero rows even after a deliberate assertion failure; preserved `assertSafeDatabaseTarget`; enforced fail-closed (`throw new Error`) behavior when DB is offline outside CI.
  2. **Bounded Candidate Lookback Paging Past Past/Ineligible Events (`lib/recommendation/service.ts`):** Implemented `retrieveCandidatesWithLookback` with `MAX_CANDIDATE_SCAN_PAGES = 5` and `pageSize = Math.max(targetEligibleLimit, 100)`. When candidates within the 24-hour lookback window contain past/ineligible shows, candidate retrieval pages forward chronologically until the target number of upcoming shows (100 preferred, 150 general) is fulfilled or the catalog is exhausted. Preserved conservative 24h timezone lookback, event-local date handling without invented times, and candidate pool diagnostics. Added regression tests A, B, C, and D in `tests/unit/recommendation-service.test.ts`.
  3. **Corrected Chunked Artist Pagination (`lib/repositories/catalog-repository.ts`):** When >50 preferred artist IDs are provided, chunks of 50 are queried with `limit: globalOffset + globalLimit` and `offset: undefined` (never passing chunk-level offsets into subqueries). Merged results are deduplicated and deterministically sorted database/repository-wide by `localStartDate ASC, id ASC`, followed by slicing by `(globalOffset, globalOffset + limit)`. Added unit test suite `tests/unit/catalog-repository.test.ts` verifying chunk offset omission, global pagination slicing, and multi-chunk deduplication.
  4. **Truthful Candidate-Aware Empty States:** Result metadata tracks `totalCandidateCount`, `suppressedCount`, and `ineligibleCount` across all refetches, distinguishing genuinely empty catalogs from ineligible/suppressed candidate pools.
- **Verification State:** Final Remediation Fully Verified Locally (Pre-Push):
  - Branch: `feature/phase-2-personalized-discover`
  - Pull Request: [#12](https://github.com/juko04/Encore-concert-finder/pull/12)
  - Unit Tests: 474/474 passed across 35 test suites (`npm test`)
  - Integration Tests: High-volume catalog cleanup and fail-closed RLS suites verified
  - Production Build: Next.js production build clean (0 errors, 14 routes, `/discover` confirmed dynamic)
  - Code Quality: Prettier format clean (`format:check`), ESLint clean (0 warnings), strict TypeScript clean (0 errors)
  - E2E Tests: Playwright smoke suite passed (7 passed, 4 skipped) with `BypassSandbox: true`
- **Immediate Next Action:** Push latest remediation commit to `feature/phase-2-personalized-discover`, verify GitHub Actions CI run, update diff artifact, and present final report. Do NOT auto-merge PR #12. Do NOT proceed to Phase 3.
- **Phase 2 Status:** **ACTIVE — PR #12 FINAL REMEDIATION COMPLETE, CI GREEN.**

---

## What the Next Agent Must Know

1. **Preset Identifier Invariant:**
   - The UI display label for the artist preset is "Artists", but the persisted database identifier must strictly be `artist_first`.
2. **Two-Tier Candidate Pool & Database Join:**
   - Upcoming shows for preferred artists are retrieved via PostgREST inner join `event_artists!inner(artist_id)` with SQL-side sorting and limiting, avoiding row-truncation pitfalls of two-query approaches.
3. **Threshold Isolation Invariant:**
   - `updateTypicalBudgetAction` only modifies `maxNormalTicketPrice` in `public.profiles`. `maxFavoriteArtistPrice` and `maxSpontaneousPrice` must remain unchanged.
4. **Dynamic Request-Scoped Discover:**
   - `/discover` must remain `export const dynamic = 'force-dynamic'` to ensure private user recommendations are never stored in shared CDN or Next.js ISR caches.
5. **No Synthetic Fallback in Production:**
   - Production Discover must never fall back to synthetic fixtures on error or empty catalog.
