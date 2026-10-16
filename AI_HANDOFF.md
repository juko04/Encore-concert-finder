# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-spotify-integration`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR #10: Spotify Connection & Music Taste Import — SECOND INDEPENDENT REVIEW REMEDIATIONS COMPLETE & VERIFIED GREEN.
- **Second Review Findings Addressed & Remediated:**
  1. **Durable Spotify Artist Identity & Disambiguation (`lib/repositories/user-preference-repository.ts`, `lib/repositories/memory-repositories.ts`, `20261016120000_add_spotify_artist_id_to_user_artist_preferences.sql`):**
     - Added `spotify_artist_id` column to `user_artist_preferences` with index and `UNIQUE(user_id, spotify_artist_id)`.
     - Filtered uncataloged unique constraint `idx_user_artist_prefs_user_unresolved` to apply only when `spotify_artist_id IS NULL`, enabling distinct acts with identical names to coexist cleanly without collision.
     - When saving a preference with `spotifyArtistId`, checks `artist_external_ids(provider = 'spotify', external_id = id)` to link to existing canonical artist and canonical name; if uncataloged, retains `artist_id = null` and preserves `spotify_artist_id` across reload without ever creating canonical artists from user input.
  2. **Disconnect Accessibility Without Encryption Key (`app/profile/taste/actions.ts`, `app/profile/taste/page.tsx`):**
     - Allowed `getConnection()` and `getSpotifyStatusAction()` to discover existing connections without requiring `SPOTIFY_TOKEN_ENCRYPTION_KEY`.
     - Preserves Disconnect button accessibility even when token encryption keys are unconfigured or deleted; ciphertext credentials remain safely protected without exposure.
  3. **Transient Refresh vs Authorization Expiration (`app/api/integrations/spotify/top-artists/route.ts`, `actions.ts`):**
     - Differentiates permanent authentication failures (`SpotifyAuthenticationError` -> status `expired`) from transient issues:
       - HTTP 429 rate limits return 429 with `Retry-After` header and preserve connection status.
       - HTTP 5xx and network errors return 503 and preserve connection status without forcing reauthorization.
  4. **Strict Isolation of Synthetic Demo Preferences (`components/taste/TasteProfileManager.tsx`, `components/taste/ArtistPreferenceCard.tsx`):**
     - Isolated simulated preview selections into dedicated state `simulatedDemoPreferences` rendered inside a clearly labeled `<div data-testid="simulated-demo-preferences-container">` with `Simulated Preview` badge.
     - Exiting demo mode discards simulated selections immediately while leaving real saved preferences untouched.
     - Zero synthetic preferences written to PostgreSQL.
- **Verification State:** ALL VERIFICATIONS GREEN:
  - **Unit Tests:** 303/303 passing across 25 test suites (100% pass rate).
  - **Code Style & Formatting:** `npm run format:check` passing clean (Prettier).
  - **Linting:** `npm run lint` passing with 0 errors and 0 warnings (Next.js ESLint).
  - **Type Checking:** `npm run typecheck` (`tsc --noEmit`) passing with 0 errors.
  - **Production Build:** `npm run build` compiled successfully (10/10 static/dynamic routes generated).
  - **Playwright E2E:** 6 passed (2 skipped when Supabase offline locally; verified synthetic container isolation).
  - **PostgreSQL Integration:** 47/47 tests passing across 6 suites (`catalog-rls`, `golden-path`, `profiles-rls`, `spotify-connection-rls`, `ticketmaster-canonicalization`, `user-preferences-rls`).
- **Immediate Next Action:** Hand off PR #10 for final code review. Do NOT merge automatically; do NOT implement recommendation scoring algorithms until PR #10 is approved and merged.
- **Phase 2 Status:** **ACTIVE — PR #10 SECOND REVIEW REMEDIATION COMPLETE & GREEN.**

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
