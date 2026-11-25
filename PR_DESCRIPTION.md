## What changed

Branch `fix/ui-discover-auth-v2` against `main`:

- **Discover and search:** Discover home, calendar (opens on the current month, `?month=YYYY-MM`), preferences page, Spotify ranks and trend-aware affinity, genre taste inference, shared genre module (genre-aware search, genre filter, "Mixed" label, badge colors), match scores on cards (genuine personalized scores only, also on the Discover home cards).
- **Search reliability:** `near=1` (within my radius) is one shared server path for `/search` and `/api/catalog/search`: first page, Load More, counts and sorting all use the same radius/home/filters over the WHOLE catalog (no first-N cap). A light scan (id, city, region, coordinates, sort keys) finds in-range ids, then only the requested page is hydrated (`lib/location/near-search.ts`, `catalog-search.ts`, `near-context.ts`, `catalog-repository.listEventLocations/getEventsByIds`). URL price limits are exact. `/search` has no 12-month cap any more.
- **No hardcoded timezone:** viewer timezone = `encore_tz` cookie (set from the browser) else home-city timezone else UTC (`lib/location/timezone.ts`); Denver defaults removed from discover dates, modes and service.
- **Spotify:** imported artist affinities persist after disconnect/expiry (disconnect deletes tokens only); the stored listening-period view shows only artists with a rank in the chosen window (no fallback to other periods); a short "Listen" embed of the headliner's top tracks on the event page (only with a verified Spotify id).
- **Ticketmaster / identity:** seat-package listings are never artists/titles; genres come from Ticketmaster classifications; an artist may hold several external ids from one provider (an id owned by another artist is never reassigned and goes to a persisted `needs_review`); attractions in one listing that share an id collapse into one artist with an auditable evidence row (fixes "Day Out With Thomas"); shows with no artist but at least one genre are created (without a genre: persisted `needs_review`); a performer-level Religious genre is dropped on non-Music events ("House Party"); re-syncing sources without a source-side event id is idempotent.
- **Non-events and images:** closure / private-booking / hours listings ("Closed for Private Event") are rejected at ingestion (`lib/sources/non-events.ts`, reason `not_a_public_event`) and existing ones are removed by a migration; cards without an image get a generated placeholder (deterministic gradient, one of four patterns, monogram, venue name: `components/index/EventPlaceholder.tsx`); `npm run enrich:venue-images` fills venue images from a venue's own site share image (logos/stickers and multi-venue sites are skipped, so it currently finds none for the seven scraped Colorado venues).
- **Config:** local Supabase email provider enabled (public signup stays off via `[auth] enable_signup=false`).
- Bench script: `scripts/bench-near-search.ts`.

## Why

Fix the open PR #21 findings (Load More returning unfiltered rows, data loss on Spotify disconnect, batch aborts on shared external ids, hidden shows, hardcoded geography) and complete the product backlog (genres, prices, club nights, song preview).

## Relevant issue / spec

PR #21; `docs/project/non-blocking-debt.md` section 4; `docs/architecture/data-model.md`; `docs/architecture/entity-resolution.md`.

## Validation

- [x] lint: `npm run lint` PASS (0 errors/warnings); `format:check` PASS
- [x] typecheck: PASS
- [x] tests: `npm test` 116 files / 1413 tests PASS
- [x] production build: PASS
- [x] integration (local Supabase, real dev data, 21 files / 155 tests): ALL PASS. Row counts for events/artists/venues/event_sources/profiles/affinities/auth.users were identical before and after the run. The two tests that used to fail on a large dev DB (`personalized-discover` Scenario B, `catalog-search-red-rocks-live` totalCount) were made catalog-size independent (seeded event requested by name; full page walk compared to the count) without weakening assertions.
- [x] browser (coordinator, dev server): `/`, `/calendar`, `/calendar?month=2027-02`, an event page, an artist-less event page and `/search?near=1` at 375px: no horizontal overflow, no console errors; Spotify embed renders; `encore_tz` cookie is set.
- [ ] Playwright: NOT re-run locally on the final tree (it ran earlier on the previous tree: 16 pass / 1 skipped after two environmental timeouts); relies on CI.
- Live Ticketmaster sync into the LOCAL database (persisted): all jobs pass (exit 0) including nationwide festivals and Velvet Elk. Upcoming shows 1,037 -> 1,472; shows with a listed price 75 -> 265; 215 artist-less shows with a genre were added; 29 "Day Out With Thomas" shows now exist with one artist holding both Ticketmaster ids.
- Login (local GoTrue after restarting the stack): `/auth/v1/signup` and OTP for an unknown email return `signup_disabled` (no user created); a passwordless link for an admin-created user arrives in Mailpit and signs in.
- Benchmark (cold first `near=1` request, scan all matches + page 1, real local DB with synthetic rows; seeded rows have no artists/tickets so the legacy cost is understated): total events 1,037 / 6,037 / 21,037 / 51,037 -> legacy (concurrency 4) 87 / 434 / 2,147 / 6,437 ms vs light scan 21 / 49 / 199 / 709 ms; results identical at every size.

## Data / migration impact

All additive:
- `20261124000000_add_event_venue_image_urls.sql` - events/venues `image_url`, image fill-if-empty.
- `20261124010000_add_artist_genres.sql` - `artists.genres/genres_source/genres_updated_at`.
- `20261124020000_add_artist_weight_to_profiles.sql` - `profiles.artist_weight` (20..80).
- `20261124030000_cleanup_ticket_package_listings.sql` - removes "Club Level Seating" package rows.
- `20261125010000_create_user_spotify_artist_affinities.sql` - affinity table, RLS (select/delete own), cascade on user delete.
- `20261125020000_apply_canonicalization_needs_review_conflicts.sql` - persists needs_review/rejected resolutions and external-id conflicts.
- `20261126010000_allow_multiple_external_ids_per_provider.sql` - drops `uq_artist_provider` (keeps `uq_artist_provider_external_id`).
- `20261126030000_event_sources_idempotent_without_external_id.sql` - upsert for event_sources rows without a source event id.
- `20261126040000_cleanup_non_event_listings.sql` - removes stored closure/private-booking/hours listings (and their orphaned pseudo-artists).
All applied cleanly to the real local DB over its existing data. Not replayed from an empty DB locally; CI does that. Genres and artist-less shows appear only after a Ticketmaster sync where this is deployed.

## Source / scraper impact

Ticketmaster: package filtering, genre extraction, countryCode passthrough, artist-less genre shows, shared-id collapse, trusted performer genres. New attractions lookup for Spotify top artists (exact-name, cached 24h, counts against the daily quota). No new sources.

## Security / privacy impact

New private table with RLS, cascade deletion verified with a throwaway user. The radius/home location is derived on the server (client lat/lng/radius are ignored). The timezone cookie holds only an IANA zone name. The Spotify embed loads only for a verified catalog Spotify id. No secrets committed.

## Known limitations

- Real Spotify OAuth connect/disconnect (interactive consent) and the invited-user flow in a real browser were not run; ticket images were not browser-checked.
- A first-ever visitor with no timezone cookie and no home city sees UTC dates until the next request (the cookie is set after hydration).
- The saved-preference repository tolerates several Spotify ids per artist (unit-tested); there is no database-level integration test for that path.
- A show whose only Ticketmaster genre is "World" counts as having a genre for artist-less admission (real club nights such as La Rumba), although "World" is hidden from genre badges and filters.
- Five non-US shows from an early worldwide festival run remain in the local dev DB (not in code or production).
- Spotify artist matching to catalog still depends on verified ids; genre coverage of artists keeps growing with each sync (1,409 of 2,444 locally).

## Handoff / next step

Independent review; do not merge until CI is green on the pushed SHA. See `AI_HANDOFF.md`.
