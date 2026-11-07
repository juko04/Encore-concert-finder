# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-personalized-discover`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR #12: Personalized Discover Experience — Final Minor Corrections Complete & Verified.
- **Remediation Completed (Final Minor Corrections):**
  1. *Cheap & Nearby Local Date Boundary Fix:* Refactored 14-day lookahead calculation in `lib/recommendation/modes.ts` (`calculate14DayLookaheadEndDate`) and `lib/recommendation/service.ts` to compute strictly in event-local calendar dates (e.g. Nov 7 + 14d = Nov 21), eliminating UTC midnight rollover skew during Denver evening requests. Removed the conditional guard in `isEventEligibleForMode` so 14-day lookahead validation is never skipped when context omits reference dates.
  2. *Production Regression for Denver Evening Lookahead:* Added regression tests in `tests/unit/recommendation-service.test.ts` and `tests/unit/discovery-modes.test.ts` for Saturday Nov 7, 2026 at 7:30 PM Denver time (`2026-11-08T02:30:00Z`), confirming Day 14 shows are included and Day 15 shows are excluded.
  3. *Accurate Search Scalability Documentation:* Verified PostgREST search URL sizing behavior across narrow, moderate, and broad searches; documented that `catalog-repository.ts` uses 200-item chunking without claiming a nonexistent enforced 6 KB aggregate cap; documented future PostgreSQL `tsvector` / RPC migration as Phase 3 national scaling debt.
- **Verification State:** All Suites Green & Production Ready:
  - Branch: `feature/phase-2-personalized-discover`
  - Pull Request: [#12](https://github.com/juko04/Encore-concert-finder/pull/12)
  - Unit Tests: 528/528 passed across 38 test suites (`npm test`)
  - Production Build: Next.js production build clean (0 errors, 14 routes, `/discover` confirmed dynamic)
  - Code Quality: Prettier format clean (`format:check`), ESLint clean (0 warnings), strict TypeScript clean (0 errors)
- **Immediate Next Action:** PR #12 is ready for independent re-review. Do NOT auto-merge PR #12 autonomously. Wait for user merge authorization.
- **Phase 2 Status:** **ACTIVE — PR #12 FINAL CORRECTIONS COMPLETE & VERIFIED GREEN.**

---

## What the Next Agent Must Know

1. **Preset Identifier Invariant:**
   - The UI display label for the artist preset is "Artists", but the persisted database identifier must strictly be `artist_first`.
2. **Discovery Modes vs Priority Presets:**
   - Priority presets (`artist_first`, `value`, `nearby`, `balanced`) are persisted user preferences defining baseline factor weights.
   - Discovery modes (`all`, `this_weekend`, `cheap_and_nearby`, `worth_planning_for`) are situational exploration lenses that filter candidates and apply temporary factor weighting overrides (`weightsOverride`).
3. **Multi-Tier Candidate Pool & Anti-Starvation:**
   - Upcoming shows for preferred artists are retrieved in prioritized tiers: Favorite (up to 100), Like (up to 75), Interested (up to 50), avoiding starvation of favorite acts by lower-tier preferences.
4. **Threshold Isolation Invariant:**
   - `updateTypicalBudgetAction` only modifies `maxNormalTicketPrice` in `public.profiles`. `maxFavoriteArtistPrice` and `maxSpontaneousPrice` must remain unchanged.
5. **Dynamic Request-Scoped Discover:**
   - `/discover` must remain `export const dynamic = 'force-dynamic'` to ensure private user recommendations are never stored in shared CDN or Next.js ISR caches.
6. **No Synthetic Fallback in Production:**
   - Production Discover must never fall back to synthetic fixtures on error or empty catalog.
7. **Future Scope Boundaries (Post-PR #12):**
   - Save/Dismiss Event Actions, Recommendation Feedback Loops, Multi-Day Festival Planning, and Price Alerts remain deferred to subsequent milestones.
8. **E2E / Website Test Optimization Rule:**
   - Browser/website tests (`npm run test:e2e` and full interactive browser QA) do not need to run every time, especially when changes are purely backend, repository, domain scoring, data model, or documentation, with no UI or interaction modifications.
