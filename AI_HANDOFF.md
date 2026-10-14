# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-music-preferences`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR 4A: Manual Music Taste Profile — SECOND INDEPENDENT REVIEW REMEDIATION COMPLETE.
- **Deliverables & Remediation:**
  1. **Exact Preference-ID Updates for Archived Artist Preferences:** Added `updatePreferenceLevel(userId, preferenceId, preferenceLevel)` to repository interfaces and implemented in `SupabaseUserPreferenceRepository` and `MemoryUserPreferenceRepository` enforcing exact `(id, user_id)` matching. Updated `TasteProfileManager.tsx` to modify client-side state and invoke `updatePreferenceLevelAction` strictly by preference ID. Added regression tests in unit and PostgreSQL integration suites proving archived and uncataloged preferences sharing identical artist names update independently without cross-mutation.
  2. **Integration Test Destination Guards & Clean Migration Execution:** Integrated `assertSafeDatabaseTarget(credentials.url, false)` in `tests/integration/user-preferences-rls.test.ts`, removed ad-hoc migration execution via RPC (`execute_sql`), and added assertions validating rejection of spoofed/remote database URLs (`https://evil-local.com`, `https://attacker.dev`, `https://project-ref.supabase.co`).
  3. **Real Authenticated Browser E2E Test:** Added `tests/e2e/taste-auth.spec.ts` verifying complete end-to-end browser flows with Playwright against dev database: test user creation, sign-in, custom artist addition through UI, persistence across page reloads, inline tier modification, deletion, sign-out, and guest isolation verification. Updated `.github/workflows/ci.yml` to start local Supabase before running browser E2E tests.
  4. **Server-Side Error Privacy:** Sanitized all error returns in `app/profile/taste/actions.ts` (`savePreferenceAction`, `updatePreferenceLevelAction`, `deletePreferenceAction`) and `app/profile/taste/page.tsx` to prevent leaking raw PostgreSQL or Supabase error details to clients, keeping detailed diagnostics on the server console.
- **Verification State:** ALL VERIFICATIONS PASSING:
  - `npm run format:check`: 100% compliant with Prettier.
  - `npm run lint`: 0 warnings, 0 errors.
  - `npm run typecheck`: Strict TypeScript compile passed with 0 errors.
  - `npm test`: 218/218 unit tests passing across 16 test suites.
  - `npm run build`: Production Next.js build passes cleanly.
- **Immediate Next Action:** Push branch `feature/phase-2-music-preferences`, verify GitHub CI on PR #9, and report remediation results for review. Do NOT merge automatically; do NOT begin PR 4B (Spotify) until PR 4A is reviewed and merged.
- **Phase 2 Status:** **ACTIVE — PR 4A SECOND REVIEW REMEDIATION COMPLETE, AWAITING FINAL REVIEW.**

---

## What the Next Agent Must Know

1. **PR 4A Architecture & Invariants:**
   - **Catalog Independence:** Preferences have `artist_id ... ON DELETE SET NULL`. Canonical artist changes or deletions never delete user preference records.
   - **No Free-Text Canonicalization:** Uncataloged user artist entries are stored with `artist_id = NULL` and never create rows in `public.artists`.
   - **No Auto-Reconciliation by Name:** Unmatched preferences remain unmatched until explicit user selection, verified disambiguation, or trusted external identifier matching occurs.
   - **RLS Ownership:** Every preference mutation is scoped to `auth.uid() = user_id`. Never bypass via service-role key for user CRUD.
2. **Upcoming PR 4B Scope (Spotify Authentication & Taste Ingestion):**
   - Spotify Development Mode quota: up to five (5) authorized user accounts per app (the 25-limit applies to developer client IDs per account).
   - Use standard loopback address `http://127.0.0.1:3000/...` for local OAuth callbacks.
   - Implement PKCE flow and store tokens server-side in `user_spotify_connections`.
   - Ingest listening data into a separate relational structure (`user_artist_affinities`) without modifying or overwriting explicit manual preferences in `user_artist_preferences`.
3. **Deterministic Fixtures Only in CI:** Unit tests and CI must NEVER make live external API calls to Ticketmaster or Spotify.
4. **Security & Secrets:** All API keys (`TICKETMASTER_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) are server-only. Never expose secrets in client bundles.
