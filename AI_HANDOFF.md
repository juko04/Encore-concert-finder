# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-music-preferences`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR 4A: Manual Music Taste Profile — FINAL REVIEW TEST-INFRASTRUCTURE REMEDIATION COMPLETE.
- **Deliverables & Remediation:**
  1. **Pre-Playwright Supabase Initialization in CI:** Configured `.github/workflows/ci.yml` to start local Supabase (`npm run db:start && npm run db:reset`) and dynamically export authoritative credentials (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`) to `$GITHUB_ENV` before Next.js production build and Playwright execution. Removed all database startup and reset logic from `tests/e2e/taste-auth.spec.ts`'s `beforeAll` hook.
  2. **Eliminated Hardcoded Fallback JWTs:** Removed hardcoded demo JWT fallback strings from `playwright.config.ts`, `tests/e2e/taste-auth.spec.ts`, and all integration test suites (`catalog-rls`, `golden-path`, `profiles-rls`, `ticketmaster-canonicalization`, `user-preferences-rls`). All test files and Playwright configuration now dynamically resolve credentials from the live running instance via environment variables or `npx supabase status -o json`, returning `null` if unavailable.
  3. **Fail-Closed CI Verification:** `tests/e2e/taste-auth.spec.ts` enforces fail-closed behavior in CI (`process.env.CI`): if credentials cannot be resolved or local Supabase is unresponsive, the test immediately throws a hard error. In local development without Docker, tests continue to skip cleanly with diagnostic messaging.
  4. **Strict Security & Destination Safeguards:** Preserved `assertSafeDatabaseTarget` across all test suites, prohibiting remote or non-local database execution.
- **Verification State:** ALL VERIFICATIONS PASSING GREEN IN GITHUB ACTIONS CI (Run ID `38800991661` on commit `e570b4c`):
  - **CI Workflow Status:** 100% green (`gh pr checks 9` passed).
  - **Browser E2E Suite:** All 7/7 browser tests executed and passed (0 skipped), including the authenticated lifecycle test (`taste-auth.spec.ts`) executing against the live local Supabase stack in CI.
  - **PostgreSQL Integration Suite:** All 37/37 integration tests passed against live local Supabase across 5 suites (`golden-path`, `catalog-rls`, `user-preferences-rls`, `profiles-rls`, `ticketmaster-canonicalization`).
  - **Unit Suite:** 223/223 unit tests passing across 17 test suites (100% pass rate).
  - **Build & Quality:** `format:check`, `lint`, and both pre-build and post-build `typecheck` passed with 0 warnings and 0 errors; production Next.js build compiled cleanly.
- **Immediate Next Action:** Hand off PR #9 for final review and approval. Do NOT merge automatically; do NOT begin PR 4B (Spotify) until PR 4A is approved and merged.
- **Phase 2 Status:** **ACTIVE — PR 4A READY FOR MERGE APPROVAL.**

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
