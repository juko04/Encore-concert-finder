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
- **Implementation Completed:**
  1. *Source Feasibility & Architecture Discovery:*
     - **Velvet Elk Lounge (`https://www.velvetelklounge.com/events/`):** Built on BentoBox platform. List page contains server-rendered cards (`li.card`) with event title, date headings, and links. Detail pages provide Schema.org `Event` JSON-LD with exact start time and direct Etix ticketing URLs.
     - **Roots Music Project (`https://www.rootsmusicproject.org/`):** The official venue site delegates public ticketing and schedules to their Eventbrite organizer profile (`https://www.eventbrite.com/o/roots-music-project-28110994095`, promoted as `RMPtix.com`), serving full server-rendered `__NEXT_DATA__` JSON with exact start times, pricing, verified free event flags, and venue geolocation. Cheerio/JSON-LD fallback handles alternate HTML presentations.
  2. *Modular Venue Source Architecture:*
     - Implemented `lib/sources/venue/velvet-elk/` (`types.ts`, `parser.ts`, `adapter.ts`, `index.ts`).
     - Implemented `lib/sources/venue/roots-music-project/` (`types.ts`, `parser.ts`, `adapter.ts`, `index.ts`).
     - Reused shared infrastructure: `EventSourceAdapter`, `http-client.ts`, `date-time.ts`, `canonicalization-coordinator.ts`, `MemoryCatalogRepository`.
  3. *Configuration & Registry:*
     - Added `VELVET_ELK_CONFIG`, `ROOTS_MUSIC_PROJECT_CONFIG`, and `BOULDER_VENUE_CONFIGS` in `lib/sources/venue/source-registry.ts`.
     - Registered Boulder venues in `ALL_SUPPORTED_VENUE_CONFIGS` and updated ingestion pipeline dispatch.
  4. *Non-Music Listing & Ambiguity Review Routing:*
     - Non-music events (marketing workshops, photography art sales, bar happy hours) produce empty artist arrays and safely route to `needs_review` with reasons `missing_artist_identity` or `missing_event_date`. Zero synthetic artist fabrication.
  5. *Verified Free Admission & Pricing Precision:*
     - Only listings with verified, non-contradictory free admission (e.g. `OPEN DECKS: Boulder's Free All-Ages DJ Night` with `$0` price and free flag) are tagged `eventKind: 'free_event'` and `price: { isFree: true, min: 0, max: 0, currency: 'USD' }`.
     - Unknown prices strictly preserve `price: undefined` (`eventKind: 'concert'`).
  6. *Cancellation Preservation:*
     - Explicit cancellations (e.g. `November 20th, Robert Ellis with Wheelwright (CANCELLED)`) are captured in `rawPayload.isCanceled`, `rawPayload.status: 'cancelled'`, and `resolutionProvenance.status: 'cancelled'`, persisting with canonical `status: 'cancelled'`.
  7. *Venue CLI Extensions:*
     - Extended `scripts/ingest-venue.ts` to support `--venue=velvetelk`, `--venue=roots`, `--venue=all-boulder`, and updated `--venue=all` to execute all 6 Denver + Boulder venues with consolidated summary and non-zero exit code on failure.
  8. *Comprehensive Unit & Pipeline Test Suites:*
     - `tests/unit/boulder-venues-parser.test.ts` (11 tests)
     - `tests/unit/boulder-venues-adapter.test.ts` (8 tests)
     - `tests/unit/boulder-venues-pipeline.test.ts` (5 tests)
- **Verification State:** All Suites Green & Production Ready:
  - Branch: `feature/phase-3-boulder-independent-venues`
  - Pull Request: PR #15
  - Unit Tests: **631/631 passed across 50 test suites** (`npm test`) (+24 tests over PR #14)
  - Production Build: Next.js production build clean (`npm run build`, 0 errors, 14 routes optimized)
  - Code Quality: Prettier format clean (`npm run format:check`), ESLint clean (0 warnings, 0 errors), strict TypeScript clean (`tsc --noEmit`, 0 errors)
  - Live & Fixture CLI: Verified dry-run, live execution, and multi-venue batch runner for all Boulder and Denver independent venues.
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
