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
  2. **Safe Error Report Serialization & Nested Metadata:** Implemented recursive `sanitizeErrorDetails()` with strict validation for `statusCode` and `code`, recursive sanitization of custom Error metadata and properties, redaction of untrusted Error names and object keys, circular reference protection, and credential stripping. Added regression test asserting zero secrets in serialized report.
  3. **Truthful Telemetry Under Replay & Interrupted Recovery:** Decoupled `candidatesReused` (existing candidate records reused from database) from `candidatesSkipped` (candidates whose canonicalization is skipped due to existing resolutions). Verified telemetry counters across First Ingestion, Interrupted Recovery, Identical Replay, Reprocess, and Updated Observations.
  4. **Database-Backed Catalog Regression Coverage:** Added targeted PostgreSQL integration tests in `tests/integration/catalog-rls.test.ts` verifying source joins, multiple current sources, exclusion of inactive/historical relationships, missing data handling, and anon RLS read support after the N+1 query refactor.
  5. **Failure Classification & Source-Health Tracking Across Fetch & Persistence:** Wrapped `adapter.fetch()` in persistence mode to invoke `sourceRepo.recordFailure()` on network/rate-limit/auth/validation failures while preserving strict zero-write read-only dry-run isolation.
- **Verification State:** ALL GREEN:
  - `npm run format:check`: 100% compliant with Prettier.
  - `npm run lint`: 0 warnings, 0 errors.
  - `npm run typecheck`: Strict TypeScript compile passed with 0 errors.
  - `npm test`: 191/191 unit tests passing across 14 test suites (100% pass rate).
  - `npm run build`: Next.js production compile successful.
  - `npm run test:e2e`: 3/3 Playwright browser smoke tests passing.
  - `npm run test:integration`: 29/29 integration tests passing (or skipping gracefully when local DB is offline).
- **Immediate Next Action:** Push second-review remediation commits to `origin/feature/phase-2-ingestion-reliability`, monitor PR #8 CI until green, and await final independent code review approval before merge. Do not merge automatically.
- **Phase 2 Status:** **ACTIVE — PR 3 SECOND-REVIEW REMEDIATIONS COMPLETE, AWAITING FINAL REVIEW.**

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
