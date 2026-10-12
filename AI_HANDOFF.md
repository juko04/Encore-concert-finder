# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-ingestion-reliability`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2, PR 3: Ingestion Reliability & Discover Improvements — IMPLEMENTATION COMPLETE, READY FOR PR.
- **Deliverables & Remediation:**
  1. **Error Taxonomy & Redaction:** Implemented classified ingestion error classes (`TicketmasterAuthError`, `TicketmasterRateLimitError`, `TicketmasterNetworkError`, `TicketmasterValidationError`, `PipelineDatabaseError`) and robust error classifier `classifyIngestionError()` with automatic API key and credential redaction across URLs, messages, and traces.
  2. **Truthful Ingestion Telemetry:** Enhanced pipeline and CLI runner with execution timing (`startedAt`, `completedAt`, `durationMs`), query scope logging, candidate review breakdown (`missing_venue_identity`, `missing_venue_locality`, etc.), and structured remediation guidance on failure.
  3. **Discover Source Attribution (Tech Debt 1.3):** Added `sources` to `CanonicalEventSummary`, batched source joins in catalog repositories, and rendered subtle provenance badges with `data-testid="source-badge"` on `EventCard.tsx`.
  4. **Incomplete Event & Venue Handling (Tech Debt 1.4):** Rendered `<span data-testid="venue-tba-badge">Venue TBA / Unknown</span>` when venue name is missing or placeholder without fabricating event title or artist name; preserved locality display, neutral price formatting, and status badges.
  5. **N+1 Catalog Query Optimization (Phase 1 Deferral 2.1):** Batch-fetched artists, ticket links, and sources using `.in('event_id', eventIds)` in `SupabaseCatalogRepository.listEvents`, reducing catalog queries from 1 + 3N to 4.
  6. **Candidate Isolation Invariant:** Verified that unresolved and `needs_review` candidates exist strictly in `event_candidates` and are never exposed on `/discover`.
- **Verification State:** ALL GREEN:
  - `npm run format:check`: 100% compliant with Prettier.
  - `npm run lint`: 0 warnings, 0 errors.
  - `npm run typecheck`: Strict TypeScript compile passed with 0 errors.
  - `npm test`: 181/181 unit tests passing across 14 test suites (100% pass rate).
  - `npm run build`: Next.js production compile successful.
  - `npm run test:e2e`: 3/3 Playwright browser smoke tests passing.
  - `npm run test:integration`: 28/28 integration tests passing (or skipping gracefully when local DB is offline).
- **Immediate Next Action:** Open PR #8 against `main`, monitor CI until green, and await independent code review. Do not merge automatically.
- **Phase 2 Status:** **ACTIVE — PR 3 IMPLEMENTATION COMPLETE, OPENING PR.**

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
