# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Local Data Cleanup & Spotify Personalization Verification**.
- **Active Branch:** `fix/local-data-cleanup-spotify-verification`
- **Active Implementing Agent:** Google Antigravity (Lead Agent Coordinator)
- **Current Task:** Local database cleanup of synthetic testing artifacts, test fixture leakage prevention, Spotify listening-affinity recommendation bridge, and genuine Colorado venue verification.
- **Completed Work:**
  1. *Problem A — Synthetic Catalog Data Cleanup:*
     - Built `scripts/cleanup-synthetic-data.ts` with `--dry-run` and `--apply` flags, destination guards (`assertSafeDatabaseTarget`), backup before deletion (`.backup/`), and foreign-key-safe deletion order (`event_field_evidence` -> `event_ticket_links` -> `event_artists` -> `events` -> `event_candidates` -> `raw_ingests` -> unreferenced synthetic artists -> unreferenced synthetic venues -> synthetic sources). Added npm script `"cleanup:synthetic"`.
     - Preserved user account (`juliankotara@gmail.com`), encrypted Spotify OAuth credentials, and baseline seed venues/sources.
     - Safely removed all 18 synthetic test events, 10 raw ingests, 16 candidates, 18 event artists, 8 ticket links, 119 field evidence rows, 19 test artists, and 3 test venues.
     - Added targeted `afterAll` teardown hooks to both `tests/integration/golden-path.test.ts` and `tests/integration/ticketmaster-canonicalization.test.ts`. Verified both tests run green and leave 0 leaked events or candidates.
  2. *Problem B — Spotify Personalization Bridge:*
     - Verified Spotify connection works and returns live top artists (John Summit, Dom Dolla, Cloonee, Bella Ora, Tate McRae, Mac Miller, Post Malone, it's murph).
     - Confirmed that prior to this task, Spotify top artists were only displayed on `/profile/taste` for manual import via "+ Add to Interests" into `user_artist_preferences`; Discover never queried or scored Spotify top artists.
     - Built `lib/sources/spotify/affinity-service.ts` with `getActiveSpotifyTopArtistsForUser` (5-minute in-memory cache, fail-closed handling).
     - Updated recommendation engine and factor scoring (`lib/recommendation/factors/artist-interest.ts`): scores Spotify top artists with tiered listening affinity (top 5 -> 70, top 10 -> 65, top 20 -> 60) when no explicit manual preference exists.
     - Preserved Invariant 11: explicit manual user preferences (`user_artist_preferences`) strictly take precedence (`favorite`=100, `like`=75, `interested`=55, `dislike`=0 suppresses).
     - Updated explainer (`lib/recommendation/explainer.ts`) to label matches transparently as `🎧 Spotify top artist (#rank in your listening history)`.
     - Updated UI copy in `components/discover/PersonalizedDiscoverContainer.tsx` and `components/taste/SpotifyTastePreview.tsx` to clarify that Spotify listening history automatically influences recommendations, while "+ Add to Interests" is for explicit priority promotion.
  3. *Problem C — Real Concert Inventory Ingestion & Verification:*
     - Ingested genuine Colorado venue inventory across 6 venues:
       - Cervantes' Masterpiece Ballroom (55 events) & Cervantes' Other Side (37 events)
       - Globe Hall (41 events)
       - Larimer Lounge (36 events) + Treehouse (10) + Campground (9)
       - Lost Lake Lounge (35 events)
       - Velvet Elk Lounge (5 events)
       - Roots Music Project (6 events)
       - Other Colorado venues (Red Rocks 3, Ogden 3, Mission Ballroom 2, Black Sheep 1, Fiddlers Green 1)
       - Total: **244 genuine upcoming canonical events**, 241 real ticket links, 590 artist billings, 579 artists, 17 venues, 3,380 verified field evidences. Zero synthetic test fixtures remain.
     - Updated `tests/e2e/discover.spec.ts` date offsets to ensure E2E assertions test real catalog pagination behavior cleanly without collisions.
- **Verification Suite Results (100% Green):**
  - `npm run format:check`: PASS (All files adhere to Prettier style)
  - `npm run lint`: PASS (0 warnings, 0 errors)
  - `npm run typecheck`: PASS (`tsc --noEmit`, 0 errors)
  - `npm test`: PASS (50 test suites, 648 passed)
  - `npm run test:integration`: PASS (8 test suites, 59 passed against local Supabase)
  - `npm run build`: PASS (Next.js production build clean, 9/9 routes compiled)
  - `npm run test:e2e`: PASS (11 Playwright browser tests passed)
  - `npm run cleanup:synthetic -- --dry-run`: PASS (0 leaked events, 246 genuine events preserved)
- **Cumulative Diff Export:**
  - Exported to `./encore-local-cleanup-spotify-verification.diff` (1,611 lines, in project repository root).
- **Next Immediate Action:**
  - Review changes and merge `fix/local-data-cleanup-spotify-verification` or proceed to next roadmap phase.

---

## Key Invariants Preserved

1. **Safe Database Targets:** Cleanup script and tests enforce `assertSafeDatabaseTarget`; zero chance of accidental writes to remote or production databases.
2. **Invariant 11 (Manual Preference Precedence):** Explicit user preferences (`favorite`, `like`, `interested`, `dislike`) strictly take precedence over inferred Spotify listening affinities. A disliked headliner always suppresses the show.
3. **Fail-Closed Spotify Affinity:** Spotify network or token issues return an empty array and never crash the Discover feed.
4. **No Synthetic Data Pollution:** Integration tests cleanly tear down all test entities in `afterAll` hooks.
