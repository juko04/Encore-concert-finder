# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-personalized-discover`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR #12: Personalized Discover Experience — Scope Simplification, Test Consolidation & Scaling Debt Documentation.
- **Remediation Completed (Scope Simplification & Optimization):**
  1. *Cheap & Nearby Scope Alignment:* Aligned Cheap & Nearby with spontaneous local discovery over a default 14-day lookahead horizon (`toDate: today + 14d` pushed down to database queries), preserving $35 affordability and 35-mile proximity defaults without complicated unbounded search architecture.
  2. *Favorite-Artist Scaling Deferral:* Preserved the single bounded 100-event favorite query and fair allocation (`applyFairArtistAllocation`), documenting the hypothetical single-artist saturation edge case as post-launch / national scaling debt in `docs/project/non-blocking-debt.md` and `PHASE_2_IMPLEMENTATION.md`.
  3. *Search Scalability Measurement & Architecture:* Measured PostgREST query string sizes across narrow, moderate, and broad searches; verified safe bounded behavior under HTTP GET URI limits; documented future PostgreSQL `tsvector` / RPC migration as Phase 3 non-blocking debt.
  4. *Test-Suite Efficiency & Consolidation:* Profiled test runtimes across all suites. Consolidated redundant Denver timezone rollover, empty-catalog, and cancelled-flood test cases in `recommendation-service.test.ts` without sacrificing regression coverage (total unit tests: 526 across 38 suites).
- **Verification State:** All Suites Green & Production Ready:
  - Branch: `feature/phase-2-personalized-discover`
  - Pull Request: [#12](https://github.com/juko04/Encore-concert-finder/pull/12)
  - Unit Tests: 526/526 passed across 38 test suites (`npm test`)
  - Production Build: Next.js production build clean (0 errors, 14 routes, `/discover` confirmed dynamic)
  - Code Quality: Prettier format clean (`format:check`), ESLint clean (0 warnings), strict TypeScript clean (0 errors)
- **Immediate Next Action:** PR #12 is ready for independent re-review. Do NOT auto-merge PR #12 autonomously. Wait for user merge authorization.
- **Phase 2 Status:** **ACTIVE — PR #12 SCOPE SIMPLIFIED & TEST SUITE OPTIMIZED.**

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
