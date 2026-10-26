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
  1. **Truthful Candidate-Aware Empty States:** Added `totalCandidateCount`, `suppressedCount`, and `ineligibleCount` to `PersonalizedDiscoverContainer.tsx` React state, updated on all server action refetches. Differentiated genuinely empty catalog (`totalCandidateCount === 0`), suppressed/ineligible candidate pool with no displayable recommendations (`!isCatalogEmpty && totalDisplayableCount === 0`), and client-side filter empty states. Truthful messaging provides guidance and links to `/profile/taste` without leaking names of suppressed/disliked artists.
  2. **Production Preferred-Artist Query Completeness & Volume Test:** Updated `catalogRepo.listEvents()` in `lib/repositories/catalog-repository.ts` to perform a database-side inner join `event_artists!inner(artist_id)` with chunked batches (50 artist IDs) and SQL-side chronological ordering and limits. Added PostgreSQL integration test in `tests/integration/catalog-rls.test.ts` verifying >1,000 `event_artists` rows to prove PostgREST 1,000-row limits do not truncate matching events and chronological ordering is evaluated database-side.
  3. **Decoupled Stale-Score Presentation:** Separated `isStale` state from `errorMessage` in `PersonalizedDiscoverContainer.tsx`. Dismissing the transient error banner preserves the `stale-recommendations-banner` with its dedicated retry refresh button until a refresh succeeds.
  4. **E2E Mathematical Preset Inversion:** Updated `tests/e2e/discover.spec.ts` to seed Event A (Favorite artist, Colorado Springs, $120-$150) and Event B (Interested artist, Denver, $25-$35) for a Denver-based user. Verified that switching from `artist_first` to `nearby` mathematically inverts ranking and scores (Event A #1 under `artist_first` with score ~76 vs ~69; Event B #1 under `nearby` with score ~80 vs ~53).
- **Verification State:** Final Remediation Fully Verified with Green CI:
  - Branch: `feature/phase-2-personalized-discover`
  - Pull Request: [#12](https://github.com/juko04/Encore-concert-finder/pull/12)
  - Latest Commit: `78d8535` (`test(discover): extract integer scores accurately from DOM badges in E2E spec`)
  - GitHub Actions CI Run: [#40404082196](https://github.com/juko04/Encore-concert-finder/actions/runs/40404082196) — **PASSED (13m22s)**
  - Unit Tests: 468/468 passed across 34 test suites (`npm test`)
  - Integration Tests: High-volume catalog test (>1,000 rows) and fail-closed RLS suites verified green
  - Production Build: Next.js production build clean (0 errors, 14 routes, `/discover` confirmed dynamic)
  - Code Quality: Prettier format clean, ESLint clean (0 warnings), strict TypeScript clean (0 errors)
  - E2E Tests: Playwright suite passed (11 tests in CI) with ranking inversion and factor drawer assertions
- **Immediate Next Action:** PR #12 is ready for final user review and merge approval. Do NOT auto-merge PR #12. Do NOT proceed to Phase 3.
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
