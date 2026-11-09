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
- **Implementation & Review Remediation Completed:**
  1. *Source Feasibility & Architecture Audit:* Audited all 3 venues (Larimer Lounge, Lost Lake Lounge, Globe Hall); discovered all three run on WordPress with Rockhouse Partners (RHP Events) and Etix ticketing. Designed unified extraction implementation `IndependentVenueAdapter` and `parseIndependentVenueEvents` leveraging shared CSS class contracts (`.rhpSingleEvent`, `.rhp-events-list-separator-month`, `.rhp-event__title`, `.eventDateList`, `.rhp-event__time-text`) across both list and grid view variations.
  2. *Configuration-Driven Venue Registry:* Added `LARIMER_LOUNGE_CONFIG`, `LOST_LAKE_CONFIG`, `GLOBE_HALL_CONFIG`, and `DENVER_INDEPENDENT_VENUE_CONFIGS` in `lib/sources/venue/source-registry.ts`.
  3. *Stage & Venue Attribution:* Handled Larimer Lounge's physical rooms and outdoor spaces ("Treehouse", "Campground", "Skihouse") sharing the physical address (2721 Larimer St), resolving stages cleanly without inventing synthetic locations.
  4. *Non-Music Listing Filtering:* Safely filtered recurring trivia, Gryffin merchandise pop-ups, and Red Rocks shuttle passes without fabricating performing artists, ensuring unidentifiable events route to `needs_review` with reason `missing_artist_identity`.
  5. *Early/Late Show & Multi-Night Disambiguation:* Enhanced `lib/entity-resolution/event-matcher.ts` and `lib/entity-resolution/canonicalization-coordinator.ts` to cleanly disambiguate separate early and late shows on the same date (e.g. Jonah Kagen 4:00 PM vs 8:00 PM at Globe Hall, 240-minute separation) into distinct canonical events while maintaining accurate same-venue contextual artist matching.
  6. *Verified Free Admission Preservation:* In `lib/sources/venue/independent-venue-group/parser.ts`, detected explicit free show indicators (`(FREE SHOW)`, `(FREE EVENT)`, and `Free Event` CTA). When verified with no contradictory paid pricing, sets `eventKind: 'free_event'` and `price: { isFree: true, min: 0, max: 0, currency: 'USD' }`. Unknown-price events strictly preserve `price: undefined` (`eventKind: 'concert'`). Nonmusic listings remain excluded (`artists: []` routes to `needs_review`).
  7. *Demonstrated Title Pattern Parsing:* Corrected artist parsing for demonstrated real-world fixture patterns without generalized text parsing:
     - `By The Fire Feat. ...`: correctly identifies `By The Fire` as show series and `Strawberry Milk` as performing headliner.
     - `Bassline Events Presents: Bass Nights w/ ...`: correctly identifies promoter and show title, assigning `Exxotik` as performing headliner.
     - `SosMula – TILL THE LAST STAR DIES TOUR 2026`: properly strips tour name including year, extracting `SosMula` as headliner.
  8. *Multi-Venue CLI Failure Handling:* In `scripts/ingest-venue.ts`, running `--venue=all-denver` or `--venue=all` tracks failed sources, continues remaining venues, prints consolidated failure details, and sets a non-zero exit status if any source fails.
  9. *Strict Ticket URL Validation:* Removed fallback preserving unvalidated URLs. Validates HTTP(S) links via `isValidHttpUrl`, strictly rejects case variants of `javascript:` schemes, and sets malformed/unsafe URLs to `undefined`.
- **Verification State:** All Suites Green & Production Ready:
  - Branch: `feature/phase-3-denver-independent-venues`
  - Pull Request: [PR #14](https://github.com/juko04/Encore-concert-finder/pull/14)
  - Unit Tests: **607/607 passed across 47 test suites** (`npm test`) (+34 tests over PR #13)
  - Production Build: Next.js production build clean (0 errors, 14 routes optimized)
  - Code Quality: Prettier format clean (`npm run format:check`), ESLint clean (0 warnings, 0 errors), strict TypeScript clean (0 errors)
  - Smoke Test: Verified atomic canonicalization, verified free-event classification, artist disambiguation, and repeat-ingestion idempotency via memory integration suite; host Docker/local Supabase environment is currently not running.
  - Cumulative Diff: Exported to `encore-phase3-denver-venues-pr14-final.diff` (project root) and `~/Desktop/encore-phase3-denver-venues-pr14-final.diff`.
- **Immediate Next Action:** Awaiting independent code review. Do NOT auto-merge PR #14 autonomously. Upon merge to `main`, proceed to **Phase 3 PR #15: Smaller Boulder Venues (Velvet Elk Lounge & Roots Music Project)** as the agreed priority. Z2 Entertainment remains a later candidate.
- **Phase 3 Status:** **ACTIVE — PR #14 REMEDIATION COMPLETE & 100% VERIFIED.**

---

## What the Next Agent Must Know

1. **Diff Export Location Convention:**
   - Save cumulative diffs directly in the Encore repository root (e.g. `encore-phase<X>-<slug>-pr<N>.diff`), and optionally duplicate to `~/Desktop` if requested. `.gitignore` ignores `*.diff` to keep git status clean.
2. **Next Milestone Priority (PR #15):**
   - The agreed priority for PR #15 is **Smaller Boulder Venues** (Velvet Elk Lounge via BentoBox, Roots Music Project via Squarespace). Z2 Entertainment (Boulder Theater, Fox Theatre, Aggie Theatre) is a later candidate.
3. **Independent Venue Group Ingestion Architecture:**
   - Single shared adapter (`IndependentVenueAdapter`) and parser (`parseIndependentVenueEvents`) in `lib/sources/venue/independent-venue-group/` powers Larimer Lounge, Lost Lake Lounge, and Globe Hall.
   - Configured via `IndependentVenueConfig` records in `lib/sources/venue/source-registry.ts`.
4. **Missing Price vs. Verified Free Invariant:**
   - Only events with explicit verified free admission (`(FREE SHOW)`, `(FREE EVENT)`, `Free Event` CTA) receive `eventKind: 'free_event'` and `price: { isFree: true, min: 0, max: 0, currency: 'USD' }`.
   - Unknown-price listings MUST remain `price: undefined` (`eventKind: 'concert'`). Never assume $0 or free admission without proof.
5. **Larimer Lounge Stage Modeling:**
   - Larimer Lounge includes stages: Treehouse, Campground, and Skihouse. All share physical address `2721 Larimer St, Denver, CO 80205`. The parser outputs stage names in `venue.name` while retaining true physical address.
6. **Early/Late Performance Disambiguation:**
   - Performances on the same date with start-time differences >= 90 minutes are treated as distinct canonical performances. Same-venue contextual matching allows the same artist to link to both events without triggering ambiguous artist rejection.
7. **No Synthetic Fallback in Production:**
   - Production venue ingestion must only write verified observations. Static fixtures are restricted strictly to testing and CLI `--fixture` replays.
