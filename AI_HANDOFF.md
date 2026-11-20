# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Encore V2 — Final Implementation Audit & Remediation (Completed & Verified)**.
- **Active Branch:** `feature/encore-v2-index-ticketmaster`
- **Base Commit:** `4009277a03a21bd2631107d9b964021884e7889c` (`feature/spotify-integration-repair`)
- **Active Implementing Team:** Google Antigravity (Lead Coordinator + Specialized Review Team)
- **Remediation Deliverables:**
  1. **Ticketmaster API Request Correctness:** Stripped undocumented `allInclusivePricing=true` from request query params; removed non-existent `estimatedFees` fields; accurately parsed `allInclusivePricing.enabled` from response `event.ticketing`; eliminated unsupported regulatory compliance claims.
  2. **Proven Live Ingestion & 100% Idempotency:** Executed live network queries against Ticketmaster and live HTML scrape against Z2 Entertainment (`z2ent.com/events`) into local Supabase (`127.0.0.1:54321`). Pass 1 ingested 36 live Ticketmaster + 23 live Z2 shows (catalog grew from 244 to 303 canonical events). Pass 2 proved 100% idempotency with 0 duplicate events created and 100% raw ingest reuse.
  3. **Temporal Bisection & Quota Safety:** Sub-day interval bisection (< 1 day), explicit truncation tracking (`isTruncated: true`, `hasIncompleteCoverage: true`, `truncatedPartitions`), provider header synchronization (`rate-limit-available`, `rate-limit-reset`), and cross-process file-based quota coordination.
  4. **Artist Role Integrity:** Eliminated speculative headliner/opener inferences; attractions lacking explicit billing metadata strictly retain `billingPosition: 'unknown'` while preserving list order.
  5. **Truth in Advertising on Index UI:** Removed fake presale badges, synthetic low-inventory counters, and automated push notification claims from watchlists; documented local browser storage scope; gracefully handled missing ticket links.
  6. **Comprehensive Verification:** 100% passing across formatting, linting, strict TypeScript typechecking, unit tests (858/858), PostgreSQL integration tests (104/104), Playwright browser tests (16/16), and Next.js production build.

---

## Verification Suite Results

- `npm run format:check`: **PASS** (100% Prettier code style)
- `npm run lint`: **PASS** (0 ESLint warnings, 0 errors)
- `npm run typecheck`: **PASS** (`tsc --noEmit`, 0 TypeScript errors)
- `npm test`: **PASS** (**63/63 test files, 858/858 unit tests passed in 5.85s**)
- `npm run test:integration`: **PASS** (**13/13 test files, 104/104 database integration tests passed in 21.11s**)
- `npx playwright test`: **PASS** (**16/16 Playwright browser tests passed in 21.3s**)
- `npm run build`: **PASS** (Next.js 15.5.27 production build clean, 18/18 routes compiled)
- `npx tsx scripts/verify-live-ingestion.ts`: **PASS** (303 canonical events in DB; Pass 2 100% idempotent with 0 duplicates)

---

## Key Invariants Preserved

1. **Safe Database Destinations:** Zero writes to production or remote databases without explicit authorization; `assertSafeDatabaseTarget` strictly enforced.
2. **Invariant 3 (Immutable Observations):** Raw ingests (`raw_ingests`) and candidate observations (`event_candidates`) remain immutable audit records.
3. **Invariant 4 (Field-Level Provenance):** Attribute traceability to source observations via `event_field_evidence`.
4. **Invariant 5 (Conservative Entity Resolution):** Disambiguate artists and external IDs strictly; ambiguous names or conflicting external IDs are never merged.
5. **Invariant 10 (Timezones, Currencies & Prices):** Local calendar dates computed in venue IANA timezone (`America/Denver`); no speculative fee estimates.
6. **Invariant 11 (Manual Preference Precedence):** Explicit manual preferences strictly take precedence over inferred Spotify listening affinities. Disliked headliner unconditionally suppresses event.
7. **Isolation of Synthetic Data:** Production routes, search queries, and sync scripts use strictly genuine catalog events from database or authorized providers; zero synthetic fixtures in production routes.
8. **Branch & Worktree Preservation:** `origin/main` (`3adbf59`), `feature/spotify-integration-repair` (`4009277`), and `encore_index_main_site` (`792d0b1`) completely untouched and preserved.

---

## Pull Request & Deliverables

1. **Pull Request:** Open at [#20](https://github.com/juko04/Encore-concert-finder/pull/20) (`feature/encore-v2-index-ticketmaster` $\to$ `main`).
2. **Remediation Report:** [`ENCORE_V2_FINAL_REMEDIATION_REPORT.md`](ENCORE_V2_FINAL_REMEDIATION_REPORT.md).
3. **Recommendation:** **GO (Approved for Merge)**.
