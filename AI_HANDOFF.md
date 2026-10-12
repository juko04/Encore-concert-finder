# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `feature/phase-2-ticketmaster-canonicalization`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2 PR 2: Ticketmaster Canonicalization Integration — IMPLEMENTATION & VERIFICATION COMPLETE.
- **Verification State:** ALL GREEN:
  - `npm run format:check`: 100% compliant with Prettier.
  - `npm run lint`: 0 warnings, 0 errors.
  - `npm run typecheck`: Strict TypeScript compile passed with 0 errors.
  - `npm test`: 155/155 unit tests passing across 12 test suites (including 20/20 in `ticketmaster-canonicalization.test.ts`).
  - `npm run build`: Next.js production compile successful.
  - `npm run test:e2e`: 3/3 Playwright browser smoke tests passing.
  - `npm run test:integration`: 23/23 integration tests passing / gracefully skipping when local Supabase is offline.
  - `npm run ingest:ticketmaster -- --fixture`: Safe dry-run preview verified with full telemetry.
- **Immediate Next Action:** Create commit, push branch, open Pull Request for PR 2, monitor CI, and await independent code review. Do not merge automatically.
- **Phase 2 Status:** **ACTIVE — PR 2 READY FOR REVIEW.**

---

## What the Next Agent Must Know

1. **Phase 2 PR 2 Architecture & Delivery:**
   - **Source Registration:** Deterministic lookup or registration of `ticketmaster-discovery` (UUID `b0000000-0000-0000-0000-000000000003`) in `lib/sources/ticketmaster/source-registry.ts`.
   - **Pipeline Execution:** Reusable `runTicketmasterIngestion` pipeline in `lib/sources/ticketmaster/ingestion-pipeline.ts` with dry-run vs persist modes, audit immutability, foreign key consistency, and telemetry.
   - **CLI Runner:** Safe dry-run default with `--persist` and `--allow-production-write` guards in `scripts/ingest-ticketmaster.ts`.
   - **Tech Debt 1.2 Closed:** Atomic external ID enrichment on matched artists in `ArtistResolver`, `CanonicalizationCoordinator`, `MemoryCatalogRepository`, and PostgreSQL migration `20261012120000_enrich_matched_artist_external_ids.sql`.
   - **Entity Resolution Safeguards:** `missing_venue_identity`, `missing_venue_locality`, and `missing_artist_identity` route cleanly to `needs_review`.
2. **Upcoming PR 3 Scope:**
   - PR 3 covers Ingestion Reliability, Operational Safeguards & UI Polish (Tech Debt 1.3: source attribution badges on `/discover`, Tech Debt 1.4: unknown-venue display behavior). Do not implement Spotify integration or recommendation scoring in PR 3.
3. **Deterministic Fixtures Only in CI:** Unit tests and CI must NEVER make live external API calls to Ticketmaster or Spotify.
4. **Security & Secrets:** All API keys (`TICKETMASTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are server-only. Never expose secrets in client bundles.
5. **Read-Only Project Hub:** The Project Hub at `/hub` remains strictly read-only and unaffected by ingestion routines.
