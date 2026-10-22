# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-spotify-integration`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR #10: Spotify Connection & Music Taste Import — CI PREVIEW E2E FIX & THIRD INDEPENDENT REVIEW REMEDIATIONS COMPLETE & GREEN.
- **CI Preview Failure & Root Cause Resolution:**
  1. **Root Cause Analysis:**
     - Next.js production builds (`NODE_ENV=production`) running under Playwright CI lacked explicit test environment variables for the synthetic preview endpoint.
     - `playwright.config.ts` `webServer.env` did not forward `ENABLE_SPOTIFY_DEV_PREVIEW`, causing `getSpotifyTopArtistsAction` to reject preview access.
     - `TasteProfileManager.tsx` silently swallowed `res.error` when `isSyntheticDemo` was true, rendering an empty artist list instead of Chappell Roan fixture rows or an error state.
  2. **Strict Multi-Layer Server Environment Guard (`lib/sources/spotify/synthetic-preview.ts`):**
     - Permitted in `development` and `test` environments by default unless explicitly disabled.
     - In `production`, strictly disabled unless running in an isolated automated test runner (`CI=true` or `PLAYWRIGHT_TEST=true`) **and** explicitly opted-in via `ENABLE_SPOTIFY_DEV_PREVIEW=true`.
     - Invariant: Accidental feature flags in normal production deployments (without CI/test flags) are strictly rejected.
  3. **Test Infrastructure & UI Error Handling (`playwright.config.ts`, `components/taste/SpotifyTastePreview.tsx`, `components/taste/TasteProfileManager.tsx`):**
     - Configured `playwright.config.ts` `webServer.env` to supply `PLAYWRIGHT_TEST: 'true'` and `ENABLE_SPOTIFY_DEV_PREVIEW: 'true'` directly to the Next.js production test server process.
     - Added `error` prop and explicit `data-testid="spotify-preview-error-state"` container to `SpotifyTastePreview`, preventing misleading empty list states when preview is unavailable.
     - Propagated preview errors in `TasteProfileManager`.
  4. **Comprehensive Test Coverage:**
     - Added 7 unit tests in `tests/unit/spotify-preview.test.ts` verifying all guard conditions (dev, test, CI flag, Playwright flag, normal production, accidental flag rejection, missing CI flag).
     - Added server action tests in `tests/unit/spotify-actions.test.ts` for production security and isolated CI execution.
     - Added component test in `tests/unit/spotify-components.test.tsx` verifying explicit error state rendering.
- **Verification State:** ALL VERIFICATIONS GREEN (Local & Remote GitHub Actions CI Run 39292038163):
  - **Unit Tests:** 319/319 passing across 25 test suites (100% pass rate).
  - **Code Style & Formatting:** `npm run format:check` passing clean (Prettier).
  - **Linting:** `npm run lint` passing with 0 errors and 0 warnings (Next.js ESLint).
  - **Type Checking:** `npm run typecheck` (`tsc --noEmit`) passing with 0 errors (both pre-build and post-build).
  - **Production Build:** `npm run build` compiled successfully (10/10 static/dynamic routes generated).
  - **Playwright E2E:** 8 passed, 0 skipped, 0 failed in GitHub Actions CI against real local Supabase with synthetic fixtures.
  - **PostgreSQL Integration:** 50/50 tests passing across 6 suites (`catalog-rls`, `golden-path`, `profiles-rls`, `spotify-connection-rls`, `ticketmaster-canonicalization`, `user-preferences-rls`).
- **Immediate Next Action:** Hand off PR #10 for final user approval and merge. Do NOT merge automatically; do NOT implement recommendation scoring algorithms until PR #10 is merged.
- **Phase 2 Status:** **ACTIVE — PR #10 CI E2E & THIRD REVIEW REMEDIATIONS VERIFIED GREEN IN CI.**

---

## What the Next Agent Must Know

1. **Strict Personalization Boundaries in PR #10:**
   - Manual preferences (`user_artist_preferences`) remain first-class and authoritative.
   - Spotify listening data is an optional enrichment source; it is explored on-demand and never automatically written to the catalog or database without explicit user confirmation.
   - The 1-to-1 account invariant is strictly enforced: `UNIQUE(spotify_account_id)` ensures a single Spotify account cannot be silently linked to multiple Encore accounts.
2. **Upcoming PR #11 Scope (Multi-Factor Recommendation Scoring):**
   - Combine explicit manual preferences (`user_artist_preferences`), distance/venue affinity, timing/recency, and price tolerance into explainable match reasons (`match_score`, `match_reasons`).
   - Answer: *"Why is this concert worth attending for me?"*
3. **Deterministic Testing:**
   - Zero live network calls to Spotify or Ticketmaster in CI or unit tests.
   - All tests use deterministic mocks, fixtures, and local Supabase containers.
