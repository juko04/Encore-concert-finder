# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 3 — Colorado Venue Ingestion**.
- **Active Specification:** PR #13 Scope & Requirements (`docs/architecture/venue-sources-registry.md`).
- **Current Branch:** `feature/phase-3-venue-ingestion`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 3, PR #13: Reusable Web Scraping Framework + First Venue Integration (Cervantes' Masterpiece Ballroom).
- **Implementation Completed:**
  1. *Colorado Venue Feasibility Audit:* Conducted comprehensive technical audit of 15 high-priority Colorado music venues across 268 research candidates; identified platform clustering (RHP/Etix, Ticketmaster, Eventbrite, custom WordPress); documented full architecture roadmap and audit matrix in `docs/architecture/venue-sources-registry.md`.
  2. *Reusable Venue Scraping Framework:* Built modular venue scraping engine in `lib/sources/venue/` utilizing lightweight HTTP fetcher with polite rate-limiting, exponential backoff, Cheerio HTML parsing, Schema.org JSON-LD extraction, and IANA timezone-aware wall-clock date normalization.
  3. *Cervantes' Masterpiece Ballroom Adapter:* Implemented complete adapter in `lib/sources/venue/cervantes/` parsing 103 upcoming concerts from the Cervantes calendar; extracts headliner and support billing, doors/show times, offsite partner venue attribution (Mission Ballroom, Ogden Theatre, Fiddlers Green), and direct Etix ticket links without inventing missing data.
  4. *Pipeline Ingestion & Cross-Source Deduplication:* Wired venue adapter into `runVenueIngestion` pipeline (`lib/sources/venue/ingestion-pipeline.ts`); enforces immutable raw ingests (`raw_ingests`), deduplicated candidate observations (`event_candidates`), and atomic entity canonicalization via `CanonicalizationCoordinator`; matches pre-existing Ticketmaster events by venue, local date, and artist to merge multiple ticket sources onto a single canonical concert without creating duplicate events.
  5. *Safe CLI Runner:* Implemented `scripts/ingest-venue.ts` (`npm run ingest:venue`) with safe dry-run preview default, local static fixture replay (`--fixture`), live HTTP scraping (`--live`), and destination-guarded database persistence (`--persist`).
- **Verification State:** All Suites Green & Production Ready:
  - Branch: `feature/phase-3-venue-ingestion`
  - Pull Request: PR #13 (to be submitted)
  - Unit Tests: 569/569 passed across 44 test suites (`npm test`), including 41 dedicated venue tests across 6 new test suites
  - Production Build: Next.js production build clean (0 errors, 14 routes optimized)
  - Code Quality: Prettier format clean (`npm run format:check`), ESLint clean (0 warnings, 0 errors), strict TypeScript clean (0 errors)
- **Immediate Next Action:** Commit changes, push to `origin/feature/phase-3-venue-ingestion`, open PR #13 on GitHub, verify CI checks, export cumulative diff to `~/Desktop/encore-phase3-venue-ingestion.diff`, and submit for independent review. Do NOT auto-merge PR #13 autonomously.
- **Phase 3 Status:** **ACTIVE — PR #13 IMPLEMENTATION & VERIFICATION COMPLETE.**

---

## What the Next Agent Must Know

1. **Venue Ingestion Architecture:**
   - Adapters implement `EventSourceAdapter` contract (`fetch`, `parse`, `crawl`) located under `lib/sources/venue/`.
   - All venue scrapers MUST output `EventCandidate` objects with valid provenance, local dates, and IANA timezone (`America/Denver`).
2. **Missing Price Invariant:**
   - When a venue listing does not publish explicit dollar pricing, ticket price fields MUST remain `undefined` (rendered as Price TBA in the UI). Never fabricate $0 or free admission.
3. **Offsite Venue Co-Promotion:**
   - Cervantes and other independent promoters frequently host or co-promote shows at partner venues (e.g. Mission Ballroom, Ogden, Red Rocks). The parser inspects `.rhpVenueContent a` to assign the true physical host venue, preventing venue conflation.
4. **Cross-Source Deduplication:**
   - Ingesting a concert from an official venue website that was previously ingested from Ticketmaster merges onto the existing canonical event if venue, local date, and headliner match, adding the venue's direct ticketing link without creating duplicate events.
5. **No Synthetic Fallback in Production:**
   - Production venue ingestion must only write verified observations. Synthetic fixtures are restricted strictly to testing and CLI `--fixture` replays.

1. **Preset Identifier Invariant:**
   - The UI display label for the artist preset is "Artists", but the persisted database identifier must strictly be `artist_first`.
2. **Discovery Modes vs Priority Presets:**
   - Priority presets (`artist_first`, `value`, `nearby`, `balanced`) are persisted user preferences defining baseline factor weights.
   - Discovery modes (`all`, `this_weekend`, `cheap_and_nearby`, `worth_planning_for`) are situational exploration lenses that filter candidates and apply temporary factor weighting overrides (`weightsOverride`).
3. **Multi-Tier Candidate Pool & Anti-Starvation:**
   - Upcoming shows for preferred artists are retrieved in prioritized tiers: Favorite (up to 100), Like (up to 75), Interested (up to 50), avoiding starvation of favorite acts by lower-tier preferences.
4. **Threshold Isolation Invariant:**
   - `updateTypicalBudgetAction` only modifies `maxNormalTicketPrice` in `public.profiles`. `maxFavoriteArtistPrice` and `maxSpontaneousPrice` must remain unchanged.
5. **Dynamic Request-Scoped Discover:**
   - `/discover` must remain `export const dynamic = 'force-dynamic'` to ensure private user recommendations are never stored in shared CDN or Next.js ISR caches.
6. **No Synthetic Fallback in Production:**
   - Production Discover must never fall back to synthetic fixtures on error or empty catalog.
7. **Future Scope Boundaries (Post-PR #12):**
   - Save/Dismiss Event Actions, Recommendation Feedback Loops, Multi-Day Festival Planning, and Price Alerts remain deferred to subsequent milestones.
8. **E2E / Website Test Optimization Rule:**
   - Browser/website tests (`npm run test:e2e` and full interactive browser QA) do not need to run every time, especially when changes are purely backend, repository, domain scoring, data model, or documentation, with no UI or interaction modifications.
