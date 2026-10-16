# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-spotify-integration`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR #10: Spotify Connection & Music Taste Import — ALL REVIEW FINDINGS ADDRESSED & VERIFIED GREEN.
- **Review Findings Addressed & Implemented:**
  1. **User-Bound OAuth Handshake (`lib/sources/spotify/oauth.ts`, `connect/route.ts`, `callback/route.ts`):**
     - Encrypted short-lived handshake cookie (`SPOTIFY_OAUTH_BINDING_COOKIE`) securely binds OAuth state, PKCE verifier, initiating Encore `user.id`, and creation timestamp.
     - Callback verifies session equality (`user.id === binding.userId`). Rejects session switching (`session_mismatch`), state mismatch, tampering, replay, and expiration (>10 min) with immediate cookie deletion regardless of outcome.
  2. **Production Preview Gating & Synthetic Isolation (`synthetic-preview.ts`, `top-artists/route.ts`, `TasteProfileManager.tsx`):**
     - Gated synthetic preview to development/testing (`NODE_ENV !== 'production' || ENABLE_SPOTIFY_DEV_PREVIEW === 'true'`); returns 403 in production.
     - Live failures produce explicit errors and never fall back to synthetic data.
     - Demo additions are simulated client-side (`demo-` ID) without persisting synthetic observations to PostgreSQL.
  3. **Reliable Spotify Disconnect (`spotify-connection-repository.ts`, `disconnect/route.ts`, `disconnectSpotifyAction`):**
     - Repository constructor allows optional encryption key; non-cryptographic operations (`deleteConnection`, `getConnection`, `findBySpotifyAccountId`) run reliably even if encryption keys are absent.
     - Disconnect purges credentials and returns success only upon successful deletion, leaving manual preferences untouched.
  4. **Enforced Reauthorization Deadline (`top-artists/route.ts`, `getSpotifyTopArtistsAction`):**
     - Enforces `reauthorization_deadline <= now` prior to token refresh or use. Automatically transitions status to `'expired'`, returns 401, avoids calling Spotify API, and preserves manual preferences.
  5. **Verified External-ID Artist Identity Matching (`SpotifyTastePreview.tsx`, `user-preference.ts`):**
     - Replaced normalized-name matching with verified Spotify external ID matching (`p.spotifyArtistId === artist.id || p.canonicalArtist?.spotifyArtistId === artist.id`).
     - Distinct acts sharing the same name display a "Distinct Act" badge and can be added independently without merging.
  6. **Comprehensive Mocked OAuth & API Test Coverage (`tests/unit/spotify-oauth-flow.test.ts`, `spotify-connection-rls.test.ts`):**
     - Added test suite covering all 8 scenarios: successful connection, state mismatch rejection, switched session rejection, expired/replayed callback rejection, account conflict rejection, token refresh vs deadline expiration, disconnect/credential deletion, and manual preference preservation.
- **Verification State:** ALL VERIFICATIONS GREEN:
  - **Unit Tests:** 294/294 passing across 25 test suites (100% pass rate).
  - **Code Style & Formatting:** `npm run format:check` passing clean (Prettier).
  - **Linting:** `npm run lint` passing with 0 errors and 0 warnings (Next.js ESLint).
  - **Type Checking:** `npm run typecheck` (`tsc --noEmit`) passing with 0 errors.
  - **Production Build:** `npm run build` compiled successfully (10/10 static/dynamic routes generated).
  - **Playwright E2E:** 6 passed (2 skipped when Supabase offline locally; verified synthetic isolation on reload).
  - **PostgreSQL Integration:** 45/45 tests passing across 6 suites (`catalog-rls`, `golden-path`, `profiles-rls`, `spotify-connection-rls`, `ticketmaster-canonicalization`, `user-preferences-rls`).
- **Immediate Next Action:** Hand off PR #10 for follow-up code review. Do NOT merge automatically; do NOT implement recommendation scoring algorithms until PR #10 is reviewed and merged.
- **Phase 2 Status:** **ACTIVE — PR #10 REVIEW REMEDIATION COMPLETE & GREEN.**

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
