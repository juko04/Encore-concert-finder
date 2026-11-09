# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Phase 3 — Colorado Venue Ingestion**.
- **Active Specification:** Phase 3, PR #14 Scope & Requirements (`docs/architecture/venue-sources-registry.md`).
- **Current Branch:** `feature/phase-3-denver-independent-venues`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Phase 3, PR #14: Multi-Venue Integration: Larimer Lounge, Lost Lake Lounge & Globe Hall.
- **Implementation Completed:**
  1. *Source Feasibility & Architecture Audit:* Audited all 3 venues (Larimer Lounge, Lost Lake Lounge, Globe Hall); discovered all three run on WordPress with Rockhouse Partners (RHP Events) and Etix ticketing. Designed unified extraction implementation `IndependentVenueAdapter` and `parseIndependentVenueEvents` leveraging shared CSS class contracts (`.rhpSingleEvent`, `.rhp-events-list-separator-month`, `.rhp-event__title`, `.eventDateList`, `.rhp-event__time-text`) across both list and grid view variations.
  2. *Configuration-Driven Venue Registry:* Added `LARIMER_LOUNGE_CONFIG`, `LOST_LAKE_CONFIG`, `GLOBE_HALL_CONFIG`, and `DENVER_INDEPENDENT_VENUE_CONFIGS` in `lib/sources/venue/source-registry.ts`.
  3. *Stage & Venue Attribution:* Handled Larimer Lounge's physical rooms and outdoor spaces ("Treehouse", "Campground", "Skihouse") sharing the physical address (2721 Larimer St), resolving stages cleanly without inventing synthetic locations.
  4. *Non-Music Listing Filtering:* Safely filtered recurring trivia, Gryffin merchandise pop-ups, and Red Rocks shuttle passes without fabricating performing artists, ensuring unidentifiable events route to `needs_review` with reason `missing_artist_identity`.
  5. *Early/Late Show & Multi-Night Disambiguation:* Enhanced `lib/entity-resolution/event-matcher.ts` and `lib/entity-resolution/canonicalization-coordinator.ts` to cleanly disambiguate separate early and late shows on the same date (e.g. Jonah Kagen 4:00 PM vs 8:00 PM at Globe Hall, 240-minute separation) into distinct canonical events while maintaining accurate same-venue contextual artist matching.
  6. *Price Neutrality Preserved:* Ensured unknown prices remain strictly `undefined` (rendered as Price TBA). Never assumed $0 or free admission without explicit proof.
  7. *CLI Runner Extension:* Enhanced `scripts/ingest-venue.ts` (`npm run ingest:venue`) to support `--venue=larimer`, `--venue=lostlake`, `--venue=globehall`, and consolidated batch execution `--venue=all-denver` with structured summaries across all venues.
  8. *Verification & Production Readiness:*
     - Added 27 new automated unit tests across 3 dedicated test suites (`tests/unit/independent-venue-parser.test.ts`, `tests/unit/independent-venue-adapter.test.ts`, `tests/unit/denver-venues-pipeline.test.ts`).
     - Real-world fixture captures verified (Larimer: 70 events, Lost Lake: 35 events, Globe Hall: 44 events).
     - Controlled live HTTP validation executed and verified (Larimer: 70 events in 0.87s, Lost Lake: 35 events in 1.36s, Globe Hall: 44 events in 0.69s).
- **Verification State:** All Suites Green & Production Ready:
  - Branch: `feature/phase-3-denver-independent-venues`
  - Pull Request: Ready to open against `main`
  - Unit Tests: 600/600 passed across 47 test suites (`npm test`) (up from 573 in PR #13, +27 new tests)
  - Production Build: Next.js production build clean (0 errors, 14 routes optimized)
  - Code Quality: Prettier format clean (`npm run format:check`), ESLint clean (0 warnings, 0 errors), strict TypeScript clean (0 errors)
  - Cumulative Diff: Exported to `encore-phase3-denver-venues-pr14.diff` (project root)
- **Immediate Next Action:** Awaiting independent code review. Do NOT auto-merge PR #14 autonomously. Upon merge to `main`, proceed to Phase 3 PR #15 (Z2 Entertainment Cluster: Boulder Theater, Fox Theatre, Aggie Theatre).
- **Phase 3 Status:** **ACTIVE — PR #14 IMPLEMENTATION & LOCAL VERIFICATION COMPLETE.**

---

## What the Next Agent Must Know

1. **Diff Export Location Convention:**
   - Save cumulative diffs directly in the Encore repository root (e.g. `encore-phase<X>-<slug>-pr<N>.diff`), NOT on `~/Desktop`. `.gitignore` already ignores `*.diff` to keep git status clean.
2. **Independent Venue Group Ingestion Architecture:**
   - Single shared adapter (`IndependentVenueAdapter`) and parser (`parseIndependentVenueEvents`) in `lib/sources/venue/independent-venue-group/` powers Larimer Lounge, Lost Lake Lounge, and Globe Hall.
   - Configured via `IndependentVenueConfig` records in `lib/sources/venue/source-registry.ts`.
   - Any future venue utilizing Rockhouse Partners (RHP Events) on WordPress can be added with a simple configuration entry.
3. **Missing Price Invariant:**
   - When an Etix/venue listing does not publish explicit dollar pricing, ticket price fields MUST remain `undefined` (rendered as Price TBA in the UI). Never fabricate $0 or free admission.
4. **Larimer Lounge Stage Modeling:**
   - Larimer Lounge includes stages: Treehouse, Campground, and Skihouse. All share physical address `2721 Larimer St, Denver, CO 80205`. The parser outputs stage names in `venue.name` while retaining true physical address.
5. **Early/Late Performance Disambiguation:**
   - Performances on the same date with start-time differences >= 90 minutes are treated as distinct canonical performances. Same-venue contextual matching allows the same artist to link to both events without triggering ambiguous artist rejection.
6. **No Synthetic Fallback in Production:**
   - Production venue ingestion must only write verified observations. Static fixtures are restricted strictly to testing and CLI `--fixture` replays.
