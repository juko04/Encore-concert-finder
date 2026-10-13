# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-ingestion-reliability`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR 3: Ingestion Reliability & Discover Improvements — INDEPENDENT REVIEW REMEDIATIONS COMPLETE.
- **Deliverables & Remediation:**
  1. **Removed Fabricated Source Attribution:** Eliminated URL substring and partial UUID matching in `MemoryCatalogRepository.listEvents()`; removed `"Verified"` fallback in `EventCard.tsx` in favor of a neutral `Unknown Source` state without implying verification. Added unit tests for known, unknown, and multiple sources.
  2. **Safe Error Report Serialization:** Implemented recursive `sanitizeErrorDetails()` ensuring nested Error objects, credentials (`apikey`, `Bearer`, etc.), and circular references are sanitized safely for `JSON.stringify()`.
  3. **Truthful Telemetry Under Replay:** Differentiated newly inserted candidate rows from existing candidates returned by idempotent repository operations. Unchanged previously created events are no longer reported as newly matched during replay. Defined and tested counters for first ingestion, identical replay, updated provider observations, and review candidates.
  4. **Database-Backed Catalog Regression Coverage:** Added targeted PostgreSQL integration tests in `tests/integration/catalog-rls.test.ts` verifying source joins, multiple current sources, exclusion of inactive/historical relationships, missing data handling, and anon RLS read support after the N+1 query refactor.
  5. **Failure Classification & Source-Health Tracking:** Prevented parsing/validation errors from being labeled database errors; invoked `sourceRepo.recordFailure()` on all failure modes, ensuring failed runs cannot report success.
- **Verification State:** ALL GREEN:
  - `npm run format:check`: 100% compliant with Prettier.
  - `npm run lint`: 0 warnings, 0 errors.
  - `npm run typecheck`: Strict TypeScript compile passed with 0 errors.
  - `npm test`: 187/187 unit tests passing across 14 test suites (100% pass rate).
  - `npm run build`: Next.js production compile successful.
  - `npm run test:e2e`: 3/3 Playwright browser smoke tests passing.
  - `npm run test:integration`: 29/29 integration tests passing (or skipping gracefully when local DB is offline).
- **Immediate Next Action:** PR #8 CI is 100% green. Await final independent code review approval before merge. Do not merge automatically.
- **Phase 2 Status:** **ACTIVE — PR 3 REMEDIATIONS APPLIED, CI 100% GREEN, AWAITING FINAL REVIEW.**

---

## What the Next Agent Must Know

1. **Phase 2 PR 3 Architecture & Delivery:**
   - **Error Taxonomy:** Located in `lib/sources/ticketmaster/errors.ts`. All client and pipeline errors classify cleanly with credential redaction.
   - **Telemetry:** Pipeline returns `durationMs`, `startedAt`, `completedAt`. CLI runner formats human-readable run summaries and structured failure reports.
   - **Source Attribution:** `event_sources` joined with `sources` batch-loaded without N+1 queries. Displayed via `data-testid="source-badge"` in `components/catalog/EventCard.tsx`.
   - **Venue TBA Badge:** Missing venue names display `Venue TBA / Unknown` via `data-testid="venue-tba-badge"`.
   - **N+1 Query Elimination:** `SupabaseCatalogRepository.listEvents` queries in 4 batch requests.
2. **Upcoming PR 4 Scope (Spotify Authentication & Taste Ingestion):**
   - OAuth Authorization Code Flow with PKCE via server-side API routes (`/api/auth/spotify/login`, `/api/auth/spotify/callback`).
   - Secure token persistence in `user_spotify_connections` with strict RLS (`auth.uid() = user_id`) and service-role write.
   - Ingestion of user top artists into `user_artist_affinities`.
   - Preserve manual user artist preference selection as a first-class alternative (mitigates Spotify Development Mode 25-user limit).
   - Do NOT implement recommendation scoring in PR 4 (deferred to PR 5 & 6).
3. **Deterministic Fixtures Only in CI:** Unit tests and CI must NEVER make live external API calls to Ticketmaster or Spotify.
4. **Security & Secrets:** All API keys (`TICKETMASTER_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) are server-only. Never expose secrets in client bundles.
5. **Read-Only Project Hub:** The Project Hub at `/hub` remains strictly read-only and unaffected by ingestion routines.
