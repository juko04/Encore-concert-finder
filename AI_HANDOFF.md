# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-spotify-integration`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR #10: Spotify Connection & Music Taste Import — COMPLETE, GREEN, AND READY FOR REVIEW.
- **Deliverables & Invariants Implemented:**
  1. **PostgreSQL Schema & Zero-Client RLS (`user_spotify_connections`):**
     - Created `supabase/migrations/20261016000000_create_user_spotify_connections.sql` with `user_id` (PK, cascade delete), `UNIQUE(spotify_account_id)` 1-to-1 account constraint, encrypted access & refresh tokens, `token_expires_at`, `reauthorization_deadline`, and connection status enum (`connected`, `expired`, `disconnected`, `revoked`).
     - Zero-client RLS policy: strictly no select/insert/update/delete policies granted to `authenticated` or `anon`. Accessible exclusively via trusted server backend functions running with `service_role`.
  2. **AES-256-GCM Token Encryption at Rest:**
     - Created `lib/security/crypto.ts` with authenticated AES-256-GCM encryption/decryption using 12-byte randomized IVs and 16-byte integrity authentication tags. Tested with tampering detection in `tests/unit/security-crypto.test.ts`.
  3. **Repository Implementations & Parity:**
     - Defined `ISpotifyConnectionRepository` in `lib/repositories/interfaces.ts`.
     - Implemented `SupabaseSpotifyConnectionRepository` in `lib/repositories/spotify-connection-repository.ts` with automatic token encryption on write, decryption on read, and atomic 1-to-1 account conflict detection (`SpotifyAccountConflictError`).
     - Implemented `MemorySpotifyConnectionRepository` in `lib/repositories/memory-repositories.ts`.
  4. **Spotify OAuth 2.0 PKCE & Hardened Cookies:**
     - Created `lib/sources/spotify/oauth.ts` implementing RFC 7636 Authorization Code Flow with S256 code challenge generation, CSRF state verification, and loopback HTTP vs HTTPS cookie discipline (`httpOnly`, `sameSite: 'lax'`, short 10-minute max-age).
  5. **Spotify API Client & Rate-Limit / Quota Handling:**
     - Created `lib/sources/spotify/client.ts` with typed methods for authorization code exchange, token refresh, `getCurrentUser()` (prioritizing stable `account_id`), and `getTopArtists()`.
     - Explicit domain error classifications: `SpotifyAuthenticationError` (401), `SpotifyForbiddenError` (403 Developer Mode allowlist restriction), `SpotifyRateLimitError` (429 with Retry-After header parsing).
  6. **Development-Only Interactive Preview Mode:**
     - Created `lib/sources/spotify/synthetic-preview.ts` providing realistic listening data across short-term (4 weeks), medium-term (6 months), and long-term (all-time / 1 year) windows.
     - Illustrates the 60% short / 30% medium / 10% long-term recency hypothesis (surfacing rising, consistent staple, and fading historical favorites) without prematurely turning it into automated recommendation scoring.
  7. **API Endpoints & Server Actions:**
     - Implemented `/api/integrations/spotify/connect`, `/callback`, `/disconnect`, and `/top-artists`.
     - Added server actions in `app/profile/taste/actions.ts`: `getSpotifyStatusAction`, `disconnectSpotifyAction`, and `getSpotifyTopArtistsAction`.
  8. **Taste Profile UI Integration:**
     - Implemented `components/taste/SpotifyConnectionCard.tsx` (disconnected status, beta allowlist notice, connect link, interactive preview toggle, connected badge with account ID, sync time, and disconnect workflow).
     - Implemented `components/taste/SpotifyTastePreview.tsx` (time horizon tabs, recency hypothesis banner, artist cards with trend badges, and intentional "+ Add to Interests" action calling `savePreferenceAction`).
     - Integrated into `components/taste/TasteProfileManager.tsx` and `app/profile/taste/page.tsx`.
- **Verification State:** ALL VERIFICATIONS GREEN:
  - **Unit Tests:** 272/272 passing across 24 test suites (100% pass rate).
  - **Code Style & Formatting:** `npm run format:check` passing clean (Prettier).
  - **Linting:** `npm run lint` passing with 0 errors and 0 warnings (Next.js ESLint).
  - **Type Checking:** `npm run typecheck` (`tsc --noEmit`) passing with 0 errors.
  - **Production Build:** `npm run build` compiled successfully (10/10 static/dynamic routes generated).
  - **Playwright E2E:** 6 passed (2 skipped when Supabase offline locally).
  - **PostgreSQL Integration:** 42/42 tests passing across 6 suites (`catalog-rls`, `golden-path`, `profiles-rls`, `spotify-connection-rls`, `ticketmaster-canonicalization`, `user-preferences-rls`).
- **Immediate Next Action:** Hand off PR #10 for independent code review. Do NOT merge automatically; do NOT implement recommendation scoring algorithms until PR #10 is reviewed and merged.
- **Phase 2 Status:** **ACTIVE — PR #10 READY FOR CODE REVIEW.**

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
