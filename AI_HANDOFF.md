# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Local Data Cleanup & Spotify Personalization Verification (Review Remediation)**.
- **Active Branch:** `fix/local-data-cleanup-spotify-verification`
- **Active Implementing Agent:** Google Antigravity (Lead Agent Coordinator)
- **Current Task:** Remediation of 6 review findings: provenance-based synthetic identification, safe retained cleanup utility with backups, strictly scoped integration-test teardown, honest local Spotify catalog diagnosis, UI priority clarity, and PII sanitization.
- **Completed Remediation Work:**
  1. *Finding 1 — Provenance-Based Synthetic Identification:*
     - Completely removed broad heuristics and name patterns (`KNOWN_SYNTHETIC_EVENT_PATTERNS`, `KNOWN_SYNTHETIC_ARTIST_NAMES`, `KNOWN_SYNTHETIC_VENUE_NAMES`).
     - Removed the official Ticketmaster Discovery API URL as synthetic evidence.
     - Synthetic identification in `scripts/cleanup-synthetic-data.ts` is strictly provenance-based: identifies events, candidates, and raw ingests originating from mock test sources (`fake-venue-adapter`, dynamic test sources) or mock URLs (`example.com`, `example-venue.com`), ensuring zero genuine field evidence exists before flagging for removal.
  2. *Finding 2 — Safe Retained Cleanup Utility:*
     - Enforced local-only database guard (`assertSafeDatabaseTarget` on `127.0.0.1` / `localhost`); completely removed remote/production flags.
     - Added full pre-deletion JSON serialization backup (`.backup/synthetic-cleanup-backup-<timestamp>.json`) covering all 11 dependent tables with mandatory verification before any deletion begins.
     - Replaced error-swallowing with immediate throw-on-error assertions across all database queries.
  3. *Finding 3 — Scoped Integration Test Teardown:*
     - Replaced all broad global name-based deletions and silent `catch {}` blocks in `tests/integration/golden-path.test.ts`, `tests/integration/ticketmaster-canonicalization.test.ts`, and `tests/integration/catalog-rls.test.ts` with exact ID tracking (`trackedCreated`).
     - Test suites track created raw ingests, candidates, events, artists, and venues, deleting strictly the entities created during that specific test run while preserving baseline seeds (`fake-venue-adapter`).
  4. *Finding 4 — Local Spotify Catalog Diagnosis & Intersection Check:*
     - Diagnosed local database: 579 canonical artists across 244 genuine Colorado concerts; 0 canonical artists currently possess verified Spotify IDs (`artist_external_ids` with `provider = 'spotify'`) because current Colorado venue scrapers extract from venue websites and JSON-LD rather than Spotify metadata, and Ticketmaster ingestion is paused pending API key availability.
     - Connected user has active Spotify top artists, but catalog intersection is currently 0.
     - Preserved Invariant 5: no heuristic or name-only guessing was used to fabricate external IDs or fake recommendation score changes.
  5. *Finding 5 — "Add to Interests" Priority Clarity & Invariant 11:*
     - Clarified in `components/taste/SpotifyTastePreview.tsx` that selecting "✦ Interested (55)" gives a lower match score than automated Spotify rotation affinity (60–70) per Invariant 11 (explicit manual preferences strictly take precedence over inferred listening affinities).
     - Added an amber informational warning in the UI when "Interested" is selected.
     - Added a dedicated unit test in `tests/unit/recommendation-factors.test.ts` mathematically proving that saving a manual "Interested" (55) preference intentionally lowers the score from automated top-artist affinity (70).
  6. *Finding 6 — PII and Privacy Sanitization:*
     - Sanitized `AI_HANDOFF.md` and repository documentation to remove personal email addresses and user listening-history details. Confirmed zero personal occurrences remain across tracked files.
  7. *E2E Test Contention & Navigation Stability:*
     - Fixed `tests/e2e/discover.spec.ts`, `tests/e2e/spotify-taste.spec.ts`, and `tests/e2e/taste-auth.spec.ts` navigation assertions to wait on exact pathname transitions away from `/login` (`page.waitForURL((url) => url.pathname === '...')`) preventing premature regex matching of query strings.
     - Added mutation settlement wait in `taste-auth.spec.ts` before reload to prevent race conditions against PostgreSQL deletion.
     - Configured `workers: 1` and `fullyParallel: false` in `playwright.config.ts` to prevent worker contention against local Docker Supabase.

- **Verification Suite Results (100% Green):**
  - `npm run format:check`: PASS (0 code style issues)
  - `npm run lint`: PASS (0 ESLint warnings, 0 errors)
  - `npm run typecheck`: PASS (`tsc --noEmit`, 0 TypeScript errors)
  - `npm test`: PASS (50/50 test files, 649/649 unit tests passed)
  - `npm run test:integration`: PASS (8/8 test files, 59/59 integration tests passed)
  - `npm run test:e2e`: PASS (4/4 test files, 11/11 browser smoke & authenticated tests passed)
  - `npm run cleanup:synthetic -- --dry-run`: PASS (0 records flagged for removal; 244 genuine Colorado concerts preserved)
  - `npm run build`: PASS (Next.js production build clean, 9/9 routes compiled successfully)

- **Cumulative Diff Export:**
  - Exported to `./encore-local-cleanup-spotify-verification.diff` in project repository root.

- **Next Immediate Action:**
  - Submit remediation branch `fix/local-data-cleanup-spotify-verification` for final peer review.
  - Do NOT auto-merge into `main`.

---

## Key Invariants Preserved

1. **Safe Database Targets:** Cleanup script and tests enforce `assertSafeDatabaseTarget`; zero chance of accidental writes to remote or production databases.
2. **Invariant 5 (Conservative Entity Resolution):** Disambiguate artists and external IDs strictly; never fabricate Spotify external IDs via name-only guessing.
3. **Invariant 11 (Manual Preference Precedence):** Explicit user preferences (`favorite`=100, `like`=75, `interested`=55, `dislike`=0) strictly take precedence over inferred Spotify listening affinities.
4. **No Synthetic Data Pollution:** All test suites clean up 100% of their test-created artifacts using exact tracked IDs.
