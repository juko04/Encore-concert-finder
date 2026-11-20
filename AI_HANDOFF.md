# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Encore PR #20 — Merge-Blocking Remediations & Final Review (Completed & Verified)**.
- **Active Branch:** `feature/encore-v2-index-ticketmaster`
- **Base Commit:** `4009277a03a21bd2631107d9b964021884e7889c` (`feature/spotify-integration-repair`)
- **Active Implementing Team:** Google Antigravity (Lead Coordinator + Specialized Review Team)
- **Remediations Summary (Findings 1–6):**
  1. **Finding 1 (Partitioner Pipeline Connection):** Connected the temporal date bisection coordinator to `runTicketmasterIngestion`. Raw responses across all partition pages are preserved with provenance and content hashing. Candidates are deduplicated across partition boundaries, and incomplete coverage states are surfaced.
  2. **Finding 2 (Production Ingestion Authorization):** Refactored `destination-guard.ts` to implement a secure, opt-in execution path for authorized production ingestion via `--allow-production-write`, while enforcing a strict invariant that rejects synthetic fixtures from targeting remote/production databases under all conditions.
  3. **Finding 3 (Database-Side Filtering, Global Sorting, & Pagination):** Added a PostgreSQL rollup migration (`20261120000000_add_event_pricing_and_search_indexes.sql`) maintaining `min_price`, `max_price`, and `currency` via triggers on `event_ticket_links`. Moved price bounds, `freeOnly`, and global price sorting (`price_asc`, `price_desc`) directly into PostgreSQL before pagination. Refactored the search route handler and `SearchClient.tsx` to support debounced, responsive server-side pagination across datasets larger than 500 events without truncation.
  4. **Finding 4 (Process-Safe Atomic Quota Coordination):** Implemented atomic file locking (`.lock` files via `fs.openSync` flag `'wx'`) and exponential backoff in `TicketmasterQuotaGuard`. Added future reset window protection so local midnight crossing never resets counters while the provider is still throttling.
  5. **Finding 5 (Strict Live Verification Assertions & Exit Codes):** Updated `scripts/verify-live-ingestion.ts` to assert that Pass 2 produces 0 duplicate canonical events (`canonicalEventsCreated === 0`) and all source events correspond to valid canonical records. Ensured failure of any assertion exits with a non-zero exit code (`process.exit(1)`).
  6. **Finding 6 (Configurable Geographic Coverage & Nationwide Tours):** Extended `scripts/sync-all-sources.ts` to support multi-state scheduling (`--states=CO,UT,WY,NM`), multi-horizon schedules (`near-term`, `mid-term`, `long-term`, `full`), nationwide tour lookups for verified favorite artists (`preference_level = 'favorite'`), and nationwide festival tracking.

---

## Verification Suite Results

- `npm run format:check`: **PASS** (100% Prettier code style)
- `npm run lint`: **PASS** (0 ESLint warnings, 0 errors)
- `npm run typecheck`: **PASS** (`tsc --noEmit`, 0 TypeScript errors)
- `npm test`: **PASS** (**66/66 test files, 894/894 unit tests passed**)
- `npm run test:integration`: **PASS** (**14/14 test files, 108/108 database integration tests passed**)
- `npx playwright test`: **PASS** (**16/16 Playwright browser tests passed**)
- `npm run build`: **PASS** (Next.js 15.5.27 production build clean, 19/19 routes compiled)
- `scripts/verify-live-ingestion.ts`: **PASS** (306 canonical events in DB; Pass 2 100% idempotent with 0 duplicates; 10 event_sources relations verified with 0 orphans)
- **GitHub Actions Remote CI:** **PASS** (Run `#116` / `44677461105` on commit `9106122` completed green in 5m48s)

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
2. **Remediation Report:** [`ENCORE_V2_PR20_FINAL_REVIEW.md`](ENCORE_V2_PR20_FINAL_REVIEW.md).
3. **Recommendation:** **GO (Approved for Merge)**.
