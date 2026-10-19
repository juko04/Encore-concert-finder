# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-spotify-integration`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR #10: Spotify Connection & Music Taste Import — THIRD INDEPENDENT REVIEW REMEDIATIONS COMPLETE & VERIFIED GREEN.
- **Third Review Findings Addressed & Remediated:**
  1. **Preserve and Validate Spotify Artist Identities (`lib/repositories/user-preference-repository.ts`, `lib/repositories/memory-repositories.ts`, `lib/domain/user-preference.ts`):**
     - Updated `SupabaseUserPreferenceRepository.savePreference()` and `MemoryUserPreferenceRepository.savePreference()` to preserve existing `spotify_artist_id` when an ordinary catalog search preference update omits a provider ID.
     - Verified identity consistency using trusted external-ID mappings (`artist_external_ids`); introduced and threw `ConflictingArtistIdentityError` whenever a client supplies conflicting canonical and Spotify IDs or unmapped provider IDs.
     - Maintained strict parity between Supabase and memory repositories.
     - Added unit and PostgreSQL integration regression tests covering catalog search update preservation, contradictory identity rejection, unverified ID rejection, same-name artist independence, and database reload verification.
  2. **Allow Disconnecting Expired Spotify Accounts (`components/taste/SpotifyConnectionCard.tsx`, `components/taste/TasteProfileManager.tsx`, `lib/repositories/spotify-connection-repository.ts`, `lib/repositories/memory-repositories.ts`, `app/api/integrations/spotify/disconnect/route.ts`, `app/profile/taste/actions.ts`, `app/api/integrations/spotify/top-artists/route.ts`):**
     - Updated `SpotifyConnectionCard.tsx` to surface an accessible `Disconnect` button whenever a stored connection exists (including `expired` and `revoked` statuses), regardless of whether Spotify is reachable or an encryption key is present.
     - Preserved clear `Reconnect Spotify` action and expired reauthorization warning alongside stored account details.
     - Confirmed credential deletion before returning success in `disconnectSpotifyAction` and `/api/integrations/spotify/disconnect`.
     - Prevented `getConnectionTokens()` in both Supabase and Memory repositories from returning usable tokens for expired, revoked, or past-deadline connections.
     - Enforced that top-artist requests never execute Spotify API calls when authorization is expired or past deadline.
     - Tested complete lifecycle sequence: connect account -> mark expired -> confirm no Spotify API calls permitted -> confirm user can still disconnect -> verify DB credential row deleted -> verify manual preferences unchanged.
- **Verification State:** ALL VERIFICATIONS GREEN:
  - **Unit Tests:** 309/309 passing across 25 test suites (100% pass rate).
  - **Code Style & Formatting:** `npm run format:check` passing clean (Prettier).
  - **Linting:** `npm run lint` passing with 0 errors and 0 warnings (Next.js ESLint).
  - **Type Checking:** `npm run typecheck` (`tsc --noEmit`) passing with 0 errors.
  - **Production Build:** `npm run build` compiled successfully (10/10 static/dynamic routes generated).
  - **Playwright E2E:** 6 passed (2 skipped when Supabase offline locally; verified synthetic container isolation).
  - **PostgreSQL Integration:** 50/50 tests passing across 6 suites (`catalog-rls`, `golden-path`, `profiles-rls`, `spotify-connection-rls`, `ticketmaster-canonicalization`, `user-preferences-rls`).
- **Immediate Next Action:** Hand off PR #10 for final approval. Do NOT merge automatically; do NOT implement recommendation scoring algorithms until PR #10 is approved and merged.
- **Phase 2 Status:** **ACTIVE — PR #10 THIRD REVIEW REMEDIATION COMPLETE & GREEN.**

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
