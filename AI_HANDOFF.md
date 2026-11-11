# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Local Data Cleanup & Spotify Personalization Verification (Final Review Remediation)**.
- **Active Branch:** `fix/local-data-cleanup-spotify-verification`
- **Active Implementing Agent:** Google Antigravity (Lead Agent Coordinator)
- **Current Task:** Final remediation of review findings:
  1. Convert cleanup script into a read-only diagnostic/audit utility with paginated queries.
  2. Correct integration-test teardown to track created artist/venue IDs, preserve pre-existing entities regardless of remaining event count, and handle `candidate_resolutions`.
  3. Correct Spotify status messaging so UI does not promise active Spotify-based concert ranking until verified artist matches exist in the catalog, keep automatic scoring in place for when verified IDs become available, and fix `clearSpotifyAffinityCache(userId)` to invalidate all time-range entries.
  4. Explicitly document Ticketmaster API key availability, catalog Spotify coverage status, and future artist identity enrichment.

- **Remediation Details:**
  1. *Finding 1 — Read-Only Diagnostic Audit Utility:*
     - Converted `scripts/cleanup-synthetic-data.ts` into a purely read-only audit and diagnostic utility (`runSyntheticAudit`).
     - Removed destructive `--apply`, `--no-backup`, and all `delete()` queries and file-system backup writes.
     - Added `fetchAllPaginated` helper using Supabase `.range(from, to)` to query all records safely without being capped at PostgREST's 1,000-row limit.
     - Removed misleading claims of transaction safety or deletion capabilities.
     - Preserved destination guard (`assertSafeDatabaseTarget` on `127.0.0.1` / `localhost`).
  2. *Finding 2 — Scoped Integration Test Teardown:*
     - In `tests/integration/golden-path.test.ts` and `tests/integration/ticketmaster-canonicalization.test.ts`, snapshotted `preExistingArtistIds` and `preExistingVenueIds` in `beforeAll`.
     - Tracked exact IDs of artists and venues actually created by each test run in `trackedCreated.artistIds` and `trackedCreated.venueIds`.
     - In `afterAll`, eliminated dangerous loops that deleted pre-existing artists or venues merely because they had 0 remaining events. Pre-existing entities are never deleted.
     - Added explicit deletion of `candidate_resolutions` (by `event_id` and `event_candidate_id`) prior to deleting events and candidates, eliminating orphaned resolution rows.
     - Preserved fail-loud error assertions throughout teardown.
  3. *Finding 3 — Spotify Status Messaging & Cache Invalidation:*
     - Fixed `clearSpotifyAffinityCache(userId)` in `lib/sources/spotify/affinity-service.ts` to iterate through all in-memory cache keys and invalidate all cached time-range entries (`${userId}:short_term`, `${userId}:medium_term`, `${userId}:long_term`) for the specified user, while preserving entries for other users.
     - Added dedicated unit test suite in `tests/unit/spotify-affinity-service.test.ts` verifying time-range cache invalidation and isolation.
     - Wired `clearSpotifyAffinityCache(user.id)` into `disconnectSpotifyAction` in `app/profile/taste/actions.ts`.
     - Adjusted UI copy in `PersonalizedDiscoverContainer.tsx`, `SpotifyConnectionCard.tsx`, and `SpotifyTastePreview.tsx` to honestly communicate that Spotify account is connected and ready to inform rankings once verified Spotify artist IDs match in our catalog, while reminding users that setting explicit preferences in Music Taste guarantees immediate priority.
  4. *Finding 4 — Ticketmaster API Key & Catalog Spotify Coverage Documentation:*
     - **Ticketmaster API Key:** Acknowledged that the Ticketmaster API key is now available to the user in `.env.local` for future live Ticketmaster ingestion runs.
     - **Spotify Infrastructure vs. Catalog Coverage:** The Spotify scoring infrastructure (OAuth, token refresh, in-memory affinity service, recommendation engine factor scoring with recency decay, and manual preference precedence) is completely implemented and tested. However, local catalog coverage currently contains 579 canonical artists across 244 genuine Colorado concerts with **0 verified Spotify artist IDs** (`artist_external_ids` with `provider = 'spotify'`), because Colorado venue scrapers (Velvet Elk, Roots Music Project, Cervantes, Larimer, Lost Lake, Globe Hall) extract from venue HTML/JSON-LD rather than Spotify metadata.
     - **Future Enrichment Task:** Automated Spotify artist identity enrichment (e.g. via MusicBrainz / Spotify Web API entity resolution during ingestion) remains a planned future task.

---

## Verification Suite Results

- `npm run format:check`: PASS (0 code style issues)
- `npm run lint`: PASS (0 ESLint warnings, 0 errors)
- `npm run typecheck`: PASS (`tsc --noEmit`, 0 TypeScript errors)
- `npm test`: PASS (51/51 test files, 651/651 unit tests passed)
- `npm run test:integration`: PASS (8/8 test files, 59/59 integration tests passed against local Supabase)
- `npm run test:e2e`: PASS (4/4 test files, 11/11 browser smoke & authenticated tests passed)
- `npm run audit:synthetic`: PASS (0 synthetic records; 244 genuine Colorado concerts, 579 artists, 17 venues preserved)
- `npm run build`: PASS (Next.js production build clean, 9/9 routes compiled successfully)

---

## Key Invariants Preserved

1. **Safe Database Targets:** Audit utility and tests strictly enforce `assertSafeDatabaseTarget`; zero chance of targeting remote or production databases.
2. **Invariant 3 (Immutable Observations):** `raw_ingests` and `event_candidates` remain immutable audit records.
3. **Invariant 5 (Conservative Entity Resolution):** Disambiguate artists and external IDs strictly; never fabricate Spotify external IDs via name-only guessing.
4. **Invariant 11 (Manual Preference Precedence):** Explicit user preferences (`favorite`=100, `like`=75, `interested`=55, `dislike`=0) strictly take precedence over inferred Spotify listening affinities.
5. **No Synthetic Data Pollution:** All test suites clean up 100% of their test-created artifacts using exact tracked IDs without deleting pre-existing catalog entities.
