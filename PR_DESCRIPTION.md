## What changed

Branch `fix/ui-discover-auth-v2` (15 commits vs `origin/main` plus uncommitted final-session work):

- Discover home, calendar (opens on current month, `?month=YYYY-MM`), preferences page, Spotify ranks and trend-aware affinity, genre taste inference, Ticketmaster listing/image/genre fixes.
- Search: `near=1` radius filter scans the whole catalog with exact counts; Load More keeps `near=1` and exact price limits (`lib/location/near-search.ts`, `near-context.ts`, `catalog-search.ts`, `SearchClient`, `/api/catalog/search`). Shared genre module, genre-aware search, "Mixed" label, badge colors, match score on cards.
- Spotify: imported artist affinities persist after disconnect/expiry; disconnect deletes tokens only.
- Ingestion: provider external-ID conflicts route to a persisted `needs_review` instead of aborting the batch.
- CI/config: local Supabase email provider enabled (public signup stays off via `[auth] enable_signup=false`); tests aligned.
- Bench script: `scripts/bench-near-search.ts`.

## Why

Fix open PR #21 findings (near-search Load More returning unfiltered rows, data loss on Spotify disconnect, batch aborts on shared external ids) and complete UI/backlog items.

## Relevant issue / spec

PR #21; `docs/project/non-blocking-debt.md` section 4; `docs/architecture/data-model.md`.

## Validation

- [x] lint: `npm run lint` PASS (0 errors/warnings); `format:check` PASS
- [x] typecheck: PASS
- [x] tests: `npm test` 110 files / 1344 tests PASS
- [x] production build: PASS
- [x] manual/browser verification: coordinator checked 375px for `/`, `/calendar`, `/calendar?month=2027-02`, an event page and `/search?near=1` (no horizontal overflow, no console errors)
- Integration (local Supabase, real dev data, 19 files / 146 tests): 144 pass, 2 fail only against the populated dev DB (`personalized-discover` Scenario B: default limit 50 vs 678 upcoming Denver events; `catalog-search-red-rocks-live` totalCount: 1,133+ events vs 300 sample cap). Both passed on a freshly reset DB earlier; CI resets the DB. New: `canonicalization-external-id-conflict-idempotency.test.ts` (2 tests, 3-run idempotency, unrelated events complete, owner artist never reassigned).
- Playwright: 14 pass / 1 skipped / 2 failed in the first run (browser session hang, 15-17 min timeouts); those two files rerun 5/5 pass.
- Ticketmaster live dry-run (`sync:all --live --horizon=near-term`, no persist): CO near/mid/long fetched 3/5/10 pages, 117/207/480 candidates; nationwide festivals 40 candidates; DB unchanged.
- Login: magic link for an admin-created user emails to Mailpit and its link redirects with a session; `otp` with `create_user:false` for an unknown email is rejected (`otp_disabled`).
- Benchmarks (Agent 1): in-memory filter 1k/5k/20k/50k/100k = 0.6/3.2/10.3/25.1/48.5 ms. Real DB scan 6k/21k/51k events: 1.5s/10.9s/26.3s at concurrency 1; 3.0s/4.5s/13.8s at concurrency 4. Local real catalog (~1k events) ~0.3s.

## Data / migration impact

New on this branch vs main (all additive):
- `20261124000000_add_event_venue_image_urls.sql` - events/venues `image_url`, `apply_canonicalization` image fill-if-empty.
- `20261124010000_add_artist_genres.sql` - `artists.genres/genres_source/genres_updated_at`.
- `20261124020000_add_artist_weight_to_profiles.sql` - `profiles.artist_weight` (20..80).
- `20261124030000_cleanup_ticket_package_listings.sql` - cleans "Club Level Seating" package rows.
- `20261125010000_create_user_spotify_artist_affinities.sql` - affinity table, RLS (select/delete own), cascade on user delete.
- `20261125020000_apply_canonicalization_needs_review_conflicts.sql` - persists needs_review conflicts (`duplicate_external_id_conflict`); unchanged behaviour for non-conflicting input (golden-path and ticketmaster-canonicalization integration pass).
Both 20261125 files applied cleanly to the real local DB (1,133 events). Re-running 010000 in a rolled-back transaction fails only at `create policy` (policies are not guarded, like every other migration); 020000 re-runs cleanly (create or replace). Not replayed from an empty DB locally; CI does that.

## Source / scraper impact

Ticketmaster conflicts become `needs_review` rows rather than aborting the batch; no new sources.

## Security / privacy impact

New private table with RLS; cascade deletion verified with a throwaway user. No secrets committed. NOTE: the local GoTrue container predates the config change and currently allows signup; restart to confirm `signup_disabled` (config has `[auth] enable_signup=false`).

## Known limitations

- Cold first `near=1` request at 20k+ events takes ~4-26s (needs a lightweight id/city/coords scan or RPC in catalog-repository); no cap was introduced.
- `/search` page 1 and Load More share a default 12-month end date; shows further out are hidden unless `endDate` is given.
- Discover/search timezone default is hardcoded `America/Denver` (`DISCOVER_TIMEZONE`, `lib/discover/dates.ts`), conflicting with the no-hardcoded-geography invariant; not fixed.
- `resolveNearContext` has no dedicated test.
- Two TM attractions resolving to one existing artist (two ticketmaster ids) still abort the batch via `uq_artist_provider`.
- Not run: real Spotify OAuth connect/disconnect (interactive consent), fresh-DB replay, persisted live ingestion, ticket-image and invited-user browser QA. The 2 integration tests above fail on large populated DBs.

## Handoff / next step

Independent review; do not merge until CI is green on the pushed SHA. See `AI_HANDOFF.md`.
