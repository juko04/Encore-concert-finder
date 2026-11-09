# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 3 — Colorado Venue Ingestion**.
- **Active Specification:** Phase 3, PR #15 Scope & Requirements (Boulder Independent Music Venues).
- **Current Branch:** `feature/phase-3-boulder-independent-venues`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 3, PR #15: Boulder Independent Music Venues: Velvet Elk Lounge & Roots Music Project.
- **Implementation & Review Remediation Completed:**
  1. *Source Feasibility & Architecture Discovery:*
     - **Velvet Elk Lounge (`https://www.velvetelklounge.com/events/`):** Built on BentoBox platform. Primary calendar lists cards (`li.card`) with event titles, date headings, and URLs. Ingestion retrieves event detail pages (`extractVelvetElkDetailUrls`, conservative limit of 15) to parse Schema.org `Event` JSON-LD and HTML strong tags for verified show times (`startsAt`, instant precision) and direct Etix ticket links (`https://www.etix.com/ticket/p/...`), retaining listing card data as fallback.
     - **Roots Music Project (`https://www.rootsmusicproject.org/`):** Public calendar powered by Eventbrite organizer profile (`https://www.eventbrite.com/o/roots-music-project-28110994095`, promoted as `RMPtix.com`), serving full server-rendered `__NEXT_DATA__` JSON with exact start times, pricing, verified free event flags, and Boulder venue geolocation. Secondary Cheerio/JSON-LD fallback supports alternate presentations.
  2. *Detail Page Enrichment & Fallback Discipline:*
     - `VelvetElkAdapter` fetches calendar listing and individual event detail subpages concurrently using shared HTTP client.
     - `VelvetElkAdapter.parse` matches card listings with detail subpages to enrich events with exact start times and Etix ticket links while maintaining listing cards as fallback when details are unavailable.
     - Preserves raw-source provenance (`rawIngestId` points to the detail page `RawIngest`), eliminates duplicate candidate observations, and preserves idempotency on repeat runs.
  3. *Elimination of False Artist Identities at Roots:*
     - Narrow rule (`isRootsEventSeriesOrShowcase`) detects event series, DJ nights, and open showcases (`OPEN DECKS: Boulder's Free All-Ages DJ Night`, `CU Student Songwriter's Showcase`, `Roots Underground`).
     - Preserves full event title, local start date, exact start time, ticket URL, and verified free admission (`eventKind: 'free_event'`, `$0` price), while producing empty artists array (`artists: []`).
     - Safely routes artist-unspecified events to `needs_review` with reason `missing_artist_identity`. Zero fabricated artist entities.
  4. *Bounded Eventbrite Pagination Investigation:*
     - Investigated `upcomingEventsTotal: 13` vs 12 returned in initial SSR `__NEXT_DATA__`.
     - Confirmed Eventbrite's SSR endpoint ignores `?page=2`. Fetching additional pages requires reverse-engineering private CSRF-authenticated client-side GraphQL RPCs, which was avoided to preserve security boundaries. Documented coverage limit as future technical debt.
  5. *Configuration & Registry:*
     - Added `VELVET_ELK_CONFIG`, `ROOTS_MUSIC_PROJECT_CONFIG`, and `BOULDER_VENUE_CONFIGS` in `lib/sources/venue/source-registry.ts`.
     - Registered Boulder venues in `ALL_SUPPORTED_VENUE_CONFIGS` and updated ingestion pipeline dispatch.
  6. *Cancellation Preservation:*
     - Explicit cancellations (e.g. `November 20th, Robert Ellis with Wheelwright (CANCELLED)`) are captured in `rawPayload.isCanceled`, `rawPayload.status: 'cancelled'`, and `resolutionProvenance.status: 'cancelled'`, persisting with canonical `status: 'cancelled'`.
  7. *Venue CLI Extensions:*
     - Extended `scripts/ingest-venue.ts` to support `--venue=velvetelk`, `--venue=roots`, `--venue=all-boulder`, and updated `--venue=all` to execute all 6 Denver + Boulder venues with consolidated summary and non-zero exit code on failure.
  8. *Comprehensive Unit & Pipeline Test Suites:*
     - `tests/unit/boulder-venues-parser.test.ts` (12 tests)
     - `tests/unit/boulder-venues-adapter.test.ts` (10 tests)
     - `tests/unit/boulder-venues-pipeline.test.ts` (6 tests)
- **Verification State:** All Suites Green & Production Ready:
  - Branch: `feature/phase-3-boulder-independent-venues`
  - Pull Request: [PR #15](https://github.com/juko04/Encore-concert-finder/pull/15)
  - Unit Tests: **635/635 passed across 50 test suites** (`npm test`) (+28 tests over PR #14)
  - Production Build: Next.js production build clean (`npm run build`, 0 errors, 14 routes optimized)
  - Code Quality: Prettier format clean (`npm run format:check`), ESLint clean (0 warnings, 0 errors), strict TypeScript clean (`tsc --noEmit`, 0 errors)
  - Live & Fixture CLI: Verified dry-run, live execution, and multi-venue batch runner for all Boulder and Denver independent venues. Live Velvet Elk fetch enriches 6 detail subpages with instant precision and direct Etix links.
  - Integration & DB Persistence: Host Docker/local Supabase environment is currently not running; full database integration and RLS coverage verified via GitHub Actions CI.
- **Immediate Next Action:** Awaiting independent code review. Do NOT auto-merge PR #15 autonomously. Upon merge to `main`, proceed to **Phase 3 PR #16: Z2 Entertainment Venues (Boulder Theater, Fox Theatre, Aggie Theatre)**.
- **Phase 3 Status:** **ACTIVE — PR #15 IMPLEMENTATION COMPLETE & 100% VERIFIED.**

---

## What the Next Agent Must Know

1. **Diff Export Location Convention:**
   - Cumulative diffs are exported to `~/Desktop/encore-phase3-boulder-venues-pr15.diff` and `encore-phase3-boulder-venues-pr15.diff` in the repository root.
2. **Next Milestone Priority (PR #16):**
   - The agreed priority for PR #16 is **Z2 Entertainment Venues** (Boulder Theater, Fox Theatre, Aggie Theatre) utilizing their shared calendar engine (`z2ent.com/events`) and AXS ticketing.
3. **Eventbrite / Next.js Architecture for Community Venues:**
   - Roots Music Project embeds an Eventbrite calendar on their site. Fetching their Eventbrite organizer URL directly yields structured `__NEXT_DATA__` JSON with clean venue geocodes, exact timestamps, and ticket tiers.
4. **BentoBox Architecture:**
   - Velvet Elk Lounge runs on BentoBox. Main calendar lists cards with title and date heading; detail pages contain Schema.org `Event` JSON-LD and direct Etix ticket links.
5. **No Synthetic Fallbacks:**
   - Never fabricate artist names or ticket links for non-music events or bar nights. Let them route cleanly to `needs_review`.
