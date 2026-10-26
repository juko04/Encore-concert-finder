# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-personalized-discover`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR #12: Personalized Discover Experience — Independent Review Remediation.
- **PR #12 Review Remediation Scope & Additions:**
  1. **Distinct Personalized & Public Error States:** Created standalone `<PersonalizedDiscoverErrorState />` and `<GuestDiscoverErrorState />`. Authenticated failures never fall back to guest browsing; public failures never report a false empty catalog; server actions sanitize all error messages without leaking SQL details or stack traces (`app/discover/actions.ts`, `app/discover/page.tsx`).
  2. **Strictly Fail-Closed Database Integration Tests:** Removed all silent early returns (`return;`) in `tests/integration/recommendation-scoring.test.ts` and `tests/integration/personalized-discover.test.ts`. Missing credentials or unreachable PostgreSQL now throw explicit Errors, exiting with code 1.
  3. **Strengthened Preferred-Artist Candidate Retrieval:** In `lib/recommendation/service.ts`, unresolved preferences with `spotifyArtistId` are batch-resolved to canonical IDs via `catalogRepo.findArtistIdsByExternalIds('spotify', ...)`. Added real boundary tests (>150 general events + favored event outside page 1), overflow bounds (100-event cap), and verified Spotify identity resolution.
  4. **Fixed Search/Filter State Corruption:** In `PersonalizedDiscoverContainer.tsx`, candidate pool integrity is preserved by keeping the full candidate collection in state and filtering strictly client-side. Setting adjustments re-rank the full pool without passing transient search/city filters to the server. Added request sequence counters to discard out-of-order responses, stale notices with retry refresh buttons, and synchronized empty states.
  5. **Event-Local Timezone Boundaries:** Replaced strict UTC calendar date comparisons with a 24-hour conservative candidate lookback (`calculateCandidateRetrievalLowerBound`), allowing `calculateTimingFactor` to enforce timezone-aware eligibility without dropping same-evening western shows or leaking genuinely past concerts across both authenticated and guest discover.
  6. **Meaningful Mandatory E2E Assertions:** Updated `tests/e2e/discover.spec.ts` with mandatory assertions on seeded favorite event appearance, factor breakdown drawer contents, `aria-pressed` states on preset buttons, score and setting persistence across page reload, filter clearing, and real guest catalog access.
  7. **Cross-Layer Checks:** Added `isValidHttpUrl()` validation to external ticket links (`PersonalizedEventCard.tsx`, `EventCard.tsx`), added truthful travel messaging linking to `/profile/taste` when home coordinates are unconfigured, and ensured public catalog queries use standard anonymous SSR clients respecting guest RLS.
- **Verification State:** Independent Review Remediation Verified Locally:
  - Branch: `feature/phase-2-personalized-discover`
  - Pull Request: [#12](https://github.com/juko04/Encore-concert-finder/pull/12)
  - Commit: `bafa73d` (includes Playwright strict-mode locator disambiguation for seeded E2E venues)
  - Unit Tests: 463/463 passed across 34 test suites (`npm test`)
  - Integration Tests: Fail-closed demonstration verified (exited code 1 on offline DB; passes in CI with live Supabase)
  - Production Build: Next.js production build clean (0 errors, 14 routes, `/discover` confirmed dynamic)
  - Code Quality: Prettier format clean, ESLint clean (0 warnings), strict TypeScript clean (0 errors)
  - E2E Tests: Playwright verified (`npm run test:e2e`)
- **Immediate Next Action:** Monitor GitHub Actions CI run #40372647699 to completion and deliver comprehensive verification report. Do NOT auto-merge PR #12. Do NOT proceed to Phase 3.
- **Phase 2 Status:** **ACTIVE — PR #12 REMEDIATION COMPLETE, AWAITING CI & FINAL REVIEW.**

---

## What the Next Agent Must Know

1. **Preset Identifier Invariant:**
   - The UI display label for the artist preset is "Artists", but the persisted database identifier must strictly be `artist_first`.
2. **Two-Tier Candidate Pool:**
   - Standard chronological paging (`listEvents({ limit: 50 })`) omits shows occurring months out for a user's Favorite artists. Querying upcoming shows for the user's explicit preferred artist IDs combined with general upcoming catalog events guarantees favorite shows are always considered without unbounded database reads.
3. **Threshold Isolation Invariant:**
   - `updateTypicalBudgetAction` only modifies `maxNormalTicketPrice` in `public.profiles`. `maxFavoriteArtistPrice` and `maxSpontaneousPrice` must remain unchanged.
4. **Dynamic Request-Scoped Discover:**
   - `/discover` must remain `export const dynamic = 'force-dynamic'` to ensure private user recommendations are never stored in shared CDN or Next.js ISR caches.
5. **No Synthetic Fallback in Production:**
   - Production Discover must never fall back to synthetic fixtures on error or empty catalog.
