# Entity Resolution Architecture

This document describes the design, rules, and invariants governing entity resolution in Encore. It explains how raw, noisy data from multiple independent sources is transformed into clean, canonical artists, venues, and events.

---

## 1. Objectives & Core Invariants

The entity resolution pipeline solves the core live-music problem: **multiple sources report the same event with varying names, times, URLs, and levels of completeness.**

### Core Invariants

1. **Immutable Observations:** Raw ingest bodies (`raw_ingests`) and parsed candidate observations (`event_candidates`) are immutable. They record what a source claimed at a specific point in time and are never updated in place.
2. **Traceable Field-Level Provenance:** Every attribute on a canonical event is backed by discrete records in `event_field_evidence` linking to the exact `source_id`, `candidate_id`, and `raw_ingest_id`.
3. **Conservative Merging:** It is always safer to flag a candidate for manual review (`needs_review`) or keep events separate than to falsely merge two distinct concerts.
4. **Strong External IDs Trump Names:** External IDs from authoritative providers (Spotify, MusicBrainz, Ticketmaster) take absolute precedence over string name comparisons.
5. **Atomic Persistence:** Canonicalization mutations (venues, artists, events, links, evidence, resolutions) commit or roll back in a single atomic database transaction.

---

## 2. Pipeline Components

The pipeline is implemented under [`lib/entity-resolution/`](../../lib/entity-resolution/) and consists of five core components:

```
                  ┌──────────────────────┐
                  │ EventCandidate Input │
                  └──────────┬───────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   ┌─────────────────┐               ┌─────────────────┐
   │ ArtistResolver  │               │  VenueResolver  │
   └────────┬────────┘               └────────┬────────┘
            │                                 │
            └────────────────┬────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  EventMatcher   │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
       [Match Found]                 [No Match Found]
              │                             │
              ▼                             ▼
     ┌─────────────────┐           ┌─────────────────┐
     │   FieldMerge    │           │ Canonical Create│
     └────────┬────────┘           └────────┬────────┘
              │                             │
              └──────────────┬──────────────┘
                             │
                             ▼
           ┌───────────────────────────────────┐
           │   CanonicalizationCoordinator     │
           │  (mapEventUpdatesToCanonicalizationPayload) │
           └─────────────────┬─────────────────┘
                             │
                             ▼
           ┌───────────────────────────────────┐
           │ apply_canonicalization (Postgres) │
           └───────────────────────────────────┘
```

---

### 2.1 ArtistResolver

Located in [`lib/entity-resolution/artist-resolver.ts`](../../lib/entity-resolution/artist-resolver.ts).

Resolves candidate artists to canonical artists in the catalog:

1. **External ID Precedence:** Evaluates external IDs (e.g. `spotify:artist:<id>`) first.
   - If an incoming external ID matches an existing artist in `artist_external_ids`, that canonical artist is matched.
   - If the candidate carries an external ID that points to a different artist than a contextual hint (`disambiguatedArtistId`), or carries an external ID conflicting with the contextual artist's registered IDs, the resolver refuses to merge and returns `status: 'ambiguous'` with reason `conflicting_external_id_contextual_mismatch`.
2. **Name Normalization & Disambiguation:**
   - Names are normalized via `normalizeName()` (NFKC, lowercase, leading article stripping, punctuation removal).
   - If multiple canonical artists share a normalized name, the resolver flags `status: 'ambiguous'` with reason `ambiguous_artist_name_multiple_matches`.
   - Distinct artists sharing a common name (e.g. "Ghost" from Sweden vs. "Ghost" from Japan) are never coalesced.
3. **In-Memory Preparation:** Does not perform upfront database inserts. Unmatched artists are returned with a generated UUID for atomic batch insertion in `apply_canonicalization`.

---

### 2.2 VenueResolver

Located in [`lib/entity-resolution/venue-resolver.ts`](../../lib/entity-resolution/venue-resolver.ts).

Resolves candidate venues to canonical venues:

1. **Locality Requirement:** Venues must possess a non-empty `city`. Empty or whitespace-only city fields cause the coordinator to route the candidate to `needs_review` with reason `missing_venue_locality`.
2. **Lookup Strategy:** Queries by `(normalized_name, city)`.
3. **In-Memory Preparation:** Unmatched venues are prepared in memory with generated UUIDs and created atomically during canonicalization.

---

### 2.3 EventMatcher

Located in [`lib/entity-resolution/event-matcher.ts`](../../lib/entity-resolution/event-matcher.ts).

Evaluates whether an incoming candidate matches an existing canonical event using a multi-step conservative ladder:

- **Step 0: Upstream Source Event ID Match**  
  Queries `event_sources` for `(source_id, source_event_id)`. If an exact upstream ID was already canonicalized, this is an immediate high-confidence match (e.g. an updated crawl of the same Ticketmaster or venue event).
- **Step 1: Normalized Ticket URL Match**  
  Queries `event_ticket_links` for matching `normalized_url`. If identical ticketing URLs are present, candidates are linked.
- **Step 2: Temporal + Venue + Artist Match**  
  Evaluates candidates against events on the same `local_start_date` at the same `venue_id`:
  - **Canonical Artist ID Precedence:** If both candidate and existing event headliners carry resolved canonical artist IDs, differing IDs strictly prevent merging, even if display names match.
  - **Opening Artist Overlap Protection:** If two events on the same date and venue share an opening/supporting act but have different headliners, the matcher refuses to merge and routes to `needs_review` with reason `same_venue_and_date_opening_artist_overlap_requires_review`.

---

### 2.4 FieldMerge

Located in [`lib/entity-resolution/field-merge.ts`](../../lib/entity-resolution/field-merge.ts).

When a candidate matches an existing event, `evaluateFieldMerge` determines which fields should be updated:

1. **Confidence Hierarchy:** Fields from higher-confidence sources supersede lower-confidence sources.
2. **Rescheduling & Status Updates:** Changes in dates, `starts_at`, `doors_at`, or event status (`rescheduled`, `cancelled`, `postponed`) are evaluated and merged.
3. **Provenance Generation:** For every modified field, a discrete `event_field_evidence` observation row is generated. Historical evidence from prior observations is never deleted or overwritten.

---

### 2.5 CanonicalizationCoordinator & Stored Procedure

Located in [`lib/entity-resolution/canonicalization-coordinator.ts`](../../lib/entity-resolution/canonicalization-coordinator.ts).

The coordinator drives the pipeline and bridges the application domain layer with the database:

1. **Domain → RPC Snake-Case Mapper:**  
   `mapEventUpdatesToCanonicalizationPayload` converts camelCase domain updates (`localStartDate`, `startsAt`, `venueId`) into snake_case PostgreSQL JSON keys (`local_start_date`, `starts_at`, `venue_id`), preserving explicit nulls and omitting undefined properties.
2. **Initial Field-Level Evidence Emission:**  
   On new canonical event creation, the coordinator emits field evidence rows for all populated canonical attributes (`title`, `event_kind`, `status`, `venue`, `city`, `region`, `country_code`, `timezone`, `local_start_date`, `starts_at`, `start_time_precision`, `doors_at`, `primary_ticket_url`).
3. **Atomic PostgreSQL RPC:**  
   Calls `apply_canonicalization(payload jsonb)`, a `SECURITY DEFINER` function in PostgreSQL restricted strictly to `service_role`. The procedure atomically creates/updates venues, artists, events, ticket links, source links, evidence, and resolution status in a single transaction.

---

## 3. Database Constraints Protecting Identity Integrity

The database layer enforces structural invariants that application code cannot bypass:

1. **Composite Foreign Keys:**  
   `event_sources` and `event_field_evidence` reference `event_candidates(id, source_id, raw_ingest_id)` with `ON DELETE RESTRICT`. This guarantees that an evidence or source record cannot point to a candidate under a mismatched raw ingest observation.
2. **Upstream Source ID Uniqueness:**  
   Unique partial index on `event_sources(source_id, source_event_id) WHERE source_event_id IS NOT NULL` prevents the same upstream event from being reassigned to multiple canonical events (PostgreSQL error `23505`).
3. **Temporal Check Constraints:**  
   - `check_events_instant_starts_at`: Precision `'instant'` requires non-null `starts_at`.
   - `check_events_date_only_no_starts_at`: Precision `'date_only'` forbids non-null `starts_at`.
   - `check_events_local_date_order`: `local_end_date >= local_start_date`.
   - `check_events_instant_order`: `ends_at >= starts_at`.
   - `check_events_multi_day_consistency`: Multi-day events require `local_end_date > local_start_date`.

---

## 4. Where to Learn More

- Data model tables: [`architecture/data-model.md`](data-model.md)
- Ingestion pipeline: [`architecture/ingestion.md`](ingestion.md)
- Integration tests: [`tests/integration/golden-path.test.ts`](../../tests/integration/golden-path.test.ts)
- Historical phase verification: [`phases/completed/PHASE_1_IMPLEMENTATION.md`](../phases/completed/PHASE_1_IMPLEMENTATION.md)
