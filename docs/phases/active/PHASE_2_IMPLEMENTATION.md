# Phase 2 Implementation Specification: Live Ingestion & Personalization

Authoritative implementation plan and operational architecture for Phase 2 of the Encore Concert Finder.

---

## 1. Phase Objective & Intended Outcomes

### 1.1 Objective
Phase 1 established the canonical inventory, provenance, and atomic database persistence architecture using deterministic fixtures. The objective of Phase 2 is to transform Encore into a functional, data-driven live-music discovery system by connecting its first production inventory source (**Ticketmaster Discovery API v2**), proving the entity-resolution and evidence pipeline under real-world event data, and introducing explainable personalized recommendation scoring driven by Spotify music taste and explicit user preferences.

### 1.2 Intended Outcomes
1. **Real-World Live Ingestion:** A hardened, production-ready source adapter for Ticketmaster Discovery API v2 ingesting concerts, festivals, artists, venues, and ticket links into immutable raw observations and parsed candidates.
2. **Proven Canonicalization Pipeline:** Real external data passes safely through entity resolution (artist matching, venue matching, event deduplication, field-level merging, and provenance evidence tracking) into canonical PostgreSQL tables via the existing atomic `apply_canonicalization` stored procedure.
3. **Operational Robustness & Idempotency:** Repeat execution against identical provider responses produces zero duplicate canonical events or orphaned records. Rate-limiting, backoff/retries, and source health tracking prevent API throttling or system failures.
4. **Spotify Taste Ingestion:** A secure server-side OAuth flow and ingest mechanism connecting Spotify listening affinity (`user-top-read`, `user-library-read`) without leaking tokens to the client.
5. **Transparent, Multi-Factor Recommendation Scoring:** An explainable recommendation engine combining distinct affinity signals (artist taste, price tolerance, distance/travel, and timing) to answer: *"Why is this concert worth attending for me?"*
6. **Enhanced Discover UI:** User-facing discovery modes ("This Weekend", "Cheap & Nearby", "Worth Planning For") with visible source provenance attribution and transparent match explanations.

---

## 2. Existing Infrastructure Inventory

An audit of the Phase 1 codebase reveals a robust architectural foundation ready for extension:

| Subsystem | What Exists in Phase 1 | What is Tested | What is Missing for Phase 2 | Phase 2 Action |
|---|---|---|---|---|
| **Source Adapters** | `EventSourceAdapter` contract (`id`, `fetch`, `parse`, `crawl`) in `lib/domain/source.ts`; `FakeVenueSourceAdapter` in `tests/fixtures/`. | Unit tests for crawling & hashing; integration tests for fake JSON pipeline. | Live HTTP client; API key authentication; rate limiting; pagination; Ticketmaster Discovery v2 payload parsing. | Implement `TicketmasterDiscoveryAdapter` in `lib/sources/ticketmaster/` with Zod-validated response schemas. |
| **Raw Ingest Persistence** | `SupabaseRawIngestRepository` & `MemoryRawIngestRepository`; `raw_ingests` Postgres table with SHA-256 hash. | Raw ingest persistence and lookup by content hash. | Replay runner; duplicate ingestion skipping; payload pruning policy. | Add deduplication check `getBySourceUrlAndContentHash()` before persisting new raw ingest rows. |
| **Candidate Creation** | `SupabaseEventCandidateRepository` & `MemoryEventCandidateRepository`; composite foreign key enforcement. | Creation of candidates linked to raw ingests; retrieval by `source_event_id`. | Ticketmaster payload mapping to `EventCandidate` (dates, timezones, prices, multiple acts). | Implement `parseTicketmasterEvent()` mapping TM Discovery schema to standard `EventCandidate` domain models. |
| **Entity Resolution & Matching** | `ArtistResolver`, `VenueResolver`, `EventMatcher`, `FieldMerge` in `lib/entity-resolution/`. | 21 unit tests; 18 matcher tests; golden path integration test covering rescheduling & cancellations. | External ID handling for Ticketmaster attraction IDs; atomic enrichment of existing matched artists (Tech Debt 1.2). | Support `ticketmaster` provider in external IDs; implement non-conflicting external ID enrichment for canonical artists. |
| **Atomic Persistence** | `CanonicalizationCoordinator` & `apply_canonicalization` Postgres stored procedure (SECURITY DEFINER). | Full 21-step integration suite verifying single-transaction atomic creation and field evidence emission. | Verified operation against high-variance real API inputs (missing cities, non-standard dates, multi-acts). | Route non-compliant candidates (e.g. missing venue city) to `needs_review`; verify atomic persistence under real data. |
| **Catalog Repository & UI** | `SupabaseCatalogRepository` (`listEvents`, `getEventById`); `app/discover/page.tsx`; `EventCard.tsx`. | Basic listing, currency formatting, status badges; Playwright smoke tests. | Source attribution badges (Tech Debt 1.3); unknown venue fallback (Tech Debt 1.4); recommendation scoring; filter controls. | Surface source badges and match explanations on `EventCard`; add discovery mode filters ("This Weekend", "Cheap & Nearby"). |
| **Database Migrations** | 4 migrations covering profiles, catalog, ingest provenance, and RLS security. | Catalog RLS (9 tests); Profiles RLS (7 tests); Golden path pipeline (21 tests). | Dedicated user Spotify connection / artist taste table if relational queries warrant (or `profiles.preferences` JSONB). | Maintain zero migration changes for initial TM ingestion; evaluate separate taste table for Workstream C. |

---

## 3. Architecture & Dependency Analysis

```
                              ┌───────────────────────────────────┐
                              │ Ticketmaster Discovery API (v2)   │
                              └─────────────────┬─────────────────┘
                                                │ (API Key via serverEnv)
                                                ▼
                              ┌───────────────────────────────────┐
                              │ TicketmasterDiscoveryAdapter      │
                              │ (Rate Limit: 5 req/s, Pagination) │
                              └─────────┬───────────────────┬─────┘
                                        │                   │
                 Raw JSON Snapshot      ▼                   ▼  Parsed EventCandidates
                         ┌───────────────────────┐ ┌───────────────────────┐
                         │   raw_ingests table   │ │ event_candidates table│
                         │ (Immutable Audit Log) │ │ (Immutable Observation│
                         └───────────────────────┘ └───────────┬───────────┘
                                                               │
                                                               ▼
                                                  ┌─────────────────────────┐
                                                  │ Entity Resolution:      │
                                                  │ - ArtistResolver        │
                                                  │ - VenueResolver         │
                                                  │ - EventMatcher          │
                                                  │ - FieldMerge            │
                                                  └────────────┬────────────┘
                                                               │
                                                               ▼
                                                  ┌─────────────────────────┐
                                                  │ apply_canonicalization  │
                                                  │ (Atomic PostgreSQL RPC) │
                                                  └────────────┬────────────┘
                                                               │
                         ┌─────────────────────────────────────┴─────────────────────────────────────┐
                         ▼                                                                           ▼
            ┌─────────────────────────┐                                                 ┌─────────────────────────┐
            │ Canonical Catalog       │                                                 │ Provenance & Audit      │
            │ (events, artists,       │                                                 │ (event_sources,         │
            │  venues, ticket_links)  │                                                 │  event_field_evidence,  │
            └────────────┬────────────┘                                                 │  candidate_resolutions) │
                         │                                                              └─────────────────────────┘
                         ▼
        ┌──────────────────────────────────┐        ┌──────────────────────────────────┐
        │ Recommendation Engine            │◄───────┤ Spotify Taste Ingestion          │
        │ (lib/recommendation/):           │        │ (User Top Artists & Library,     │
        │ - Artist Affinity Factor         │        │  Server-side OAuth & RLS)        │
        │ - Price Sensitivity Factor       │        └──────────────────────────────────┘
        │ - Distance / Travel Factor       │
        │ - Event Timing Factor            │
        └────────────────┬─────────────────┘
                         │
                         ▼
        ┌──────────────────────────────────┐
        │ Discover UI (/discover)          │
        │ - Ranked feeds ("This Weekend")  │
        │ - Transparent match explanations │
        │ - Source attribution badges      │
        └──────────────────────────────────┘
```

---

## 4. Scope & Explicit Exclusions

### 4.1 In Scope for Phase 2
- **Ticketmaster Discovery API v2 Ingestion:** Read-only event search by geographic scope (initially configurable state/market, e.g. `CO` / Denver market for testing, with no hardcoded fallback constants).
- **Candidate Normalization:** Full mapping of Ticketmaster attractions, venues, dates, start times, price ranges, classifications, and URLs to `EventCandidate`.
- **Entity Resolution Hardening:** Handling Ticketmaster IDs in `artist_external_ids`, venue locality safeguards, and duplicate show protection.
- **Accepted Tech Debt Closeouts:**
  - Item 1.2: Atomic enrichment of trusted external IDs on already-matched canonical artists.
  - Item 1.3: Discover catalog source attribution badges.
  - Item 1.4: Unknown-venue display behavior ("Venue TBA" badge).
- **Controlled Ingestion Execution:** CLI command / administrative service runner (`npm run ingest:ticketmaster`) with dry-run support, pagination caps, and rate limits.
- **Spotify Web API Integration:** OAuth authorization code flow, secure token persistence with RLS, and extraction of top artists and saved library.
- **Transparent Recommendation Scoring:** Pure, testable scoring factors for artist affinity, price tolerance, travel distance, and timing.
- **Explainable Ranking UI:** Ranked feeds on `/discover` with human-readable rationale (e.g., *"Top 5 artist on your Spotify, within your $40 budget"*).

### 4.2 Explicit Exclusions (Out of Scope for Phase 2)
- **Direct Web Scraping / Crawling:** No Cheerio or Playwright scrapers for venue calendars (deferred to Phase 3).
- **Uncontrolled Production Cron Jobs:** No automated unmonitored background jobs polling Ticketmaster in production; ingestion remains controlled and measurable.
- **Attendance & Review Logging:** Past concert entry, reviews, and post-event learning remain deferred to Phase 4 (per `docs/product/attended-concerts-and-reviews.md`).
- **Festivals Lineup Breakdown:** Multi-day festival stage schedules and day-pass breakdowns remain deferred to Phase 5.
- **Watchlists & Push Alerts:** Push notifications, SMS, or email alerts remain deferred to Phase 6.
- **Newsletter / Email Parsing:** Deferred to Phase 6/9 per `docs/product/future-features.md`.
- **Learning Hub Overhaul:** The Project Hub at `/hub` remains strictly read-only and will not be redesigned; only read-only telemetry metrics will be exposed.

---

## 5. Workstream Breakdown

### Workstream A: Live Ticketmaster Ingestion
1. **API Client:** Implement `TicketmasterApiClient` utilizing `fetch` with exponential backoff, status code handling (429 Too Many Requests, 5xx server errors), and authentication via `TICKETMASTER_API_KEY`.
2. **Rate Limiting & Safety:** Enforce client-side rate limits (max 5 requests per second) and pagination guards (Ticketmaster caps total pagination at 1,000 events: `page * size < 1000`).
3. **Adapter Implementation:** Implement `TicketmasterDiscoveryAdapter` conforming to `EventSourceAdapter` contract.
4. **Data Normalization:**
   - Map `dates.start.localDate` and `dates.start.localTime` respecting `dates.start.timeTBA` and `dates.start.dateTBD`.
   - Preserve IANA timezones (`dates.timezone`).
   - Extract price ranges (`min`, `max`, `currency`).
   - Extract primary ticketing URLs, stripping tracking parameters (`utm_*`, `gclid`).
   - Map attractions into `CandidateArtist` entries with `billingPosition` (first attraction = `headliner`, secondary = `support`).
   - Attach external IDs: `provider: 'ticketmaster'`, `externalId: attraction.id`.
5. **Deterministic Fixtures:** Build comprehensive, sanitized response fixtures (`tests/fixtures/ticketmaster-events-response.json`) covering standard concerts, multi-act bills, date-only events, cancelled events, and missing venue metadata.

### Workstream B: Data Quality & Entity Resolution
1. **Pipeline Execution:** Ensure candidates generated from real Ticketmaster payloads flow through `CanonicalizationCoordinator` without constraint failures.
2. **External ID Enrichment (Debt 1.2):** Update canonicalization logic to register newly discovered `ticketmaster` or `spotify` external IDs onto already-matched canonical artists when no conflict exists.
3. **Deduplication Verification:** Verify that re-ingesting the same Ticketmaster events across consecutive runs produces 0 duplicate canonical entities and correctly updates `event_sources.last_seen_at`.
4. **Edge Case Handling:**
   - Missing venue city: route candidate to `needs_review` with reason `missing_venue_locality`.
   - Cancelled / postponed shows: update canonical `status` via `FieldMerge` without deleting records.
   - Rescheduled dates: update `local_start_date` and emit field evidence.

### Workstream C: Spotify & Music Preferences
1. **OAuth Architecture:** Authorization Code Flow with PKCE via server-side API routes (`/api/auth/spotify/login`, `/api/auth/spotify/callback`).
2. **Token Security:** Store refresh and access tokens in a private user table protected by Row Level Security (`auth.uid() = user_id`) and service-role-only access. Never pass access tokens to the browser.
3. **Taste Ingestion:** Fetch user top artists across time ranges (`short_term`, `medium_term`, `long_term`) and saved library artists.
4. **Identity Linking:** Match Spotify artist IDs (`spotify:artist:<id>`) against `artist_external_ids` in the canonical catalog.
5. **Preference Separation:** Maintain separate signals for recorded listening affinity, explicit user favorites, venue preferences, price sensitivity, and travel willingness.

### Workstream D: Transparent Recommendation Scoring
1. **Scoring Factors:** Implement independent, testable scoring functions in `lib/recommendation/`:
   - $S_{\text{artist}} \in [0, 1]$: Affinity derived from Spotify rank and explicit favorites.
   - $S_{\text{price}} \in [0, 1]$: Value score based on user budget curve and willingness-to-pay elasticity.
   - $S_{\text{distance}} \in [0, 1]$: Distance decay function from user location to venue.
   - $S_{\text{timing}} \in [0, 1]$: Preference matching for weekend vs. weekday shows.
2. **Missing Data Principles:**
   - Missing price does *not* mean free; price factor returns neutral (0.5) with note "Price TBA".
   - Unfamiliar artists receive 0.0 affinity, but high local-discovery or cheap-show scores can still elevate them in "Cheap & Nearby" feeds.
3. **Explainability Engine:** Generate plain-English explanations for every recommendation:
   - *"Top 5 artist on your Spotify, reasonable ticket price ($28), and close to your area."*
4. **Discovery Feeds:** Expose views for:
   - **This Weekend:** Filtered by upcoming Friday–Sunday, sorted by composite score.
   - **Cheap & Nearby:** Filtered by price ceiling and distance, weighted towards value.
   - **Worth Planning For:** High artist affinity with longer booking horizons.

---

## 6. Relevant Code Modules & Database Tables

### 6.1 Code Modules
```
lib/
├── domain/                         # Phase 1 domain types (source, candidate, catalog)
├── sources/
│   └── ticketmaster/
│       ├── types.ts                # Ticketmaster API response types (Zod schemas)
│       ├── client.ts               # HTTP client with rate limiting & backoffs
│       ├── adapter.ts              # TicketmasterDiscoveryAdapter implementing EventSourceAdapter
│       └── parser.ts               # Payload-to-EventCandidate mapper
├── spotify/
│   ├── types.ts                # Spotify API types
│   ├── client.ts               # Server-side Spotify Web API client
│   └── taste-ingest.ts         # User taste extraction and catalog ID mapping
├── recommendation/
│   ├── types.ts                # Recommendation features, weights, and explanation types
│   ├── factors/
│   │   ├── artist-affinity.ts  # Artist taste scoring
│   │   ├── price-value.ts      # Price elasticity scoring
│   │   ├── distance.ts         # Distance decay scoring
│   │   └── timing.ts           # Date/day-of-week scoring
│   ├── engine.ts               # Composite scoring coordinator
│   └── explainer.ts            # Human-readable rationale generation
├── entity-resolution/              # Phase 1 resolvers & coordinator
├── repositories/                   # Phase 1 repository interfaces & implementations
└── scripts/
    └── ingest-ticketmaster.ts      # Controlled CLI ingestion runner
```

### 6.2 Database Tables
- **Existing Tables Utilized:**
  - `sources` (Source record for Ticketmaster with slug `'ticketmaster-discovery'`)
  - `raw_ingests` (Immutable JSON payloads)
  - `event_candidates` (Parsed observation records)
  - `events`, `artists`, `venues`, `promoters` (Canonical entities)
  - `artist_external_ids` (Maps `provider = 'ticketmaster'` and `'spotify'`)
  - `event_artists`, `event_ticket_links`, `event_sources`, `event_field_evidence`
  - `candidate_resolutions` (`created`, `matched`, `needs_review`)
  - `profiles` (User profile & preferences)
- **New Tables Proposed (Workstream C):**
  - `user_spotify_connections`: Secure storage for Spotify OAuth tokens (`user_id`, `access_token`, `refresh_token`, `token_expires_at`, `scopes`, `created_at`, `updated_at`) with strict RLS (`auth.uid() = user_id`) and service-role write.
  - `user_artist_affinities`: Ingested taste profile linking `user_id`, `artist_id` (nullable canonical reference), `spotify_artist_id`, `affinity_score`, `affinity_tier` (`top_short`, `top_medium`, `top_long`, `saved`).

---

## 7. External API Requirements

### 7.1 Ticketmaster Discovery API v2
- **Base URL:** `https://app.ticketmaster.com/discovery/v2/`
- **Primary Endpoint:** `/discovery/v2/events.json`
- **Authentication:** Query parameter `apikey={TICKETMASTER_API_KEY}`.
- **Default Rate Limits:**
  - Rate: 5 requests per second (enforced via token bucket / delay queue in client).
  - Quota: 5,000 calls per day.
- **Pagination Rules:** `size` parameter (default 20, max 100), `page` parameter (0-indexed). Maximum `page * size < 1000`.
- **Classification Filtering:** Filter by `classificationName=Music` to exclude sports, theater, and family events.

### 7.2 Spotify Web API
- **Base URL:** `https://api.spotify.com/v1/`
- **Endpoints:**
  - `/v1/me/top/artists` (time_range: `short_term`, `medium_term`, `long_term`, limit: 50)
  - `/v1/me/following?type=artist` (limit: 50)
- **Scopes Required:** `user-top-read`, `user-follow-read`.
- **Token Exchange:** OAuth 2.0 Authorization Code Flow via `https://accounts.spotify.com/api/token`.

---

## 8. Security & Secrets

1. **Secret Isolation:**
   - `TICKETMASTER_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` reside exclusively in server environment variables validated via `getServerEnv()`.
   - Never expose API keys or credentials in client bundles or public endpoints.
2. **Token Protection:**
   - Spotify access and refresh tokens are stored in `user_spotify_connections`.
   - Table protected with Row Level Security: users can never read raw tokens directly via Supabase client; server-only mutations execute via `service_role`.
3. **No Unsanitized HTML/Input:**
   - External event descriptions, URLs, and artist names must be sanitized before rendering to prevent XSS.

---

## 9. Data Integrity Requirements

1. **Immutability:** Every Ticketmaster API fetch produces a discrete `raw_ingests` record with its SHA-256 hash. Never overwrite raw ingest rows.
2. **Provenance:** Populate `event_field_evidence` for every canonical attribute derived from Ticketmaster.
3. **Conservative Deduplication:** If a Ticketmaster event lacks a venue city or has conflicting artist metadata, route to `needs_review` rather than guessing.
4. **Temporal Invariants:**
   - Date-only events must have `starts_at = null` and `startTimePrecision = 'date_only'`.
   - Instant events must have valid UTC `starts_at` and preserved IANA `timezone`.
   - Never fabricate midnight local times.

---

## 10. Proposed Schema & Migration Changes

### For Ingestion (PR 1 – PR 3):
- **Zero Schema Migrations Required:** The Phase 1 schema (`events`, `artists`, `venues`, `sources`, `raw_ingests`, `event_candidates`, `artist_external_ids`, `event_sources`, `event_field_evidence`, `candidate_resolutions`) was intentionally designed to support multi-provider ingestion generically.
- Ticketmaster attraction IDs map directly into `artist_external_ids(provider='ticketmaster')`.

### For Personalization (PR 4):
- **Migration `20261015000000_create_spotify_and_taste_tables.sql`:**
  ```sql
  create table public.user_spotify_connections (
    user_id uuid primary key references auth.users(id) on delete cascade,
    access_token text not null,
    refresh_token text not null,
    token_expires_at timestamptz not null,
    scopes text[] not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  alter table public.user_spotify_connections enable row level security;
  -- Restrict all direct access; manipulated strictly by service_role via backend

  create table public.user_artist_affinities (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    canonical_artist_id uuid references public.artists(id) on delete set null,
    spotify_artist_id text not null,
    artist_name text not null,
    affinity_score double precision not null,
    affinity_tier text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_user_spotify_artist unique (user_id, spotify_artist_id)
  );
  alter table public.user_artist_affinities enable row level security;
  create policy "Users can read own artist affinities"
    on public.user_artist_affinities for select using (auth.uid() = user_id);
  ```

---

## 11. Testing & Verification Requirements

Every PR must satisfy the full repository verification suite:
```bash
npm run format:check     # Prettier formatting
npm run lint             # ESLint (0 errors, 0 warnings)
npm run typecheck        # tsc --noEmit
npm test                 # Unit tests (must maintain 100% pass rate)
npm run build            # Next.js production build
npm run test:e2e         # Playwright smoke tests
```
When Docker/Supabase is available:
```bash
npm run test:integration # PostgreSQL-backed integration suite
```

### Test Fixture Discipline:
- Live external API calls are strictly forbidden in unit tests or standard CI.
- All adapter, parser, and resolver tests must execute against static, deterministic JSON fixtures (`tests/fixtures/ticketmaster-events-response.json`).

---

## 12. CI Implications

- GitHub Actions (`.github/workflows/ci.yml`) runs on `ubuntu-24.04` with Node 24.
- Ingestion tests will execute against local fixtures and in-memory repositories.
- Integration tests will exercise PostgreSQL when Supabase test services are provisioned.
- CI duration must remain under 3 minutes.

---

## 13. Implementation Order & Dependencies (PR Breakdown)

Phase 2 will be delivered in 6 focused, independently reviewable PRs:

### PR 1 — Live Ticketmaster Ingestion Foundation
- **Goal:** Official Ticketmaster API client, response schema validation, adapter implementation, deterministic fixtures, and controlled CLI ingestion script.
- **Files:** `lib/sources/ticketmaster/`, `lib/env/server.ts`, `tests/fixtures/ticketmaster-events-response.json`, `tests/unit/ticketmaster-adapter.test.ts`, `scripts/ingest-ticketmaster.ts`.
- **Boundary:** Produces `RawIngest` and `EventCandidate` objects without running canonicalization.
- **Verification:** Unit tests for parsing, rate-limiting, error handling; Next.js build.

### PR 2 — Canonicalization Integration & Real-Data Verification
- **Goal:** Feed real Ticketmaster candidates through `CanonicalizationCoordinator` and the atomic PostgreSQL procedure.
- **Files:** `lib/entity-resolution/`, `tests/integration/ticketmaster-canonicalization.test.ts`.
- **Debt Resolution:** Close Tech Debt 1.2 (enriching existing canonical artists with newly discovered external IDs atomically).
- **Verification:** Integration tests verifying candidate $\to$ canonical event persistence, evidence emission, and idempotent replay.

### PR 3 — Ingestion Reliability, Operational Safeguards & UI Polish
- **Goal:** Content-hash duplicate skipping, source health tracking, and Discover page visual provenance.
- **Files:** `lib/sources/ticketmaster/`, `components/catalog/EventCard.tsx`, `app/discover/page.tsx`.
- **Debt Resolution:** Close Tech Debt 1.3 (source attribution badges) and Tech Debt 1.4 (unknown-venue display behavior).
- **Verification:** Unit tests and Playwright smoke tests for Discover UI.

### PR 4 — Spotify Authentication & Taste Ingestion
- **Goal:** Secure Spotify OAuth flow, encrypted token storage with RLS, and extraction of top artists into `user_artist_affinities`.
- **Files:** `lib/spotify/`, `app/api/auth/spotify/`, database migration for Spotify connections/affinities.
- **Verification:** Unit tests with mock Spotify responses; RLS tests for user taste data.

### PR 5 — Recommendation Feature Foundation
- **Goal:** Pure, deterministic scoring factor modules for artist affinity, price elasticity, travel distance, and timing.
- **Files:** `lib/recommendation/factors/`, `tests/unit/recommendation-factors.test.ts`.
- **Verification:** Comprehensive unit tests covering normal values, edge cases, missing data, and boundary conditions.

### PR 6 — Personalized Ranking, Explanations & Discovery Views
- **Goal:** Composite ranking engine, human-readable explanation generation, and curated discovery feeds ("This Weekend", "Cheap & Nearby", "Worth Planning For") on `/discover`.
- **Files:** `lib/recommendation/engine.ts`, `lib/recommendation/explainer.ts`, `app/discover/`, `components/catalog/`.
- **Verification:** End-to-end unit and E2E tests for ranked event browsing and accessible explanation display.

---

## 14. Risks & Mitigation Strategies

| Risk | Impact | Mitigation Strategy |
|---|---|---|
| **Ticketmaster API Rate Limits (429)** | Pipeline failure / blocked key | Implement token-bucket client rate limiting (max 5 req/s) with exponential backoff and jitter. |
| **Missing / Incomplete Venue Data** | Malformed canonical venues | Enforce locality requirement: if venue lacks `city`, route candidate to `needs_review` with `missing_venue_locality`. |
| **Dirty External Artist Names** | False merges or duplicates | Precedence to Ticketmaster attraction IDs; normalized matching flags ambiguous names for review. |
| **Spotify API Scope Restrictions** | OAuth failures or rejected access | Request only minimal read scopes (`user-top-read`, `user-follow-read`); do not rely on deprecated endpoints. |
| **Missing Price Ranges** | Distorted ranking scores | Explicit missing-data rule: missing price is treated as neutral (0.5 factor) with "Price TBA" explanation, never free (\$0). |
| **Client-Side Secret Leakage** | Compromised credentials | `getServerEnv()` strictly throws if evaluated in browser; zero API keys or service-role keys in public configs. |

---

## 15. Decisions Requiring Owner Approval

Before merging implementation PRs:
1. **Initial Search Geographic Scope:** Confirm whether Colorado (`stateCode=CO` / Denver market ID `27`) remains the preferred initial testing market for manual ingestion runs (without hardcoding it into architecture).
2. **Ingestion Execution Trigger:** Confirm that manual CLI execution (`npm run ingest:ticketmaster -- --dry-run`) is approved as the operational trigger for PR 1, rather than automated background cron jobs.
3. **Spotify Token Storage:** Confirm preference for dedicated tables (`user_spotify_connections`, `user_artist_affinities`) versus storing taste profiles inside `profiles.preferences` JSONB.

---

## 16. Acceptance Criteria

Phase 2 will be accepted when:
1. Ticketmaster Discovery API v2 adapter fetches, validates, and parses real live event data into immutable raw ingests and candidates.
2. Canonicalization coordinator atomically persists real Ticketmaster events into Postgres with complete field-level evidence.
3. Repeated ingestion runs are 100% idempotent (zero duplicate events, zero unhandled errors).
4. Spotify taste ingestion securely links user music affinity to canonical artists without leaking tokens.
5. Recommendation scoring generates explainable, multi-factor ranking scores for upcoming concerts.
6. Discover UI displays curated feeds ("This Weekend", "Cheap & Nearby", "Worth Planning For") with visible source provenance and human-readable match explanations.
7. All verification checks pass cleanly with 100% green CI.

---

## 17. Definition of Done

- [ ] All 6 PRs reviewed and merged into `main` with green CI.
- [ ] 0 TypeScript errors (`tsc --noEmit`).
- [ ] 0 ESLint warnings or errors.
- [ ] Prettier formatting verified.
- [ ] Comprehensive unit tests and integration tests passing.
- [ ] `AI_HANDOFF.md` updated after each milestone.
- [ ] `docs/phases/active/PHASE_2_IMPLEMENTATION.md` archived to `docs/phases/completed/` upon phase completion.

---

## 18. Known Technical Debt & Deferred Enhancements

1. **High-Volume Crawl Scheduler:** Automated distributed scheduling for high-frequency promoter/venue crawlers is deferred to Phase 3/8.
2. **Large-Payload Object Storage:** Storing raw HTML/API payloads $>500$ KB in S3/R2 is deferred until payload volume warrants.
3. **Manual Resolution Operator UI:** Human-in-the-loop admin UI for reviewing `needs_review` candidates remains deferred.
4. **Attendance Logging & Multi-Dimensional Experience Signals:** Past concert logging deferred to Phase 4 per `docs/product/attended-concerts-and-reviews.md`.
