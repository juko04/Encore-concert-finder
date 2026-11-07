# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-personalized-discover`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR #12: Personalized Discover Experience — Architectural Review Remediation Complete & Verified.
- **Remediation Completed (Issues 1-8):**
  1. *Discovery Modes Restored:* Added `lib/recommendation/modes.ts` defining `all`, `this_weekend`, `cheap_and_nearby`, and `worth_planning_for` with distinct eligibility filtering and factor weighting overrides. Mode switcher tabs integrated into both personalized and guest Discover views.
  2. *Server-Backed Search & City Filtering:* Pushed `searchQuery` and `city` to `catalogRepo.listEvents()` with `status: 'scheduled'`, backed by `listCities()` on `ICatalogRepository`. Truthfully preserves empty-state diagnostics (`isEmptyCatalog` vs zero filter matches).
  3. *Anti-Starvation Multi-Tier Quotas:* Dedicated candidate retrieval budgets per preference tier: Favorite (100), Like (75), Interested (50), and General Catalog (150). Guarantees favorite artist shows are never starved by high-volume lower-tier events.
  4. *Scan-Limit False Negatives Fixed:* `retrieveCandidatesWithLookback` filters for scheduled events in database queries, preventing cancelled/postponed events from consuming eligible candidate slots.
  5. *Radius Mutation & Reload Persistence Verified:* E2E test mutates profile radius from 25 mi to 50 mi, asserts persistence, verifies persistence across page reload, and confirms rank order.
  6. *Accessible Button Groups:* Travel radius and typical budget button groups converted to semantic `<fieldset>` and `<legend>` with `role="group"` and `aria-labelledby`.
  7. *Decoupled Spotify Connection State:* Onboarding banner evaluates `isSpotifyConnected` independently of manual artist preference count, differentiating linked Spotify users from manual-only users.
  8. *Decoupled Price Formatting:* Extracted `formatEventPriceDisplay` into `lib/utils/price-formatting.ts`, eliminating circular component dependencies on `ScoringInspector`.
- **Verification State:** All Suites Green & Production Ready:
  - Branch: `feature/phase-2-personalized-discover`
  - Pull Request: [#12](https://github.com/juko04/Encore-concert-finder/pull/12)
  - Unit Tests: 510/510 passed across 38 test suites (`npm test`)
  - Integration Tests: High-volume catalog cleanup and fail-closed RLS suites verified (59/59 tests passed)
  - Production Build: Next.js production build clean (0 errors, 14 routes, `/discover` confirmed dynamic)
  - Code Quality: Prettier format clean (`format:check`), ESLint clean (0 warnings), strict TypeScript clean (0 errors)
  - E2E Tests: Playwright suite verified (11/11 passed)
  - Full Interactive Browser QA: 20 passed, 1 confirmed expected guard, 0 visual overflows
- **Immediate Next Action:** PR #12 is ready for independent re-review. Do NOT auto-merge PR #12 autonomously. Wait for user merge authorization.
- **Phase 2 Status:** **ACTIVE — PR #12 REMEDIATION COMPLETE & VERIFIED GREEN.**

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
