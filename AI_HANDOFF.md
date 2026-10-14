# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-music-preferences`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR 4A: Manual Music Taste Profile — IMPLEMENTATION COMPLETE.
- **Deliverables & Architecture:**
  1. **Relational Schema & Catalog Independence:** Migration `supabase/migrations/20261014000000_create_user_artist_preferences.sql` creates `public.user_artist_preferences` with `artist_id ... ON DELETE SET NULL`. If a canonical artist is deleted or retired in PostgreSQL, user preferences are preserved with `artist_id = NULL` and original artist names intact.
  2. **Strict Signal Separation:** `user_artist_preferences` stores explicit manual user live-attendance preferences (`favorite`, `like`, `interested`, `dislike`). Spotify listening signals are isolated to PR 4B in a separate relational structure.
  3. **Functional Authentication Prerequisite:** Implemented `app/login/page.tsx`, `components/auth/LoginForm.tsx`, and `app/login/actions.ts` (`signInAction`, `signUpAction`, `signOutAction`) with cryptographically verified server session helper `getAuthenticatedUser()` using Supabase Auth.
  4. **Artist Search Safety:** Added `escapeLikePattern()` for literal SQL `ILIKE` wildcard escaping (`%`, `_`, `\`). Bounded query limit (max 25) in `ICatalogRepository.searchArtists()`, implemented in `SupabaseCatalogRepository` and `MemoryCatalogRepository`. Added `/api/artists/search` route returning public artist data without leaking private preferences.
  5. **Music Taste Profile Interface:** Built `/profile/taste` with `/taste` redirect. Includes debounced artist search with autocomplete, custom uncataloged artist addition, visual tier badges, inline preference level switcher, filter tabs (All, Favorites, Liked, Interested, Disliked), deletion with optimistic updates, and a comprehensive `GuestTastePrompt` with direct sign-in entry points.
  6. **Row Level Security (RLS):** Enabled strict RLS policies on `user_artist_preferences` (`auth.uid() = user_id`) for SELECT, INSERT, UPDATE, DELETE. User mutations execute through user session clients, never service-role bypasses.
- **Verification State:** ALL GREEN:
  - `npm run format:check`: 100% compliant with Prettier.
  - `npm run lint`: 0 warnings, 0 errors.
  - `npm run typecheck`: Strict TypeScript compile passed with 0 errors.
  - `npm test`: 210/210 unit tests passing across 16 test suites (100% pass rate).
  - `npm run build`: Next.js production compile successful (all 10 routes generated).
  - `npm run test:e2e`: 6/6 Playwright browser smoke tests passing.
  - `npm run test:integration`: 33/33 integration tests passing (with graceful fallback when local DB is offline).
- **Immediate Next Action:** Push branch `feature/phase-2-music-preferences`, open PR for PR 4A, wait for GitHub CI, and stop for independent code review. Do NOT begin PR 4B (Spotify) until PR 4A is approved and merged.
- **Phase 2 Status:** **ACTIVE — PR 4A COMPLETE, CI 100% GREEN, AWAITING REVIEW.**

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
