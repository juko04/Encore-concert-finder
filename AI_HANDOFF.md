# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-personalized-discover`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR #12: Personalized Discover Experience — Remediation Round 2 Complete & Verified.
- **Remediation Completed (Round 2 — All Issues Resolved):**
  1. *FIX 1 (CRITICAL - Full Catalog Search & City Filter):* Pushed search and city filters down to database queries across entire catalog before pagination; wired 300ms input debouncing and `requestIdRef.current` stale response protection in both personalized and guest Discover containers.
  2. *FIX 2 (HIGH - Database-Side Scheduled Status Filtering):* Pushed `status: 'scheduled'` down into `retrieveCandidatesWithLookback`, `getPersonalizedDiscoverData`, and `getPublicDiscoverData`, eliminating scan limit false negatives and preventing cancelled/postponed events from consuming candidate retrieval quotas.
  3. *FIX 3 (HIGH - Timezone-Aware Weekend Window & Friday 17:00 Cutoff):* Replaced UTC day slicing with event-local IANA timezone calculations using `getZonedTimeParts` and `createZonedInstant`. Enforced Friday 17:00 (5 PM) local cutoff, robust Saturday/Sunday midnight crossing handling, and DST resilience.
  4. *FIX 4 (HIGH - Reconcile Specs, Code, and Tests):* Reconciled discovery mode specifications across `PHASE_2_IMPLEMENTATION.md`, domain code, and unit tests ($35 budget ceiling, 35-mile radius, 14-day advance horizon for Worth Planning For, Friday 5 PM weekend start).
  5. *FIX 5 (HIGH - Discovery Mode Eligibility Rules & Fallbacks):* Enforced strict $35/35mi ceilings rejecting unknown/null price and coordinates for Cheap & Nearby; added guest city matching; enforced 14-day advance horizon with guest major concert ($60+) / festival support for Worth Planning For.
  6. *Issue 6 (SHOULD FIX - Paged listCities):* Implemented chunked `.range()` pagination (1,000 events/page) in `SupabaseCatalogRepository.listCities()` to prevent PostgREST row truncation.
  7. *Issue 7 (SHOULD FIX - Expanded Search Limits):* Increased artist search limit to 100 and event-artist lookup limit to 1,000 in catalog repository.
  8. *Issue 8 (SHOULD FIX - Search Debounce & Stale Protection):* Integrated 300ms debouncing and `requestIdRef.current` cancellation tokens in both `PersonalizedDiscoverContainer.tsx` and `GuestDiscoverContainer.tsx`.
  9. *Issue 9 (SHOULD FIX - Multi-Favorite Fair Quota Allocation):* Implemented fair distribution of the 100-event favorite candidate budget across multiple favorite artists.
  10. *Issue 10 (SHOULD FIX - Truthful Empty States):* Separated genuine empty catalog (`totalCandidateCount === 0 && !search && !city`) from filtered empty states (`isFilterEmpty`) with dedicated "Clear filters" action buttons (`data-testid="clear-filters-btn"`).
- **Verification State:** All Suites Green & Production Ready:
  - Branch: `feature/phase-2-personalized-discover`
  - Pull Request: [#12](https://github.com/juko04/Encore-concert-finder/pull/12)
  - Unit Tests: 522/522 passed across 38 test suites (`npm test`)
  - Production Build: Next.js production build clean (0 errors, 14 routes, `/discover` confirmed dynamic)
  - Code Quality: Prettier format clean (`format:check`), ESLint clean (0 warnings), strict TypeScript clean (0 errors)
- **Immediate Next Action:** PR #12 is ready for independent re-review. Do NOT auto-merge PR #12 autonomously. Wait for user merge authorization.
- **Phase 2 Status:** **ACTIVE — PR #12 REMEDIATION ROUND 2 COMPLETE & VERIFIED GREEN.**

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
