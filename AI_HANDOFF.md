# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-personalized-discover`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR #12: Personalized Discover Experience.
- **PR #12 Objectives & Scope:**
  1. Build production recommendation service (`lib/recommendation/service.ts`) with two-tier candidate retrieval (Tier 1: user preferred artists batch query; Tier 2: general upcoming catalog batch query) guaranteeing complete consideration of favorite shows without unbounded table scans or N+1 queries.
  2. Implement request-scoped dynamic execution (`export const dynamic = 'force-dynamic'`) on `/discover` preventing cross-user caching or private recommendation leakage.
  3. Implement authenticated Server Actions (`app/discover/actions.ts`) with cryptographic JWT session validation:
     - `updateRecommendationPresetAction` (validating presets and persisting `artist_first`).
     - `updateTravelRadiusAction` (validating integer [5, 500]).
     - `updateTypicalBudgetAction` (updating `maxNormalTicketPrice` while preserving `maxFavoriteArtistPrice` and `maxSpontaneousPrice`).
     - `getPersonalizedRecommendationsAction` & `getPublicDiscoverAction`.
  4. Build responsive, accessible UI components (`components/discover/`):
     - `PersonalizedEventCard`: localized date/time, price via `formatEventPriceDisplay`, score formatted strictly as `${score}/100` (never a percentage), concise explanation, valid ticket link, and expandable "Why this show?" drawer disclosing 4 factor contributions and truthful missing coordinate messaging.
     - `PersonalizedDiscoverContainer`: client container with 4-preset toggle, travel radius selector, typical budget selector, instant search and city filtering, and partitioned sections ("Recommended For You" vs "Explore Something New"), with onboarding and truthful empty catalog handling.
     - `GuestDiscoverContainer`: public canonical event listing for signed-out guests with "Make These Recommendations Yours" banner linking to `/login` and `/profile/taste`.
  5. Complete comprehensive test suites across unit, PostgreSQL integration, and Playwright E2E browser tests.
- **Verification State:** PR #12 Implementation & Local Verification Complete:
  - Branch: `feature/phase-2-personalized-discover`
  - Pull Request: Pending creation via `gh pr create`
  - Unit Tests: 452/452 passed across 34 test suites (`npm test`)
  - Integration Tests: 56/56 passed across 8 test suites (`npm run test:integration`)
  - Playwright E2E Tests: 8 passed, 3 skipped (offline DB) across 4 suites (`npm run test:e2e`)
  - Production Build: Next.js production build clean (0 errors, 14 routes)
  - Code Quality: Prettier format clean, ESLint clean (0 warnings), strict TypeScript clean (0 errors)
- **Immediate Next Action:** Stage, commit, push branch `feature/phase-2-personalized-discover`, open PR #12, monitor GitHub Actions CI, and await independent code review. Do NOT auto-merge. Do NOT proceed to Phase 3.
- **Phase 2 Status:** **ACTIVE — PR #12 IMPLEMENTATION COMPLETE, AWAITING REVIEW & CI.**

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
