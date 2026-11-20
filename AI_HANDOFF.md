# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Encore V2 — Unified Index UI, Ticketmaster & Colorado Venue Coverage Implementation (Verified & Ready for Review)**.
- **Active Branch:** `feature/encore-v2-index-ticketmaster`
- **Base Commit:** `4009277a03a21bd2631107d9b964021884e7889c` (`feature/spotify-integration-repair`)
- **Active Implementing Team:** Google Antigravity (Lead Coordinator + 6 Specialized Subagents: Ticketmaster API Engineer, Venue Ingestion Specialist, Canonical Data Specialist, Personalization & Search Specialist, Index UI Migration Specialist, Frontend Integration Specialist)
- **Delivered Capabilities:**
  1. **Encore Index Visual Design & Production Route Migration:** Ported approved Index UI into production App Router routes (`app/page.tsx`, `app/concerts/[id]/page.tsx`, `app/search/page.tsx`, `app/saved/page.tsx`, `app/preferences/page.tsx`). Wired directly to live Supabase catalog events rather than mock fixtures.
  2. **Ticketmaster V2 Discovery Engine:** Dynamic temporal date bisection (<950 threshold, 1-day min interval, max depth safety, idempotent deduplication), 5,000 req/day quota guard with circuit breaker at 4,750, automatic UTC midnight reset, fee transparency, and default `allInclusivePricing=true` query parameters.
  3. **Colorado Venue Coverage (Z2 Entertainment Shared Adapter):** Reusable shared adapter covering Boulder Theater, Fox Theatre, Aggie Theatre (Fort Collins), and Chautauqua Auditorium with validated `America/Denver` timezone, headliner/opener parsing, sold-out detection, and multi-venue calendar scraping.
  4. **Sold-Out Inventory Preservation:** Fixed coordinator gap in `canonicalization-coordinator.ts`, ensuring parsed `.sold-out` signals and `EventCandidate.inventoryStatus` flow into `event_ticket_links.inventory_status` and render as "Sold Out" badges in the UI.
  5. **Search & Multi-Factor Personalization:** Opener search support (`billingPosition >= 0`), price range & free event filtering, sorting (date, price, score), and Invariant 11 strict compliance.
  6. **Multi-Source Rolling Synchronization Automation:** Implemented `scripts/sync-all-sources.ts` and `npm run sync:all` with 4-tier scheduling horizons (`near-term`, `mid-term`, `long-term`, `full`), quota guards, and isolated failure handling.
  7. **Playwright Browser E2E:** 12/12 passing browser tests verifying full user journey across `/`, `/search`, `/saved`, `/preferences`, and Spotify personalization.

---

## Verification Suite Results

- `npm run format:check`: **PASS** (100% Prettier code style)
- `npm run lint`: **PASS** (0 ESLint warnings, 0 errors)
- `npm run typecheck`: **PASS** (`tsc --noEmit`, 0 TypeScript errors)
- `npm test`: **PASS** (**63/63 test files, 858/858 unit tests passed in 6.34s**)
- `npx playwright test`: **PASS** (**16/16 Playwright browser tests passed in 33.7s**)
- `npm run test:integration`: **PASS** (**13/13 test files, 104/104 database integration tests passed in 30.5s**)
- `npm run build`: **PASS** (Next.js 15.5.27 production build clean, 18/18 routes compiled)
- `npm run sync:all -- --fixture`: **PASS** (8 sources synced in 0.60s, 282 candidates extracted, 256 canonical events created, 12 sold-out events detected)
- **GitHub Actions CI:** **PASS** (Run `44653236261`, 15/15 workflow steps green on Ubuntu 24.04 LTS runner)

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

## Pull Request & Next Steps

1. **Pull Request:** Open at [#20](https://github.com/juko04/Encore-concert-finder/pull/20) (`feature/encore-v2-index-ticketmaster` $\to$ `main`).
2. **Implementation Report:** [`ENCORE_V2_COMBINED_IMPLEMENTATION_REPORT.md`](ENCORE_V2_COMBINED_IMPLEMENTATION_REPORT.md).
3. **CI Status:** Green (0 failing, 1 successful check). Ready for peer review and user signoff before merge.
