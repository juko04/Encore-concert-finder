# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-personalized-discover`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR #12: Personalized Discover Experience — Final Targeted Corrections Complete & Verified.
- **Remediation Completed (Final Targeted Corrections — All Issues Resolved):**
  1. *MUST FIX 1 (Discovery-Mode Retrieval Completeness):* Pushed mode eligibility checks (`modeOptions`) into candidate pagination loops in `retrieveCandidatesWithLookback`, ensuring qualifying Cheap & Nearby shows are not starved by earlier nonqualifying events.
  2. *MUST FIX 2 (Favorite-Artist Quota & Query Bounds):* Replaced per-artist iterative queries with a single bounded query and fair round-robin quota allocation (`applyFairArtistAllocation`), guaranteeing total favorite candidates $\le 100$ and exactly 1 database query regardless of whether the user has 3, 20, or 100 favorite artists.
  3. *MUST FIX 3 (Cheap & Nearby Accuracy):* In `lib/recommendation/modes.ts`, rejected contradictory `free_event` markers when positive pricing evidence exists (`minPrice > 0`); strictly rejected "nearby" claims when guests/users have neither home coordinates nor a city filter.
  4. *MUST FIX 4 (Complete Database Search):* In `lib/repositories/catalog-repository.ts`, replaced silent 100/1,000 limits with `.range()` batch pagination (1,000-row pages), chunked 200-item ID disjunctions, and PostgREST `.or()` double-quote escaping for punctuation-containing artist names (`name.ilike."%...%"`).
  5. *SHOULD FIX 5 (Date-Only Weekend Calculation for Asia/Tokyo):* Replaced UTC 18:00 reference date parsing with UTC noon (`Date.UTC(..., 12, 0, 0)`) in `calculateWeekendWindow`, eliminating Saturday timezone roll-forward in positive UTC offsets.
  6. *SHOULD FIX 6 (Truthful Empty States):* In `PersonalizedDiscoverContainer.tsx`, `GuestDiscoverContainer.tsx`, and `service.ts`, ensured that empty weekends or discovery modes render the mode-empty banner rather than claiming an entirely empty catalog (`isEmptyCatalog: false` when `activeMode !== 'all'`).
  7. *SHOULD FIX 7 (Documentation Alignment):* Aligned `docs/phases/active/PHASE_2_IMPLEMENTATION.md` with actual scoring weights, candidate tiers, and retrieval behavior.
- **Verification State:** All Suites Green & Production Ready:
  - Branch: `feature/phase-2-personalized-discover`
  - Pull Request: [#12](https://github.com/juko04/Encore-concert-finder/pull/12)
  - Unit Tests: 528/528 passed across 38 test suites (`npm test`)
  - Production Build: Next.js production build clean (0 errors, 14 routes, `/discover` confirmed dynamic)
  - Code Quality: Prettier format clean (`format:check`), ESLint clean (0 warnings), strict TypeScript clean (0 errors)
- **Immediate Next Action:** PR #12 is ready for independent re-review. Do NOT auto-merge PR #12 autonomously. Wait for user merge authorization.
- **Phase 2 Status:** **ACTIVE — PR #12 FINAL TARGETED CORRECTIONS COMPLETE & VERIFIED GREEN.**

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
