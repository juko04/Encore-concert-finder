# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-personalized-discover`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR #12: Personalized Discover Experience — Final Guest Discover Correction.
- **PR #12 Final Focused Remediation Scope & Additions:**
  1. **Public Discover Event Filtering & Limits (`lib/recommendation/service.ts`):** `getPublicDiscoverData()` distinguishes displayable scheduled concerts from cancelled, postponed, and past candidates by checking `ev.status === 'scheduled'` and `!timing.isPast`. Bounded result limit ensures public browsing feed returns at most the requested limit (default 50). Preserves truthful `isEmptyCatalog` metadata (distinguishing empty catalogs from catalogs with only unavailable events) and timezone-aware Denver evening event retrieval. Added comprehensive regression tests in `tests/unit/recommendation-service.test.ts`.
  2. **Circular Component Dependency Elimination (`lib/utils/url.ts`):** Extracted `isValidHttpUrl` to standalone utility module `lib/utils/url.ts`, eliminating the circular component dependency between `EventCard.tsx` and `PersonalizedEventCard.tsx`. Preserved re-export in `PersonalizedEventCard.tsx` for backwards compatibility. Added unit test suite in `tests/unit/url-utils.test.ts`.
  3. **Candidate Slot Isolation for Non-Scheduled Events (`lib/recommendation/service.ts`):** Only genuinely eligible scheduled events consume candidate limits while preserving non-scheduled events for truthful diagnostics.
  4. **Strictly Fail-Closed PostgreSQL Fixture Cleanup (`tests/integration/catalog-rls.test.ts`):** Fail-closed verification across all 1,020 IDs with batch size 50.
- **Verification State:** Final Remediation Fully Verified Locally (Pre-Push):
  - Branch: `feature/phase-2-personalized-discover`
  - Pull Request: [#12](https://github.com/juko04/Encore-concert-finder/pull/12)
  - Unit Tests: 491/491 passed across 36 test suites (`npm test`)
  - Integration Tests: High-volume catalog cleanup and fail-closed RLS suites verified
  - Production Build: Next.js production build clean (0 errors, 14 routes, `/discover` confirmed dynamic)
  - Code Quality: Prettier format clean (`format:check`), ESLint clean (0 warnings), strict TypeScript clean (0 errors)
  - E2E Tests: Playwright smoke suite passed (7 passed, 4 skipped) with `BypassSandbox: true`
- **Immediate Next Action:** Push latest remediation commit to `feature/phase-2-personalized-discover`, verify GitHub Actions CI run, update diff artifact, and present final report. Do NOT auto-merge PR #12. Do NOT proceed to Phase 3.
- **Phase 2 Status:** **ACTIVE — PR #12 FINAL GUEST DISCOVER CORRECTION COMPLETE.**

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
