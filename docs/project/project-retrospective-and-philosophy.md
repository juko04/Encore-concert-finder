# Encore: Core Philosophy, System Architecture, Milestones & Engineering Retrospective

**Authoritative Project Synthesis for Contributors and AI Coding Agents**  
*Last Updated: November 2026 (Phase 2 Closeout)*

---

## Executive Summary

Encore is an opinionated, personalized live-music discovery platform designed to solve a fundamental deficiency in modern ticketing and event discovery products: **existing platforms answer *"what events exist?"* rather than *"which events are worth my time and money?"***

This document serves as the high-density conceptual and operational handbook for Encore. It synthesizes the product philosophy, core architectural invariants, milestones achieved, failure modes discovered during independent audits, and hard-learned engineering lessons across Phases 0, 1, and 2.

---

## 1. Product Philosophy & Core Mission

### 1.1 The Problem Space
Generic ticketing directories (Ticketmaster, Eventbrite, Bandsintown, Songkick, Dice) treat event discovery as an exhaustive catalog search. Users are inundated with thousands of events, unsorted by true willingness-to-pay, venue affinity, or actual likelihood of attendance.

Encore is **not** a generic event calendar or ticketing directory. Every feature must serve one of four core user jobs:
1. **Spontaneous Local Discovery:** Find something inexpensive and enjoyable soon ($10–$25 show at a nearby club or bar tonight or this weekend).
2. **Favorite-Artist Planning:** Identify a must-see artist months in advance and justify traveling farther or paying higher ticket prices.
3. **Nearby Indie Exploration:** Discover emerging local shows and unfamiliar acts based on musical proximity, low cost, and venue vibe.
4. **Festivals & Multi-Day Value:** Evaluate multi-day events and festivals based on lineup density, travel effort, and daily value.

### 1.2 Explainability Over Black-Box Machine Learning
A foundational tenet of Encore is **deterministic, explainable scoring**:
- No opaque, uncalibrated deep-learning or statistical recommender models are used.
- Every recommendation produces a normalized score ($S \in [0, 100]$) and an explicit, human-readable breakdown across four distinct factors: **Artist Affinity**, **Price Affordability**, **Distance Practicality**, and **Timing Convenience**.
- If an event scores 88/100, the user can inspect the "Why this show?" drawer and see the exact factor contributions (e.g., *"Top 5 artist on your Spotify, within your $40 budget, 4.2 miles away"*).
- Trust is established through transparency: missing data (such as unverified prices or missing coordinates) is honestly acknowledged rather than fabricated.

### 1.3 Dynamic Willingness-to-Pay (Non-Linear Affordability)
In live music, price tolerance is non-linear and directly correlated with affinity:
- An $80 ticket for an all-time favorite artist who tours once every four years is perceived as high value.
- A $35 ticket for an unfamiliar opener on a weeknight is perceived as overpriced.
- Encore models affordability dynamically: explicit profile defaults (`typical_budget`, `max_favorite_artist_price`, `max_spontaneous_price`) define thresholds where high affinity unlocks higher acceptable prices. "Expensive" is never equated with "bad recommendation."

### 1.4 Data Truthfulness & Anti-Hallucination
Encore enforces strict data integrity rules:
- **Price Neutrality:** An unverified or missing price is scored as neutral (50) and labeled *"Price TBA / unverified"*. It is **never** treated as free ($0).
- **Free Show Verification:** A show is only scored as 100 for price if it has a confirmed `eventKind === 'free_event'` and no contradictory positive pricing evidence.
- **Currency Isolation:** Budgets are denominated in USD. Non-USD currencies (CAD, EUR) score neutrally (50) unless converted by a verified live exchange rate.
- **Coordinate Integrity:** Invalid or missing coordinates score neutrally (50) for distance with truthful disclosure, never assuming distance is 0 miles.

---

## 2. System Architecture & Engineering Invariants

### 2.1 The Two-Tier Data Lifecycle

```
[ External APIs / Web Scrapers ] (Ticketmaster, Venues, Promoters)
              │
              ▼
    [ raw_ingests ]               <-- Immutable raw audit record (SHA-256 hashed)
              │
              ▼
   [ event_candidates ]           <-- Immutable parsed observation
              │
              ▼
   [ Entity Resolution ]          <-- ArtistResolver, VenueResolver, EventMatcher
              │
              ▼
 [ apply_canonicalization RPC ]   <-- Atomic PostgreSQL stored procedure (SECURITY DEFINER)
              │
              ├──► [ events ]
              ├──► [ artists ] & [ artist_external_ids ]
              ├──► [ venues ]
              ├──► [ event_ticket_links ]
              └──► [ event_field_evidence ]  <-- Attribute-level provenance
```

1. **Immutable Observations:** `raw_ingests` and `event_candidates` are append-only audit records. They are never mutated in place.
2. **Field-Level Provenance:** Every canonical attribute must trace back to its origin through `event_field_evidence`. Higher-confidence data is never overwritten by lower-confidence sources without explicit field-merge rules.
3. **Atomic Persistence:** All canonical entity mutations must occur within a single database transaction via `apply_canonicalization`. Zero orphaned records on partial failures.
4. **Conservative Entity Resolution:** Names are not unique keys. Artists and venues are matched using external IDs (`ticketmaster`, `spotify`) and verified canonical IDs. Ambiguous entities are routed to `needs_review` (`missing_venue_locality`).

### 2.2 Presets vs. Discovery Modes
A critical distinction maintained throughout the architecture:
- **Priority Presets (`artist_first`, `value`, `nearby`, `balanced`):**  
  Persisted user preferences stored in `profiles.recommendation_preset`. They represent the user's permanent baseline factor weights.
- **Discovery Modes (`all`, `this_weekend`, `cheap_and_nearby`, `worth_planning_for`):**  
  Ephemeral, situational exploration lenses selected on the Discover page. They filter candidates and apply temporary factor weighting overrides (`weightsOverride`) without modifying the user's saved profile preset.

### 2.3 Candidate Retrieval & Anti-Starvation Architecture
Querying upcoming events chronologically from a database introduces severe starvation: 150 upcoming local bar gigs can completely starve a favorite artist's arena show scheduled 4 months out.

Encore solves this with **Multi-Tier Quota Retrieval**:
- **Tier 1 (Favorites):** Targeted database inner-join query (`events!inner(event_artists!inner(artist_id))`) for artists marked as `favorite` (quota: up to 100 events), allocated fairly across favorites.
- **Tier 2 (Likes):** Targeted inner-join query for `like` artists (quota: up to 75 events).
- **Tier 3 (Interested):** Targeted query for `interested` artists (quota: up to 50 events).
- **Tier 4 (General Catalog):** Broad chronological upcoming catalog query (quota: up to 150 events).
- All tiers are merged and deduplicated by canonical `event.id` before ranking.

### 2.4 Deterministic Lineup Suppression Rules
When scoring multi-act bills:
1. **Disliked Headliner:** Always suppresses the event (`score: 0`, `isSuppressed: true`), regardless of openers.
2. **Disliked Support Act:** Generally suppresses the event under a non-favorite headliner.
3. **Favorite Headliner Override:** An explicit **Favorite headliner overrides disliked support acts** (the event scores 100 based on the favorite headliner and is not suppressed).
4. **Preset Immunity:** Switching presets (e.g., from `artist_first` to `value`) cannot override these suppression rules.

---

## 3. Milestones & Successes So Far

### Phase 0: Foundations & Repository Architecture
- Next.js 15 App Router, TypeScript strict mode, Tailwind CSS.
- Progressive Web App (PWA) baseline with manifest and responsive viewport styling.
- Local Supabase PostgreSQL environment with Row Level Security (RLS) on all user tables.
- Automated GitHub Actions CI pipeline running formatting, linting, typechecking, and unit tests.

### Phase 1: Canonical Inventory & Entity Resolution
- Domain abstractions: `EventSourceAdapter`, `RawIngest`, `EventCandidate`, `CanonicalEvent`.
- Entity resolution modules: `ArtistResolver`, `VenueResolver`, `EventMatcher`, `FieldMerge`.
- Atomic PostgreSQL stored procedure `apply_canonicalization` ensuring zero orphaned entities.
- Deterministic fixture test suite proving complete end-to-end canonicalization under synthetic data.

### Tooling Milestone: Encore Project Hub & Observatory
- Internal developer hub at `/hub` providing real-time telemetry metrics, entity inspection, and pipeline observability.

### Phase 2: Live Ingestion & Personalization (PRs #6 through #12)
- **PR #6 (PR 1):** Production Ticketmaster Discovery API v2 adapter with 2 req/s rate-limiting, exponential backoff, Zod schema validation, credential redaction, and dry-run CLI runner (`scripts/ingest-ticketmaster.ts`).
- **PR #7 (PR 2):** Real-data canonicalization integration; atomic external ID enrichment on matched artists (Tech Debt 1.2).
- **PR #8 (PR 3):** Content-hash duplicate skipping, source attribution badges (Tech Debt 1.3), unknown-venue fallback badges (Tech Debt 1.4), and N+1 catalog batch fetching.
- **PR #9 (PR 4A):** Explicit manual music preferences (`user_artist_preferences`), catalog-independent artist linking (`ON DELETE SET NULL`), and user-isolated RLS.
- **PR #10 (PR 4B):** Secure Spotify OAuth 2.0 PKCE flow, server-only token storage with RLS (`user_spotify_connections`), top artist & library ingestion (`user_artist_affinities`).
- **PR #11 (PR 5):** Multi-factor recommendation scoring engine (`lib/recommendation/`), pure deterministic scoring factors, lineup suppression rules, and 100% test coverage.
- **PR #12 (PR 6):** Complete Personalized Discover Experience (`/discover`), dynamic request-scoped rendering, two-tier candidate retrieval, 3 Discovery Modes, server-backed search & city filtering, accessible settings groups, transparent "Why this show?" factor disclosures, and guest browsing.
- **Final Verification State:** 528/528 unit tests passing across 38 suites, clean Next.js build, passing Playwright E2E suites, and 100% green remote GitHub Actions CI.

---

## 4. Failures, Regressions & Hard-Won Lessons

Across multiple independent review cycles, several non-obvious failure modes were caught and corrected. Every future contributor and AI agent must understand these traps:

### Pitfall 1: UTC Midnight Rollover Skew (Evening Lookahead Bug)
- **Failure:** Naive `.toISOString().slice(0, 10)` or UTC date arithmetic was used to calculate the 14-day lookahead for "Cheap & Nearby". During Denver evenings (MST, UTC-7, e.g. 7:30 PM), UTC had already advanced to tomorrow. This caused a 14-day lookahead to span 15 calendar days, leaking Day 15 concerts into the feed.
- **Lesson:** Calendar date calculations must strictly evaluate in the **event venue's local IANA timezone** (`getZonedTimeParts(refInstant, venue.timezone)`). Never perform naive UTC string slicing on timestamps.

### Pitfall 2: Chronological Candidate Truncation (Favorite Starvation)
- **Failure:** Querying the general upcoming catalog chronologically with a 150-event limit caused favorite artists scheduled 3 months out to vanish from recommendations because earlier, lower-affinity shows exhausted the query budget.
- **Lesson:** Always partition retrieval into dedicated preference-tier queries. Favorites must have their own inner-join query that bypasses general chronological truncation.

### Pitfall 3: The `100 / favorites.length` Query Explosion
- **Failure:** An early attempt at fair favorite retrieval divided the 100-event budget by the number of favorites (`Math.floor(100 / favorites.length)`). For a user with 20 favorites, this executed 20 separate database queries with a 5-event limit each, starving artists with 10 upcoming shows while overloading the database connection pool.
- **Lesson:** Execute a single bounded database query for all favorites (`limit: 100`), followed by in-memory fair round-robin allocation (`applyFairArtistAllocation`).

### Pitfall 4: Ineligible & Non-Scheduled Shows Consuming Retrieval Budgets
- **Failure:** `retrieveCandidatesWithLookback` preserved past, cancelled, and postponed events for diagnostic scoring. When discovery modes applied downstream filters, nonqualifying cancelled or past shows consumed the pagination limit, resulting in false-negative empty feeds.
- **Lesson:** Filter for `status === 'scheduled'` in public feeds and candidate discovery queries. In recommendation pipelines, use status-aware lookback with bounded follow-up pagination.

### Pitfall 5: PostgREST Filter String Overflow on Broad Searches
- **Failure:** Searching for broad terms across events, artists, and venues constructed massive `.or()` disjunction strings (`or=(name.ilike...,venue_id.in...,id.in...)`). When hundreds of venue or artist IDs matched, query strings approached proxy buffer limits (8 KB in Kong/Nginx), risking HTTP 414/431 errors.
- **Lesson:** Chunk disjunction arrays into 200-item slices, double-quote PostgREST arguments to protect against punctuation (commas, quotes in band names), and schedule native PostgreSQL full-text search (`tsvector` + RPC) for Phase 3 national scaling.

### Pitfall 6: Integration Test Fixture Pollution & Flakiness
- **Failure:** A high-volume test seeded 1,020 database rows. When tests failed midway or cleanup queries ran in the wrong order, foreign-key constraints failed, leaving orphaned records that poisoned subsequent test runs.
- **Lesson:** Integration test teardowns must delete fixtures in **strict reverse-dependency order** (`event_artists` $\rightarrow$ `event_sources` $\rightarrow$ `event_field_evidence` $\rightarrow$ `events` $\rightarrow$ `venues` $\rightarrow$ `artists`) inside guaranteed `finally` blocks.

### Pitfall 7: The "Silent Mock" & Test Weakening Anti-Pattern
- **Failure:** Integration tests that caught database connection errors and silently logged a warning while passing with exit code 0 gave a false sense of security while hiding broken SQL migrations.
- **Lesson:** Enforce fail-closed test boundaries. If a test requires PostgreSQL/Supabase, it must throw an explicit error (`throw new Error('Supabase required')`) when offline. **Never weaken database constraints or delete assertions to make CI green.**

### Pitfall 8: Conflating Scoring Presets with Discovery Modes
- **Failure:** Developers repeatedly attempted to implement Discovery Modes by modifying the user's saved `recommendation_preset` in the database. This corrupted the user's baseline preferences.
- **Lesson:** Presets are persisted user configuration. Discovery Modes are ephemeral request-time view filters that apply temporary weighting overrides without database writes.

### Pitfall 9: Contradictory Pricing & Currency Assumptions
- **Failure:** Displaying a show as "Free" because a ticket price was $0, even though the status was "TBA" or the event was a festival requiring passes; or converting CAD 45 directly against a USD 35 budget.
- **Lesson:** Require explicit verified classification for free admission. Contradictory evidence must score neutrally (50). Foreign currencies must fail closed to neutral scoring unless backed by live exchange rates.

### Pitfall 10: Lineup Suppression Inversion
- **Failure:** If an opener on a bill was marked "Disliked", the entire event was suppressed, even if the headliner was the user's #1 Favorite artist. Conversely, if a headliner was disliked, a liked opener could cause the event to recommend.
- **Lesson:** Enforce deterministic hierarchy: Disliked headliner always suppresses; Favorite headliner overrides disliked support.

---

## 5. Blueprint for Future Contributors & AI Agents

### 5.1 Context-Routing Discipline (Read Minimum Necessary)
Do not load the entire repository into context. Practice progressive disclosure:

| If you are working on... | Read these authoritative files: |
|---|---|
| **Any task (always)** | `AI_HANDOFF.md`, `AGENTS.md`, `docs/index.md` |
| **Current status & active task** | `AI_HANDOFF.md` |
| **Database, schema, migrations, RLS** | Active phase spec, `docs/architecture/data-model.md`, `docs/architecture/security.md` |
| **Ingestion, scrapers, Ticketmaster** | Active phase spec, `docs/architecture/ingestion.md`, `docs/architecture/sources.md` |
| **Entity resolution, deduplication** | Active phase spec, `docs/architecture/entity-resolution.md` |
| **Scoring, ranking, recommendations** | `docs/product/recommendation-philosophy.md`, `lib/recommendation/` |
| **Discover UI & components** | `docs/product/vision.md`, `components/discover/` |
| **Known technical debt** | `docs/project/non-blocking-debt.md` |

### 5.2 Mandatory Local Verification Suite
Run this suite before declaring any task complete:
```bash
npm run format:check     # Prettier styling
npm run lint             # ESLint (0 errors, 0 warnings)
npm run typecheck        # Strict TypeScript (tsc --noEmit)
npm test                 # Fast in-memory unit tests (528+ tests)
npm run build            # Next.js production compilation
```
When Supabase is running locally:
```bash
npm run test:integration # PostgreSQL integration tests
```
*Note: Browser tests (`npm run test:e2e`) are required when modifying UI, navigation, or interaction workflows, but can be skipped for pure backend/domain changes.*

### 5.3 Review & PR Invariants
1. **One task per branch:** Feature branches only (`feature/...`, `fix/...`). Never commit directly to `main`.
2. **Never auto-merge:** Always pause after CI is green and request independent code review.
3. **Preserve invariants:** Zero test weakening, zero hardcoded Colorado defaults, zero credential leaks, strictly atomic database mutations.
