# Non-Blocking Cleanup Items & Accepted Technical Debt

This document tracks accepted non-blocking cleanup items and deferred architectural optimizations. It ensures that known refinements are documented in a durable location without cluttering the active operational handoff.

---

## 1. Post-Phase-1 Non-Blocking Cleanup Items

These items were identified during Phase 1 independent reviews and CI runs. They do not block current functionality but should be addressed during tooling and Phase 2 preparation:

### 1.1 CI Runner Pinning & Actions Modernization
- **Status:** Complete. Pinned to `runs-on: ubuntu-24.04` and modernized actions to `@v7` in `chore/repository-context-cleanup`.
- **Context:** GitHub Actions displayed non-blocking warnings regarding Node 20 runtime deprecation and future changes to `ubuntu-latest`.
- **Action Taken:**
  1. Pinned CI workflow to `runs-on: ubuntu-24.04` LTS for reproducible Docker, PostgreSQL, and Node 24 behavior.
  2. Upgraded `actions/checkout@v4` → `actions/checkout@v7` and `actions/setup-node@v4` → `actions/setup-node@v7`, which run natively on Node 24 runtime, eliminating Node 20 deprecation warnings.

### 1.2 Trusted Artist External ID Enrichment on Existing Matches
- **Status:** Complete (Phase 2, PR 2).
- **Context:** When a candidate matches an existing canonical artist, `ArtistResolver` previously returned the resolved `artistId` without persisting new external IDs on that artist.
- **Resolution:** Implemented atomic external ID enrichment in `ArtistResolver`, `CanonicalizationCoordinator`, `MemoryCatalogRepository`, and PostgreSQL stored procedure migration `20261012120000_enrich_matched_artist_external_ids.sql`. Collisions and cross-artist conflicting associations are detected and rejected.

### 1.3 Discover Catalog Source Attribution
- **Status:** Complete (Phase 2, PR 3).
- **Context:** The `/discover` catalog page displays canonical event cards, but source provenance attribution (e.g. "Sourced from Ticketmaster" or "Direct Venue Calendar") was not rendered on individual cards.
- **Resolution:** Batch-fetched `event_sources` joined with `sources` in `SupabaseCatalogRepository.listEvents` and `MemoryCatalogRepository.listEvents`, rendered subtle source provenance badges with `data-testid="source-badge"` on `EventCard.tsx`.

### 1.4 Unknown Venue Display Behavior
- **Status:** Complete (Phase 2, PR 3).
- **Context:** In fallback display cases where venue information is missing or pending resolution, UI components should display a clear "Venue TBA / Unknown" badge rather than substituting the event title in the venue slot.
- **Resolution:** Rendered `<span data-testid="venue-tba-badge">Venue TBA / Unknown</span>` in `EventCard.tsx` when venue name is missing or placeholder without fabricating event title or artist name; preserved locality display, neutral price formatting, and status badges.

---

## 2. Accepted Phase 1 Architectural Deferrals

The following items were explicitly reviewed during Phase 1 and deferred:

1. **N+1 Catalog Query Optimization:**  
   - **Status:** Complete (Phase 2, PR 3).
   - **Resolution:** Refactored `SupabaseCatalogRepository.listEvents` to batch-fetch `event_artists`, `event_ticket_links`, and `event_sources` + `sources` in single `.in('event_id', eventIds)` queries, reducing catalog page rendering from 1 + 3N queries to exactly 4 queries.
2. **Advanced Venue Aliasing Infrastructure:**  
   Bidirectional suffix and alias normalization is implemented in application code; a dedicated alias registry table and alias maintenance pipeline is deferred to future operator tooling.
3. **Manual Resolution Operator UI:**  
   `needs_review` statuses and reasons are stored in `candidate_resolutions`, but the human-in-the-loop review interface is deferred to a dedicated admin phase.
4. **Raw-Ingest Retention & Deletion Policy:**  
   Defining the retention window and pruning cron for raw ingest bodies is deferred to Phase 4 / production operations.
5. **Object-Storage Provider & Payload Size Threshold:**  
   Small payloads are stored in PostgreSQL with a nullable `external_storage_ref` column in `raw_ingests`; choosing S3/GCS/R2 and offloading large HTML payloads is deferred until high-volume scraping begins.

---

## 3. Phase 2 Deferred Architectural Optimizations (Accepted Scaling Debt)

### 3.1 Favorite-Artist Fairness Under Extreme Starvation
- **Status:** Deferred to post-launch / national catalog scaling.
- **Context:** If a single favorite artist has >100 upcoming tour dates chronologically preceding all other favorite artists, a single-query 100-event favorite retrieval could theoretically starve subsequent artists.
- **Accepted Tradeoff:** For the initial Colorado-focused launch, extreme single-artist saturation does not occur in practice. The system enforces a single bounded 100-event query with in-memory fair round-robin allocation (`applyFairArtistAllocation`), avoiding N separate database queries. Multi-query windowed pagination across hundreds of artists will be evaluated when catalog volume expands nationally.

### 3.2 Full-Text Search Scalability (PostgreSQL tsvector / RPC)
- **Status:** Deferred to Phase 3 / production scaling.
- **Context:** Multi-field catalog search in `SupabaseCatalogRepository.searchEvents` constructs PostgREST disjunction clauses (`.or(...)`) across event titles (`name.ilike."%...%"`), matching venue IDs (`venue_id.in.(...)`), and artist-matched event IDs (`id.in.(...)`). Disjunctions are sliced into 200-item chunks with double-quote escaping to avoid single-clause parser overflow.
- **Accepted Tradeoff:** `catalog-repository.ts` chunks disjunction IDs by 200 without enforcing an artificial global aggregate URL cap. At the expected Colorado launch scale (~100–300 total active events across the state), broad search queries produce filter strings of ~1.5–3.5 KB, which operate reliably and comfortably within standard 8 KB HTTP reverse proxy (Kong/Nginx) request buffers. For future national scale with thousands of concurrent event matches per query, search will migrate to a dedicated PostgreSQL full-text search index (`tsvector` / GIN index) or RPC search function.

---

## 4. Backlog Captured 2026-11-24 (Genres, Search, Calendar, Event Kinds)

Not started. Requested by the product owner; do these as a dedicated branch.

1. **Genres unknown next to most artists.** Genre badges are empty for most artists because genres only fill from Ticketmaster classifications on sync. Backfill more broadly, then show the source.
[DONE 2026-11-25] 2. **Calendar default month.** `/calendar` must open on the current month.
[DONE 2026-11-25 (lib/genres/catalog-genres.ts; PostgREST clauses covered only by existing integration suite, no dedicated genre integration test)] 3. **Genre-aware search.** Searching "hip hop" must match hip-hop genres (close/similar terms work, e.g. "hiphop", "rap"). Use the existing taxonomy in `lib/recommendation/genre.ts`.
[DONE 2026-11-25 (shown only when a real personalized score exists; guests see none)] 4. **Match score on every show.** Show a small 0–100 rating on every show card, under the "Check ticket prices" text.
[DONE 2026-11-25] 5. **Genre list cleanup.** "Live Music" is not a genre (every show is live). Children's music, French music, world music, and rodeo are not genres either. Map or drop these in one place so badges, filters and search agree.
[DONE 2026-11-25 (control already existed; now uses shared normalizer)] 6. **Genres selectable in Search** (filter control).
[DONE 2026-11-25] 7. **Mixed genre label.** Multi-genre shows (festivals) display "Mixed".
[DONE 2026-11-25 (contrast not machine-checked)] 8. **Genre colors.** Each genre gets its own badge color.
[DONE 2026-11-25 for festival/tribute/laser/album-live rules; 'House Party' religious tag comes from genre mapping, not the parser - not reproduced/fixed] 9. **Festival/event-kind classification is wrong.** Examples: "House Party" tagged religious; "Classic Albums Live" is a single night (Van Halen), not a festival; "Pink Floyd Laser Spectacular" is a light show. Review the festival detection in `lib/sources/ticketmaster/parser.ts` (name contains "festival", multi-day, genre) and add rules/tests for tribute, laser/light shows and single-night "live" album shows.
10. **Short listen of the headliner's top song on the event page (Bandsintown-style).** The `AudioPreviewPlayer` in `components/index/ConcertDetailClient.tsx` only renders when `event.spotifyPreviewTrack` is set, and `app/concerts/[id]/page.tsx` never sets it (it was prototype data), so the section vanished. Spotify no longer returns `preview_url` to new apps, so do not rebuild on that. Use the official Spotify embed (`https://open.spotify.com/embed/artist/<spotifyArtistId>`, compact iframe, plays the artist's top tracks with previews) for the headliner when a verified Spotify artist id exists in the catalog (`artist_external_ids`, provider `spotify`); render nothing (no fake player) when there is no id. Lazy-load the iframe, keep it out of the first paint, and add a unit test for id present/absent.

11. **Search Load More ignores `near=1` (open).** `/api/catalog/search` has no near support, so Load More after a radius filter returns unfiltered rows. Needs edits to `components/index/SearchClient.tsx` and `app/api/catalog/search/route.ts` (a permission check blocked the agent; not worked around). Fix: route reads near=1, uses `listEventsNearHome`, client passes `nearActive`.
