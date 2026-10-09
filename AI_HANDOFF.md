# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 2 — Live Ingestion & Personalization**.
- **Active Specification:** [`docs/phases/active/PHASE_2_IMPLEMENTATION.md`](docs/phases/active/PHASE_2_IMPLEMENTATION.md).
- **Current Branch:** `docs/phase-2-specification`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 2 Kickoff, Codebase Audit & Implementation Specification — COMPLETE.
- **Verification State:** ALL CHECKS GREEN (`format:check`, `lint` with 0 warnings, `typecheck`, 103/103 unit tests across 10 suites, 3/3 Playwright smoke tests, Next.js production build).
- **Immediate Next Action:** Await repository owner review and approval of the Phase 2 specification and PR breakdown before opening the first implementation branch (`feature/phase-2-ticketmaster-ingestion`).
- **Phase 2 Status:** **ACTIVE — PLANNING COMPLETE.** Ready for PR 1.

---

## What the Next Agent Must Know

1. **Phase 1 Pipeline Is Proven:** Ingestion abstractions, raw ingests, candidate extraction, entity resolution, and the atomic `apply_canonicalization` PostgreSQL stored procedure are fully proven with 21/21 integration tests. Extend this pipeline; do not replace it.
2. **Phase 2 Boundary Discipline:** Phase 2 is broken into 6 focused PRs (PR 1: Ticketmaster Ingestion Foundation, PR 2: Canonicalization Integration & Verification, PR 3: Operational Safeguards & UI Polish, PR 4: Spotify OAuth & Taste Ingestion, PR 5: Recommendation Feature Foundation, PR 6: Ranked Discovery Views). Do not combine workstreams.
3. **Deterministic Fixtures Only in CI:** Unit tests and CI must NEVER make live external API calls to Ticketmaster or Spotify. All tests must execute against sanitized static fixtures.
4. **Security & Secrets:** All API keys (`TICKETMASTER_API_KEY`, Spotify credentials, `SUPABASE_SERVICE_ROLE_KEY`) are server-only via `getServerEnv()`. Never expose secrets in client bundles or public configs.
5. **Read-Only Project Hub:** The Project Hub at `/hub` is strictly read-only and must remain unaffected by ingestion routines except for optional read-only stats/telemetry.
