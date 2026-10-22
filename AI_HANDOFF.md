# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-recommendation-scoring`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR #11: Personalized Recommendation Scoring Foundation.
- **PR #11 Objectives & Scope:**
  1. Build a pure, deterministic, typed multi-factor recommendation scoring engine (`lib/recommendation/`).
  2. Implement four fixed priority presets: Balanced (50/20/20/10), Artist-first (65/15/10/10), Nearby (40/35/15/10), Value (40/15/35/10).
  3. Support explicit artist preferences with identity resolution via verified canonical/external IDs (Favorite=100, Like=75, Interested=55, Unmarked=40, Dislike=0 & suppressed).
  4. Implement bounded travel/distance utility respecting user radius (`default_radius_miles`) and price affordability respecting profile thresholds (`max_normal_ticket_price`, `max_favorite_artist_price`).
  5. Minimal database migration adding `recommendation_preset` to `public.profiles` protected by RLS.
  6. Development-only inspection view at `/discover/scoring-preview` for inspecting real calculations on seeded fixtures.
- **Verification State:** PR #11 Verified & Green in CI:
  - Branch: `feature/phase-2-recommendation-scoring` (Commit `f3cfc6a`)
  - Pull Request: [PR #11](https://github.com/juko04/Encore-concert-finder/pull/11)
  - GitHub Actions Run: [39870797920](https://github.com/juko04/Encore-concert-finder/actions/runs/39870797920) (Green / All Successful)
  - Unit Tests: 360/360 passed across 29 test suites (`npm test`)
  - PostgreSQL Integration Tests: 52/52 passed across 7 test suites against running Supabase instance (`npm run test:integration`)
  - Playwright E2E: 7/7 browser tests passed (`npm run test:e2e`)
  - Production Build: Next.js production build clean (0 errors, 14 routes)
  - Code Quality: Prettier format clean, ESLint clean, strict TypeScript clean
- **Immediate Next Action:** Await user / independent reviewer inspection and merge of PR #11. Do NOT auto-merge. Do NOT proceed to PR #12 until PR #11 is merged to `main`.
- **Phase 2 Status:** **ACTIVE — PR #11 READY FOR INDEPENDENT REVIEW.**

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
