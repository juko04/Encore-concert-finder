# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Encore V2 UI Migration & Production Foundation (Homepage Discovery, Calendar View, Opener Search, Card Hardening)**.
- **Active Branch:** `fix/ui-discover-auth-v2` (PR #21 against `main`). Coordinator commits; nothing merged.
- **Current Status:** Final integrated branch committed and pushed 2026-11-25; PR text in `PR_DESCRIPTION.md`. Not merged.

### Latest (2026-11-25, branch `fix/ui-discover-auth-v2`, PR #21)

- **Verified on the final tree (local Supabase with the real dev DB, no reset; backups in `Claude outputs/`, untracked):** `format:check` PASS, `lint` PASS, `typecheck` PASS, `npm test` 116 files / 1413 tests PASS, `build` PASS, `test:integration` 21 files / 155 tests ALL PASS with identical row counts before/after. Playwright not re-run locally on the final tree (CI).
- **This round:** fast radius scan (light id/city/coords scan + page hydration, no cap), no 12-month search cap, no hardcoded timezone (`encore_tz` cookie, home-city zone, UTC), several external ids per artist (migration 20261126010000), shared-id attractions collapse into one artist with evidence, artist-less genre shows, House Party Religious genre dropped (Ticketmaster data error on a generic attraction), idempotent null-id `event_sources` upsert (20261126030000, fixes Velvet Elk re-sync), Spotify "Listen" embed (`lib/spotify/embed.ts`, `components/index/SpotifyArtistEmbed.tsx`).
- **Local sync result:** all sync jobs pass; upcoming shows 1,037 -> 1,472, priced 75 -> 265, 215 artist-less genre shows, 29 "Day Out With Thomas" shows (one artist, both TM ids).
- **Not run / limitations:** real Spotify OAuth connect/disconnect; browser QA of the invited-user flow and ticket images; no fresh-DB replay locally (CI). First-ever visit without the timezone cookie renders UTC dates once. No DB-level integration test for multi-Spotify-id preference saving. 5 stray non-US shows remain in the local dev DB.
- **Backlog:** `docs/project/non-blocking-debt.md` section 4 (all items addressed; genre coverage grows with each sync).
- **Next action:** independent review of PR #21; do NOT merge autonomously.

### Earlier (2026-11-24, branch `fix/ui-discover-auth-v2`)

- **Live Ticketmaster ingestion unblocked.** Prior local DB held only TM fixture rows. Fixed `lib/entity-resolution/field-merge.ts` so merges keep `is_multi_day` consistent with merged dates, reject end dates before start, and never downgrade an event with a known `starts_at` to `date_only` (these violated `check_events_multi_day_consistency` / `check_events_date_only_no_starts_at` and aborted whole sync jobs). Fixed `lib/sources/ticketmaster/adapter.ts` dropping `countryCode` (nationwide "US" festival query was returning worldwide events). Tests added; `typecheck`, `lint`, `format:check`, `npm test` (1207/1207) pass. Integration/e2e/build not re-run.
- Local DB now has 758 TM events (651 with images). Live sync of all three horizons persisted locally.
- **Open issue:** one TM listing whose two attractions share a Spotify ID ("Day Out With Thomas") trips the external-ID guard in `apply_canonicalization`, and the pipeline aborts the entire batch (long-term nationwide festivals not persisted). Needs a per-candidate `needs_review` route instead of a batch abort — identity-resolution change, needs review.
- Fixture-run sync checkpoints marked CO as fresh; use `--force` after fixture persists.

#### Preferences page, Spotify ranks, prices (2026-11-24, same branch, uncommitted)

- **`/preferences` is now a settings page** (radius, three ticket-price ceilings, ranking preset, optional artist-importance slider 20–80). The artist/Spotify manager stays at `/profile/taste`; the "Engineering Invariant 11" box was removed. New: migration `20261124020000_add_artist_weight_to_profiles.sql` (applied locally only), `lib/preferences/validate.ts`, `app/preferences/actions.ts`, `components/preferences/PreferencesForm.tsx`, `applyArtistWeight` in `lib/recommendation/presets.ts` (used by the service only when the preset comes from the profile; explicit `presetOverride` and non-`all` discovery modes keep pure weights).
- **Where preferences take effect:** "Picked for you" scoring (radius, three budgets, preset, artist weight); Search chips "Within N mi of <home>" (`?near=1`, city-centroid distances, unknown locations excluded) and "Listed price up to $X" (strict; unpriced shows excluded); home "Near <city>" row is radius-based for signed-in users. Search radius filter scans at most 500 shows (no geo query in the catalog).
- **Spotify history** now shows rank "#N of 50" plus 4 wk / 6 mo / 1 yr ranks and the Encore affinity (0–100) per artist (`getSpotifyTopArtistsAction` fetches all three windows; the other two are best-effort).
- **Price coverage finding (not fixed):** only ~75 of ~1,040 upcoming shows have a price. Ticketmaster Discovery returns `priceRanges` for ~12% of Colorado events (mostly non-Ticketmaster-ticketed listings); big Ticketmaster-ticketed shows have none. Of the ~98 priced Colorado listings, ~68 are club-night/promoter listings with no artist attached, which entity resolution routes to `needs_review: missing_artist_identity`, so they never appear. Also: `needs_review` resolutions are not being persisted (`candidate_resolutions` has only created/matched rows), so these are silently re-evaluated each sync. Both need an identity-policy decision.
- Verified in browser on local DB (saved radius 50, $40/$120/$25, artist weight 70; Search 1,042 → 385 within 50 mi → 69 listed ≤ $40 → 60 both). Integration, e2e and `npm run build` not re-run.

---

## Resolved Issue Register (Findings & Hardening)

1. **Finding 1 (Critical — Live Quota Lock Stealing Prevention & Recovery Race Resolution):**
   - Eliminated all time-based lock stealing. Locks store `{ pid, lockId, createdAt }`. A lock is **never** stolen while `process.kill(pid, 0)` indicates the process is alive.
   - Process death detection strictly requires `killErr.code === 'ESRCH'`.
   - Releasing processes verify `meta.lockId === currentLockId` before unlinking, preventing delayed workers from clobbering replacement locks.
   - **Multi-Worker Dead-Lock Reclamation Race Fixed:** Implemented kernel-guaranteed atomic reclamation token files (`${lockPath}.${deadLockId}.reclaim` opened with `O_CREAT | O_EXCL` / `'wx'`) and strict re-verification of `currentMeta.lockId === deadLockId` immediately before unlinking. This prevents Worker B from unlinking Worker A's fresh replacement lock based on an earlier stale dead-lock observation.
   - Persisted state validation marks corrupted files as `isCorrupted = true`, failing closed without resetting daily counters.
2. **Finding 2 (High — Enforce Actual Per-Run Request Budget):**
   - Created `RunRequestBudget` (`lib/sources/ticketmaster/run-budget.ts`) with atomic `reserveRequest()`.
   - Added typed `TicketmasterRunBudgetExceededError`.
   - Wired `runBudget` into `TicketmasterApiClient.fetchEvents()` to decrement before every request attempt, including HTTP 429/5xx retries.
   - Connected `runBudget` to `TicketmasterPartitionCoordinator` and `scripts/sync-all-sources.ts`, sharing a single budget across regional syncs, bisections, favorite-artist tours, and nationwide festivals.
3. **Finding 3 (High — Multi-Source Ingestion Exit Codes & Structured Logging):**
   - Standardized deterministic exit codes: `0` (full success), `2` (partial/budget limits without errors), `1` (fatal errors / invalid arguments).
   - Added `silent?: boolean` to `SyncOptions` to suppress all progress text when `--json` is enabled, emitting only pure, machine-readable JSON to stdout for clean `jq` piping.
   - Fixed direct CLI invocation guard (`isDirectExecution`) to execute properly under `vite-node` / `npm run sync:all` while ignoring Vitest test runs.
4. **Finding 4 (High — Dangerous Test Cleanup Protection):**
   - Enforced a strict double gate in `scripts/verify-live-ingestion.ts`: requires both `ENCORE_DISPOSABLE_TEST_DB === 'true'` AND `--confirm-disposable-cleanup`, failing closed otherwise.
   - Restricted cleanup to local development databases.
   - Scoped artist cleanup strictly to test source IDs (`'ticketmaster-discovery'`, `'z2-entertainment'`) with 0 remaining event references and 0 user preferences, preventing deletion of shared catalog artists.
5. **Finding 5 (High — True Event-to-UI End-to-End Tracing):**
   - Sampled 3 events strictly from `tmPass1.createdEventIds` (created in current run) and persisted to `docs/traced-live-events.json` with `createdInCurrentRun: true`.
   - Implemented Playwright test `tests/e2e/live-event-ui-trace.spec.ts` verifying all 3 events in the real Index UI (search filtering, event detail page, venue name, and direct official Ticketmaster ticket purchase links) and captured screenshot artifacts (`docs/screenshots/traced-event-{1,2,3}.png`).
6. **Finding 6 (Production Execution Model & GitHub Actions Queue Replacement Resilience):**
   - Documented single-runner serialized concurrency group (`ticketmaster-ingestion`) with `cancel-in-progress: false` in `.github/workflows/scheduled-sync.yml.example` and `docs/architecture/ingestion.md`.
   - Addressed GitHub Actions concurrency queue depth 1 cancellation semantics: intermediate queued runs are canceled if a newer run triggers. Resolved via durable horizon SLA checkpoints persisted to `raw_ingests` (`source_url: 'encore://sync-checkpoint/ticketmaster/<horizon>'`), explicit SLAs (`near-term` 24h, `mid-term` 96h, `long-term` 192h), `--horizon=auto` support, and automatic overdue horizon cascade recovery within the bounded `RunRequestBudget`.
   - Documented ephemeral runner quota calibration via provider response headers (`rate-limit`, `rate-limit-available`, `rate-limit-reset`) and bounded request ceilings.
7. **Finding 7 (Checkpoint False-Success & Multi-State Coverage Remediation):**
   - Resolved checkpoint false-success bug in `scripts/sync-all-sources.ts`. Horizon checkpoints now strictly record `status: 'success'` and `hasIncompleteCoverage: false` **only** when all target states succeeded completely without budget exhaustion, skips, or partition failures.
   - Added state-level checkpoints (`recordStateCheckpoint`, `getStateSyncHistory`). In recovery mode (`recoverMissed: true`), fresh states are skipped (`skippedFresh: true`) while overdue states are prioritized.
   - Full horizon syncs fan out state checkpoints to all three horizons (`near-term`, `mid-term`, `long-term`).
   - Fixed `statesCompleted` validation in `getHorizonSyncHistory` to reject checkpoints missing requested states even if `statesCompleted` is empty or omitted.
   - Added deduplication for `states` CLI arguments.
8. **Finding 8 (Checkpoint History Truncation by Event Ingestion Volume):**
   - Extended `IRawIngestRepository.listBySource(sourceId, limit, urlPrefix)` in both `SupabaseRawIngestRepository` and `MemoryRawIngestRepository`.
   - Checkpoint history queries filter by prefix `encore://sync-checkpoint/ticketmaster/` with limit 500, ordered descending by `fetched_at`. Large Ticketmaster event ingestion runs (150+ pages) will never push checkpoints outside the query window.
9. **Finding 9 (Calendar Date Hardcoding & Dynamic Boundary Compliance):**
   - Eliminated hardcoded calendar dates (e.g. `2026-11-20`) in `tests/integration/personalized-discover.test.ts`, dynamically computing future event dates (`now + 7d`) to guarantee test eligibility regardless of execution date.
10. **Finding 10 (Roadmap & Access Architecture Alignment):**
    - Updated `docs/project/roadmap.md` and `docs/product/context.md` with finalized core product requirements: Public Browsing, Invite-Only Personalization, Optional Spotify (100% recommendation engine parity), and Persistent Imported Spotify Artists after disconnection. Strictly distinguished existing PR #20 deliverables from future phases.
11. **Finding 11 (Conservative Synchronization Freshness & Timestamp Preservation):**
    - State-level checkpoints in `raw_ingests` serve as the immutable source of truth for synchronization history.
    - Preserved exact last-success timestamps on skipped refreshes: a skipped state refresh never refreshes its checkpoint or advances its timestamp.
    - In multi-state runs (including mixed refreshed and skipped states), derived horizon freshness is bounded conservatively by `Math.min(...timestamps)` of all required states. Existing concert data can never appear newer than its true observation time.
12. **Finding 12 (Independent Adversarial Reviewers):**
    - Concurrency Auditor (`f318a858-a338-41aa-86e7-cfb599943445`): Audited quota locking and run budget enforcement (100% PASS).
    - Safety Auditor (`2449dc23-bac8-416d-a4ff-99be8f6fb9fe`): Audited exit codes, structured output, cleanup safety, and UI tracing (100% PASS).
    - Lock Recovery Auditor (`bd63023f-dc10-4ed2-a263-3ac0812eb27c`): Audited dead-lock reclamation race conditions and atomic tokens (100% PASS).
    - Invariant Auditor (`dd9db6f0-73a0-4033-ac64-1b2b92161346`): Audited Invariants 3, 6, 10, 11, dynamic dates, and roadmap alignment (100% PASS, GO).
    - Ingestion Auditor (`21c07530-b9a2-4a31-9d38-522714ead935`): Audited false-success prevention, prefix filtering, and memory/Supabase parity (100% PASS, GO).

---

## Verification Suite Results (All Passed)

- `npm run format:check`: **PASS** (100% Prettier compliant)
- `npm run lint`: **PASS** (0 ESLint errors, 0 warnings)
- `npm run typecheck`: **PASS** (Strict TypeScript `tsc --noEmit`, 0 errors)
- `npm test`: **PASS** (**68/68 test files, 935/935 unit tests passed**)
- `npm run test:integration`: **PASS** (**14/14 test files, 108/108 database integration tests passed**)
- `npm run build`: **PASS** (Next.js 15.5.27 production build clean, 19/19 routes compiled)
- `npx playwright test`: **PASS** (**17/17 Playwright browser tests passed, including current-run UI trace**)
- `scripts/verify-live-ingestion.ts --clean --full-audit`: **PASS** (36 TM created, 2 Z2 created; Pass 2: 0 duplicates; 282 relations audited with 0 orphans)
- **GitHub Actions Remote CI:** **PASS** (Run `45100344391` on commit `ef153be` completed 100% green in 4m51s)

---

## Next Immediate Action

Submit final verification report and evidence manifest for user signoff. Do NOT autonomously merge into `main`.

#### Package listings, Spotify matching, genre taste (2026-11-24, same branch, uncommitted)

- **Ticket-package listings:** Ticketmaster "Club Level Seating: X" events/attractions are no longer artists or show titles (`lib/sources/ticketmaster/listing-filters.ts`; parser strips them; `overlayTicketmasterImages` drops stale ones on replay). Field merge upgrades a bare title to "Artist: Tour Name" (colon/dash only, never "w/ opener") and fills genres if empty. Migration `20261124030000_cleanup_ticket_package_listings.sql` cleans existing rows (applied locally only).
- **Ely Oaks "unfamiliar" root cause:** the concert detail page scored events without Spotify data. It now uses `scoreEventForUser` (`lib/recommendation/service.ts`), the same inputs as Discover/home (saved weights, Spotify, home city). The decision-guide artist reason threshold dropped 70 to 60 so Spotify top-10 artists are mentioned.
- **Genres:** Spotify no longer returns artist genres to this app (confirmed: top-artist objects have no `genres`/`popularity`), so the existing genre taste system was empty. Genres now come from Ticketmaster classifications (events + attractions, stored fill-if-empty with provenance `ticketmaster`) and, for Spotify top artists, from the catalog or an exact-name Ticketmaster attractions lookup (`lib/sources/spotify/genre-enrichment.ts`, `lib/sources/ticketmaster/attraction-genres.ts`; bounded, cached, time-boxed). Taste is derived per user in `buildGenreTasteProfile`/`summarizeGenreTaste`; nothing is hard-coded per genre.
- **Surfacing:** genre-driven fits explain the assumption ("Assumed taste for electronic / EDM, based on your listening to ..."); candidate retrieval has a genre-taste tier; home page shows "More <genre>" row only when the user's own data implies it.
- **Open:** 5 stray non-US events from the pre-fix worldwide festival run remain in the local DB (delete was not permitted in this session). Genres for events/artists only fill on sync; a prod sync is needed. Spotify artist matching to catalog still depends on verified ids (artists without a Spotify id in the catalog are matched by the Spotify matcher during sync, not by name alone).
