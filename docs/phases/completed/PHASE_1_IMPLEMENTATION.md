# Phase 1 — Canonical Inventory and Ingestion Foundation

## Status

Complete — independently reviewed and ready to merge. This document is the persistent implementation source of truth for
Phase 1, created after Phase 0 was reviewed and merged to `main`.

## Objective

Build the source-agnostic canonical inventory and ingestion foundation required
before Encore can safely depend on real event sources. An imported event must be
traceable from its canonical record through source observations, candidates, and
retained raw ingest evidence. The resulting catalog supports a basic event browser
but deliberately does not implement personalization.

## Architecture audit and context

Phase 0 supplies Next.js, TypeScript, Supabase local tooling, CI, a secure
`profiles` table with tested RLS, server-only admin-client protection, and
database-independent `RawIngest`, `EventCandidate`, provenance, and source-adapter
contracts. It supplies no inventory schema, persistence service, source registry,
or real integration. The current fake adapter is useful test scaffolding, but its
candidate shape is not yet a persistence contract: it lacks database identities,
temporal precision, resolution outcomes, and immutable evidence history.

Phase 1 intentionally ends before any real source is connected. Ticketmaster
Discovery moves to Phase 2 as the first live-source proof of this model, alongside
the Phase 2 personalization work. Phase 1 must prove the full path with
deterministic fixtures first. This planning task itself does not authorize code,
migrations, credentials, or live network calls.

## Scope

### In scope

- Canonical Artist, Venue, Promoter, Event, source registry, and event-relationship
  models.
- Raw-ingest storage, normalized event candidates, source/candidate/canonical
  links, merge decisions, and event field evidence.
- Correct event-local date, IANA-zone, date-only, instant, and multi-day-range
  representations.
- Repository abstractions for catalog persistence/read access, ingest storage, and
  candidate resolution; UI components must not own database query logic.
- Pure normalization, entity-resolution, and conservative deduplication functions
  invoked by server-side repository/use-case code. A general business-service
  layer is deferred until a later phase needs it.
- Deterministic fixtures and tests from raw ingest through canonical catalog.
- RLS policies, database tests, migrations, and CI changes required by the above.
- A minimal read-only, non-personalized Discover/catalog path if needed for the
  roadmap's basic event-browser outcome.

### Explicit exclusions

- Spotify, OAuth, user taste, affinities, recommendations, ranking, explanations,
  feedback, and user preferences.
- Direct venue/promoter/festival/ticketing/social adapters, scrapers, Cheerio,
  browser acquisition, scheduled jobs, queues, and crawler health dashboards.
- Price history, complete ticket-option/pass modeling, resale data, watches,
  alerts, notifications, maps, attendance history, and email ingestion.
- Festival days, stages, set times, lineup versions, and performance schedules;
  Phase 5 owns that model.
- Client-side inventory writes, auth/onboarding UI, and live source checks in PR CI.
- Live Ticketmaster ingestion, its API key, and every other real external source.
  Phase 2 will use Ticketmaster Discovery as the first real source proving this
  Phase 1 foundation.

## Architecture decisions

1. Canonical inventory is public catalog data; raw ingests, candidates, merge
   outcomes, field evidence, and source operational data are private operational
   data. Browser clients never write inventory.
2. Raw ingests and candidates are immutable observations. Corrections create new
   observations/evidence rather than erasing history. Canonical values change only
   through explicit, transactional field-merge rules.
3. Reprocessing is idempotent. A `(source_id, source_event_id)` identity is used
   where available; otherwise use a deterministic source URL/content identity.
   Never deduplicate by event title alone.
4. Store known instants as `timestamptz`, retain an IANA time zone, and persist
   local start/end dates. Validate time-zone identifiers in application code. A
   `date_only` precision explicitly supports events whose exact local time is not
   yet known; do not turn them into midnight instants.
5. Start conservative: exact IDs, same local date/venue, overlapping artists, and
   matching ticket URLs are strong signals. Ambiguous candidates remain
   `needs_review`; early false negatives are safer than false-positive merges.
6. Model multiple promoters/presenters and ticket links as relationships. A ticket
   provider is a `sources` record, avoiding a duplicate provider directory.
7. Festival support is limited to `event_kind`, date range, and `is_multi_day`.
   Do not add event-day or performance tables in Phase 1.
8. Domain types and repository ports are distinct from Supabase row types. All
   persistence adapters are server-only. Server-rendered routes/handlers call
   repositories and return DTOs; UI components never own database query logic.
   General business services may be introduced above repositories in a later phase.
9. Store small raw API/HTML payloads directly in Postgres now. Each raw ingest also
   has an optional external blob/storage reference so large payloads can move to
   object storage later without a schema redesign.
10. Colorado is the initial coverage and testing geography. It informs fixtures
    and early source validation only; no schema, resolver, or API rule may assume
    Colorado-specific geography.
11. URL normalization is conservative and deterministic: normalize scheme/host
    casing, remove default ports and trailing slashes, remove fragments, and remove
    only `utm_*`, `gclid`, and `fbclid`. Preserve every unknown query parameter.
12. Candidate resolutions store status, confidence, matcher version, reasons, and
    provenance in Phase 1. Human/manual resolution workflow and UI are deferred to
    a later operational/admin phase.

## Database schema

Use UUID primary keys with `gen_random_uuid()`. Mutable canonical tables receive
`created_at` and `updated_at`. Use `numeric(12,2)` for money and ISO-4217
three-character currency codes. Use named `CHECK` constraints instead of Postgres
enums so classifications can evolve through ordinary migrations.

### Source and observation tables

| Table | Required fields and purpose |
| --- | --- |
| `sources` | `id`, unique stable `slug`, `name`, `source_type`, `acquisition_method`, `base_url`, `reliability_score`, `active`, `parser_version`, optional health timestamps/counters. |
| `raw_ingests` | `id`, `source_id`, `source_url`, `fetched_at`, `content_hash`, `content_type`, `http_status`, `parser_version`, `acquisition_method`, optional conditional-request metadata, `raw_content` for small payloads, and nullable `external_storage_ref` for a future blob/object-store payload. New Phase 1 records store small API/HTML payloads directly in the database. |
| `event_candidates` | `id`, `raw_ingest_id`, `source_id`, nullable `source_event_id`, original source strings, source-local temporal fields, normalized candidate payload, confidence, verification status, parser version, and timestamps. |

Index raw ingests by source/fetch time and content hash, and index non-null
`(source_id, source_event_id)`. Enforce source consistency between candidate and
raw ingest in service code and, where practical, with a composite foreign key.

## Final Phase 1 Invariant Matrix

| Invariant | Authoritative Requirement | Relevant Implementation Files | Database Enforcement | Application Enforcement | Unit Test Proving It | Integration Test Proving It | Current Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Canonical IDs** | All database-backed entities use valid standards-compliant UUID identities. Never use arbitrary string IDs (e.g. `ven_*`, `art_*`, `cand_*`) for UUID columns. | `lib/domain/catalog.ts`, `lib/repositories/memory-repositories.ts`, `lib/entity-resolution/artist-resolver.ts`, `lib/entity-resolution/venue-resolver.ts`, `lib/entity-resolution/canonicalization-coordinator.ts`, `supabase/migrations/20261005120000_create_inventory_reference_and_catalog.sql`, `supabase/migrations/20261005120001_create_ingest_provenance.sql` | Primary and foreign keys typed as `UUID DEFAULT gen_random_uuid()`. Non-UUID strings rejected by PostgreSQL. | Universal `crypto.randomUUID()` generation across repositories, resolvers, and coordinator. | `canonicalization-coordinator.test.ts` (verifies all generated IDs match RFC 4122 v4 UUID format). | `catalog-rls.test.ts`, `golden-path.test.ts` (verifies UUID storage and retrieval via Supabase client). | Converged |
| **Raw-ingest Immutability** | Existing raw observations are immutable and never overwritten. Re-observations with identical content reuse the record; changed content inserts a new immutable raw ingest. Distinct URLs on same content remain distinct. | `lib/repositories/raw-ingest-repository.ts`, `lib/repositories/memory-repositories.ts`, `supabase/migrations/20261005120001_create_ingest_provenance.sql` | `raw_ingests` has compound unique constraint `(source_id, source_url, content_hash)` and no update trigger. | `getBySourceUrlAndContentHash` lookups return existing rows; updates are forbidden. | `canonicalization-coordinator.test.ts` (proves raw ingests are never mutated). | `catalog-rls.test.ts`, `golden-path.test.ts` (proves identical hash reuses record without mutation, URL separation). | Converged |
| **Candidate Immutability** | Existing candidate observations are never overwritten. A subsequent observation of the same upstream event creates a new immutable candidate observation. Multi-event crawls create distinct candidates. | `lib/repositories/event-candidate-repository.ts`, `lib/repositories/memory-repositories.ts`, `supabase/migrations/20261005120001_create_ingest_provenance.sql` | `event_candidates` uniqueness is constrained to `(raw_ingest_id, source_event_id)` and `(raw_ingest_id, candidate_fingerprint)` within raw observation, NOT globally per `source_id`. | Removed `.update()` from candidate repository. Re-observations create distinct candidate rows. | `canonicalization-coordinator.test.ts` (proves multiple candidate rows exist for same `source_event_id` across different raw ingests; multi-candidate page isolation). | `catalog-rls.test.ts`, `golden-path.test.ts` (persists multiple candidates with same `source_event_id` under different `raw_ingest_id`s; verifies both persist). | Converged |
| **Stable Source Identity** | `(source_id, source_event_id)` represents the upstream source's stable event identity and maps to at most ONE canonical event. Reassignment across events is forbidden. | `supabase/migrations/20261005120001_create_ingest_provenance.sql`, `lib/entity-resolution/event-matcher.ts`, `lib/repositories/catalog-repository.ts` | Partial unique index on `event_sources (source_id, source_event_id) WHERE source_event_id IS NOT NULL` without `event_id`. `apply_canonicalization` checks existing assignment and rejects reassignment with code 23505. | `EventMatcher` Step 0 resolves upstream identity via `findEventBySourceEventId`. | `entity-resolution.test.ts` (Step 0 source event match). `canonicalization-coordinator.test.ts` (rejects mapping upstream ID to second event). | `catalog-rls.test.ts`, `golden-path.test.ts` (attempts to map same `(source_id, source_event_id)` to a second canonical event, proving DB rejects with unique violation 23505). | Converged |
| **Replay** | Reprocessing observations does not duplicate the canonical event. | `lib/entity-resolution/event-matcher.ts`, `lib/entity-resolution/canonicalization-coordinator.ts`, `lib/repositories/catalog-repository.ts` | Unique index on `event_sources(source_id, source_event_id)`. | `EventMatcher` Step 0 matches existing canonical event with 1.0 confidence. | `canonicalization-coordinator.test.ts` (replaying same candidate does not increment canonical event count). | `catalog-rls.test.ts`, `golden-path.test.ts` (re-canonicalizing existing source event maintains single canonical event). | Converged |
| **Updates** | Changed upstream date/time/status/reschedule re-evaluates and updates the same canonical event via explicit merge rules; evidence recorded for both observations. | `lib/entity-resolution/field-merge.ts`, `lib/entity-resolution/canonicalization-coordinator.ts`, `supabase/migrations/20261005120001_create_ingest_provenance.sql` | `apply_canonicalization` updates canonical event fields and inserts new rows in `event_field_evidence`. | `evaluateFieldMerge` updates `startsAt`, `localStartDate`, `status`, etc., and records distinct field evidence. | `canonicalization-coordinator.test.ts` (proves Friday 8 PM show updated to Saturday 9 PM with two evidence rows). | `catalog-rls.test.ts`, `golden-path.test.ts` (executes with updated date and verifies event updated with multiple field evidence rows without overwriting prior evidence). | Converged |
| **Atomicity** | One canonicalization operation either fully commits (venue, artist, event, relations, evidence, resolution) or fully rolls back; zero upfront entity writes. | `lib/entity-resolution/canonicalization-coordinator.ts`, `lib/entity-resolution/venue-resolver.ts`, `lib/entity-resolution/artist-resolver.ts`, `supabase/migrations/20261005120001_create_ingest_provenance.sql` | Stored procedure `apply_canonicalization` executes all writes in a single atomic PostgreSQL transaction. | `resolveOrPrepare` in resolvers prepares entities in-memory without upfront DB writes; coordinator passes single payload. | `canonicalization-coordinator.test.ts` (forcing persistence error verifies zero orphaned venues, artists, or events in memory repo). | `catalog-rls.test.ts`, `golden-path.test.ts` (triggering resolution FK error in `apply_canonicalization` verifies zero orphaned venues, artists, or events in Supabase). | Converged |
| **Artist Identity** | Normalized names are match aids, not universal identity keys. Candidate artists carry name, billing position, and optional strong external IDs in `candidate_artists` jsonb. Resolved canonical artist IDs take absolute precedence in `EventMatcher` (differing IDs never merge). Ambiguous names route to `needs_review`. | `lib/domain/event-candidate.ts`, `lib/entity-resolution/artist-resolver.ts`, `lib/entity-resolution/event-matcher.ts`, `lib/entity-resolution/canonicalization-coordinator.ts` | Unique constraint on `artist_external_ids (provider, external_id)`. `event_candidates.candidate_artists` jsonb column preserves external IDs. | `ArtistResolver` matches on external ID; detects ambiguity when multiple artists share a name or when a candidate with an existing name lacks external ID disambiguation; `EventMatcher` forbids merging when canonical artist IDs disagree; routes to `needs_review`. | `entity-resolution.test.ts` (multiple artists with same name or name-only candidate for existing artist routes to `ambiguous`; same-name artists with differing external IDs never merge). | `catalog-rls.test.ts`, `golden-path.test.ts` (persists candidate with artist external IDs, loads from DB, canonicalizes, verifies `artist_external_ids` row created, verifies distinct external IDs route to `needs_review`). | Converged |
| **Venue Identity** | Venue matching considers name, city, region, and country to avoid unsafe global merges. Missing essential city information routes to `needs_review` (`missing_venue_locality`); zero empty-string venues created. | `lib/entity-resolution/venue-resolver.ts`, `lib/entity-resolution/canonicalization-coordinator.ts` | Indexes on `venues (city, region)` and `normalized_name`. | `VenueResolver` requires non-empty city; routes to `needs_review` if essential location is missing; throws on empty string. | `entity-resolution.test.ts` (The Fillmore SF vs The Fillmore Detroit do not merge). `canonicalization-coordinator.test.ts` (empty city routes to `needs_review`). | `catalog-rls.test.ts`, `golden-path.test.ts` (verifies separate venues created for same name in different regions). | Converged |
| **Provenance** | Every canonical fact is traceable to its actual source, raw ingest observation, and candidate. Exact composite foreign key `(candidate_id, source_id, raw_ingest_id) REFERENCES event_candidates(id, source_id, raw_ingest_id)` enforces observation alignment on `event_sources` and `event_field_evidence`. Emits full field-level evidence on initial creation. | `supabase/migrations/20261005120001_create_ingest_provenance.sql`, `lib/entity-resolution/canonicalization-coordinator.ts` | Composite FK `(candidate_id, source_id, raw_ingest_id) REFERENCES event_candidates(id, source_id, raw_ingest_id)` on `event_sources` and `event_field_evidence`. | Coordinator emits evidence for every created or updated field (title, venue, dates, status, etc.) with observation timestamp, parser version, and raw ingest link, plus general creation marker. | `canonicalization-coordinator.test.ts` (verifies initial field evidence for all populated attributes). | `catalog-rls.test.ts`, `golden-path.test.ts` (verifies composite FK rejects cross-raw candidate linking with code 23503, verifies >=10 field evidence rows in Supabase). | Converged |
| **Source Consistency** | Candidate, raw ingest, and evidence relationships cannot cross sources incorrectly. `event_candidates.raw_ingest_id` is NOT NULL. Candidates entering canonicalization require valid UUID `id`, `rawIngestId`, and `sourceId`. | `supabase/migrations/20261005120001_create_ingest_provenance.sql`, `lib/domain/event-candidate.ts`, `lib/entity-resolution/canonicalization-coordinator.ts` | Composite foreign key `(raw_ingest_id, source_id) REFERENCES raw_ingests(id, source_id)` on `event_candidates` and `event_sources`. `raw_ingest_id` is `NOT NULL`. | Coordinator rejects unpersisted candidates without valid UUID `id`, `rawIngestId`, or `sourceId`. | `canonicalization-coordinator.test.ts` (rejects candidate missing UUID id). `server-boundary.test.ts`. | `catalog-rls.test.ts` (verifies database rejects cross-source candidate linking via constraint `fk_event_candidates_raw_ingest_source`). | Converged |
| **Event Kinds** | All 8 Phase 1 event kinds (`concert`, `club_show`, `outdoor_show`, `free_event`, `music_series`, `residency`, `festival`, `multi_day_festival`) travel through real ingestion and canonicalization. | `lib/domain/catalog.ts`, `lib/domain/event-candidate.ts`, `lib/entity-resolution/canonicalization-coordinator.ts`, `supabase/migrations/20261005120000_create_inventory_reference_and_catalog.sql` | Check constraint on `events.event_kind` and `event_candidates.event_kind` allowing all 8 kinds. | `EventCandidate` carries `eventKind?: EventKind`; coordinator preserves it instead of reducing to only concert/festival. | `canonicalization-coordinator.test.ts` (tests non-concert event kinds like `club_show`, `free_event`, `music_series`, `residency`). | `catalog-rls.test.ts`, `golden-path.test.ts` (proves non-concert event kinds persist and validate). | Converged |
| **Time Semantics** | UTC instants, local calendar dates, IANA time zones, date-only precision, and multi-day ranges stay consistent. Persisted date-only candidates default cleanly to `startTimePrecision = 'date_only'` without fabricating midnight timestamps. | `lib/domain/value-objects.ts`, `lib/domain/catalog.ts`, `lib/repositories/event-candidate-repository.ts`, `supabase/migrations/20261005120000_create_inventory_reference_and_catalog.sql` | Temporal check constraints: `check_events_instant_starts_at`, `check_events_date_only_no_starts_at`, `check_events_local_date_order`, `check_events_instant_order`, `check_events_multi_day_consistency`. | `deriveLocalDateFromInstant`, `validateIanaTimezone`, candidate repo derives `date_only` when `startsAt` is absent, coordinator rejects missing/invalid timezones with `needs_review`. | `canonicalization-coordinator.test.ts` and `value-objects.test.ts` (UTC rollover, timezone validation, date-only derivation). | `catalog-rls.test.ts`, `golden-path.test.ts` (violating temporal constraints rejected by database; step 6 tests date-only persistence and canonicalization without fabricated starts_at). | Converged |
| **Geography** | Unknown geography remains unknown; no fabricated Colorado or US defaults in schema, resolvers, or UI. | `supabase/migrations/20261005120000_create_inventory_reference_and_catalog.sql`, `lib/repositories/catalog-repository.ts`, `lib/entity-resolution/canonicalization-coordinator.ts` | No `DEFAULT 'US'` on `venues.country_code` or `events.country_code`. | Country and city default to null/unknown if not in candidate; non-Colorado events preserve actual geography. | `canonicalization-coordinator.test.ts` (Austin TX, London GB shows preserve exact country, region, timezone). | `catalog-rls.test.ts`, `golden-path.test.ts` (inserts event with null country_code; verifies DB stores null). | Converged |
| **RLS / Security** | Browser / anonymous / normal authenticated clients cannot write canonical or operational inventory, or execute privileged RPCs (`apply_canonicalization`). | `supabase/migrations/20261005120001_create_ingest_provenance.sql`, `supabase/migrations/20261005120002_secure_inventory_tables.sql` | RLS enabled on all catalog and operational tables. `apply_canonicalization` is `SECURITY DEFINER`, search_path set, revoked from `PUBLIC`/`anon`/`authenticated`, granted strictly to `service_role`. | Server-only repository boundary (`import 'server-only'`). | `server-boundary.test.ts`. | `catalog-rls.test.ts` (anon write rejected, anon RPC rejected with 42501, authenticated user RPC rejected with 42501). | Converged |
| **Ticket Identity** | Normalized ticket identity is separate from original audit URL; tracking parameters stripped in normalized URL while original URL is retained. | `lib/domain/value-objects.ts`, `lib/domain/catalog.ts`, `supabase/migrations/20261005120000_create_inventory_reference_and_catalog.sql` | `event_ticket_links` stores both `url` (original) and `normalized_url`, with unique constraint on `(event_id, normalized_url)`. Money columns are `numeric(12,2)`. | `normalizeUrl` strips tracking params; `findEventByTicketUrl` searches `normalized_url`. | `entity-resolution.test.ts` (dirty tracking params match exact normalized ticket URL). | `catalog-rls.test.ts`, `golden-path.test.ts` (stores original and normalized ticket URL in Supabase). | Converged |

### Candidate Identity and Replay Model

Phase 1 strictly establishes an explicit 4-part identity and replay model across raw observations, candidate extraction, and canonicalization:

1. **Case 1: Same Raw Observation + Same Extracted Event**:
   - Replaying extraction on the exact same raw observation (`raw_ingest_id`) with the same upstream identity (`source_event_id` or normalized `candidate_fingerprint`) does NOT produce a duplicate candidate row. The candidate repository deduplicates within the raw ingest and returns the existing candidate row.
2. **Case 2: Same Raw Observation + Multiple Extracted Events (Multi-Event Page Extraction)**:
   - When a crawler ingests a listing or calendar page with multiple events, all candidates share the same `raw_ingest_id` and raw payload `content_hash`. Candidates are differentiated by `source_event_id` or candidate fingerprint. They receive distinct UUIDs and persist as separate rows without colliding on raw ingest hashes.
3. **Case 3: Subsequent Crawl / New Raw Observation + Same Upstream Event**:
   - When a subsequent crawl re-observes an existing event (e.g., daily crawl detecting rescheduled date/time or updated price), a new `raw_ingests` record is created (with a new `raw_ingest_id` and `content_hash`). A new immutable `event_candidates` record is created with a new UUID and the new `raw_ingest_id`. Prior candidate rows remain completely untouched as an unalterable historical record of prior observations.
4. **Case 4: Canonicalization Matching & Evidence Accumulation**:
   - Passing the new candidate observation into `CanonicalizationCoordinator.canonicalize()` triggers Step 0 in `EventMatcher` (`findEventBySourceEventId`). It resolves to the existing canonical event with 1.0 confidence, applies transactional field updates (e.g. rescheduling from Friday to Saturday), updates `last_seen_at` on `event_sources`, and appends new observations to `event_field_evidence`. Exactly 1 canonical event exists throughout, and historical field evidence is strictly preserved without deleting prior evidence rows. Upstream identities cannot be reassigned across different canonical events (enforced via unique index and code 23505).

### Canonical catalog tables

| Table | Required fields and purpose |
| --- | --- |
| `artists` | `id`, `name`, `normalized_name`, nullable image URL, timestamps. Normalized name is a match aid, never a universal identity key. |
| `artist_external_ids` | `id`, `artist_id`, `provider`, `external_id`, optional provider URL; unique `(provider, external_id)`. Supports Ticketmaster, Spotify, MusicBrainz, and later providers without provider-specific columns. |
| `venues` | `id`, name/normalized name, city, nullable region, country code, nullable coordinates, nullable IANA zone, website, capacity and venue attributes when known. Do not globally unique a venue name. |
| `promoters` | `id`, name/normalized name, nullable website/calendar URLs, timestamps. |
| `events` | `id`, name/normalized name, `event_kind`, `status`, nullable `venue_id`, event-level locality/coordinates, IANA `timezone`, `local_start_date`, nullable `local_end_date`, nullable `starts_at`/`ends_at`, `start_time_precision`, optional doors instant, `is_multi_day`, official and primary-ticket URLs, announced timestamp, timestamps. |

An event requires a local start date and an IANA zone. `starts_at`/`ends_at` are
`timestamptz` when known. Constraints must require `starts_at` for `instant`
precision, forbid it for `date_only`, prevent an end date before its start date,
and require `is_multi_day` when the local end date is later than the start date.
Validate IANA names in application code with a tested runtime/library capability;
do not accept abbreviations such as `MST`.

Initial kinds: `concert`, `club_show`, `outdoor_show`, `free_event`,
`music_series`, `residency`, `festival`, `multi_day_festival`. Initial statuses:
`scheduled`, `cancelled`, `postponed`, `rescheduled`, `unknown`.

### Relationships, provenance, and resolution audit

| Table | Required fields and purpose |
| --- | --- |
| `event_artists` | `event_id`, `artist_id`, billing position, display/order fields, timestamps; unique event/artist. It expresses ordinary-event billing, not festival set scheduling. |
| `event_promoters` | `event_id`, `promoter_id`, `relationship_type` (`promoter`, `presenter`, `producer`, `unknown`), timestamps. |
| `event_ticket_links` | `id`, `event_id`, `ticket_provider_source_id`, URL, optional advertised min/max price/currency, inventory status, verification time, timestamps. This is not ticket-tier or price-history modeling. |
| `event_sources` | `id`, `event_id`, `source_id`, nullable candidate/raw-ingest/source-event references, source URL, confidence, first/last seen, current-support flag. It supplies the required canonical-event provenance trail. |
| `event_field_evidence` | `id`, `event_id`, field name, `event_source_id`, observed value JSON, value hash, confidence, observation time, parser version. It preserves why a canonical field has its value. |
| `candidate_resolutions` | `id`, `event_candidate_id`, nullable `event_id`, status (`created`, `matched`, `needs_review`, `rejected`), matcher version, confidence, structured reasons, timestamp. |

Canonicalization must leave artist and venue origin traceable through the candidate
and event-source chain. Do not introduce an unconstrained polymorphic source-link
table merely to provide generic field provenance; use explicit entity evidence
tables later if artist/venue field-level provenance becomes a concrete need.

### Integrity, indexes, and retention rules

- Index normalized artist/venue lookups, venue locality, event local date and
  instant, status/kind, event-artist links, and all foreign keys.
- Use partial uniqueness for external source IDs only when non-null.
- Preserve the original sanitized URL for audit. Normalize casing/default ports/
  trailing slashes, remove fragments and only `utm_*`, `gclid`, and `fbclid`; keep
  all unknown provider-specific query parameters.
- Do not cascade-delete canonical catalog records when a source, raw ingest, or
  adapter fails. Source deactivation and parser failure cannot erase events.
- Store small payloads in Postgres in Phase 1. `external_storage_ref` is nullable
  now and reserved for later object storage; retention duration and the exact size
  threshold remain operational follow-up decisions.

## RLS and security

- Enable RLS on every Phase 1 `public` table.
- Catalog reads use server-mediated DTOs backed by repositories; UI components do
  not query Supabase directly. Do not add client catalog write policies.
- `raw_ingests`, `event_candidates`, `candidate_resolutions`,
  `event_field_evidence`, and source health have RLS enabled with no public
  policy; only trusted server/worker service-role operations access them.
- Preserve Phase 0 `profiles` policies unchanged and do not join private user data
  into catalog responses.
- Do not add `TICKETMASTER_API_KEY` in Phase 1. Phase 2 adds it as a server-only,
  lazily validated variable when the Ticketmaster adapter is implemented.

## Services, interfaces, and module boundaries

Keep database adapters server-only and domain types independent of database rows:

```text
lib/
  domain/                 artist, venue, event, ingest, source contracts
  catalog/                catalog repository and server-facing catalog queries
  ingestion/              source/raw-ingest/candidate repositories, normalizer
  entity-resolution/      artist resolver, venue resolver, event matcher,
                          canonicalization coordinator
  supabase/               Phase 0 factories plus server-only persistence adapters
```

Implement `SourceRepository`, `RawIngestRepository`, `EventCandidateRepository`,
and `CatalogRepository`. A narrow, transaction-capable canonicalization coordinator
may compose these repositories, but Phase 1 does not add a general business-service
layer. Unit
tests must exercise normalization, candidate identity, match scoring, duplicate
decisions, and merge-rule selection without Supabase. Canonicalization is atomic:
it creates or links entities, event relationships, source links, evidence, and the
resolution record together, or creates none. Replaying a candidate links existing
records rather than duplicating them.

## Implementation checklist

1. Re-read the active specification and update `AI_HANDOFF.md` with one assigned
   implementing owner and branch before code changes.
2. Reconcile the Phase 0 domain contracts with persistence needs. Preserve
   compatibility where sensible; any removal of premature candidate-performance
   fields requires updated tests and a documented rationale.
3. Add tested value objects/validation for names, source identity, safe URLs,
   money, IANA zones, local date ranges, and time precision.
4. Add the migration sequence below with constraints, foreign keys, indexes, RLS,
   and comments marking festival data as deferred.
5. Implement server-only repositories, immutable raw/candidate persistence, and
   deterministic idempotency. Keep database access out of UI components.
6. Implement artist/venue resolution, conservative event matching, explicit field
   merge rules, and transactional canonicalization with an audit trail.
7. Add fixture-only raw-to-catalog integration coverage, idempotent replay, and an
   ambiguous case that does not merge.
8. Add a minimal read-only catalog query and, only if needed for the roadmapped
   browser, a basic Discover route/card. Show event/date-or-date-only/venue or
   locality/price when known/ticket availability/source attribution—not scores.
9. Update CI, fixtures, handoff, and this document for approved deviations before
    review.

## Migrations

Add forward-only migrations after `20261002000000_create_profiles.sql`, using real
unique timestamps at implementation time:

1. `*_create_inventory_reference_and_catalog.sql`: enable `pgcrypto` if needed;
   create sources, canonical entities, relationships, constraints, and indexes.
2. `*_create_ingest_provenance.sql`: create raw ingests, candidates, source links,
   field evidence, and resolution records with replay-safe indexes.
3. `*_secure_inventory_tables.sql`: enable RLS for all Phase 1 tables, add only
   selected catalog-read policies, and leave operational tables policy-free.

`npm run db:reset` must apply all migrations to an empty local database. Never
link, reset, or alter a production Supabase project during Phase 1 validation.
Corrections use forward migrations that preserve raw evidence and canonical data.

## Fixtures, tests, and CI

### Required fixtures

- A single show, a date-only event, an event near a DST boundary, a two-day
  residency, optional price absence, venue alias, and multiple ticket links.
- Two sources for one obvious event and two similar but different consecutive-night
  events.
- A cancellation/reschedule observation that creates new evidence without deleting
  the canonical event.
- Sanitized data only: no credentials, cookies, presale codes, user data, or live
  HTTP.

### Unit tests

- source/candidate contract compatibility; validation of names, URLs, money, and
  IANA zones; date-only and DST-safe temporal conversion;
- deterministic raw/candidate identity; artist/venue matching; conservative event
  duplicate behavior; explicit merge precedence; server-only write boundaries.

### Database integration tests

- migrations, constraints, foreign keys, and uniqueness reset cleanly;
- repository/coordinator fixture ingestion creates a complete transactional pipeline;
- replay is idempotent and a candidate cannot link to another source's raw ingest;
- selected catalog visibility works; public clients cannot write catalog data or
  read raw/candidate/resolution/evidence data;
- existing profile RLS tests remain green.

### CI requirements

Retain the Phase 0 sequence: format, lint, pre-build typecheck, offline unit tests,
build, post-build typecheck, browser test, Supabase start/reset, integration tests,
and always-run shutdown. Keep `npm test` infrastructure-free and integration tests
under `npm run test:integration`. Do not add live Ticketmaster tests to PR CI.

## Dependencies and environment

Prefer existing Zod, Supabase, and Vitest dependencies. Add no ORM, queue,
scraper, Spotify SDK, or browser-automation dependency. No migration needs an
environment variable. Ticketmaster configuration is deferred to Phase 2; all
Phase 1 fixture tests/builds work without external credentials.

## Completion commands

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run typecheck
npm run test:e2e
npm run db:start
npm run db:reset
npm run test:integration
npm run db:stop
```

Docker-compatible local Supabase is required for the final three database commands;
PR CI must run the equivalent database validation. Live-source checks, if added,
are manual/scheduled only.

## Definition of done

- Reproducible, constrained, RLS-protected canonical inventory and ingest schema
  exists on top of Phase 0.
- Deterministic raw data becomes a single traceable canonical catalog record with
  source links, evidence, and a resolution audit.
- Reprocessing is idempotent; ambiguity does not force a merge; source failure or
  deactivation cannot delete canonical events.
- Local dates, instants, IANA zones, date-only precision, and multi-day ranges are
  correct without fabricated times.
- Only generic multi-day/festival foundations exist; detailed festival performance
  work remains Phase 5.
- Browser clients cannot write inventory or access raw operational data, and Phase
  0 profile RLS remains secure.
- Required local/CI validation passes without secrets or live network access. Phase
  1 contains no real source adapter; Phase 2's Ticketmaster adapter must use this
  common pipeline.
- The phase spec and handoff accurately record implementation ownership, results,
  test evidence, deviations, and remaining work.

## Risks and unresolved questions

1. Decide raw-ingest retention duration, exact small-payload size threshold,
   object-storage provider, and deletion procedure before high-volume ingestion.
2. A future operator process and UI are needed for aliases and `needs_review`
   matches; candidate-resolution evidence exists now, but manual resolution is
   not Phase 1 work.

## Approved deviations

None. Record an approved deviation here before implementing it, including its
rationale, affected tests, and any required update to `docs/12-decisions.md` (now `docs/decisions/index.md`) or
the roadmap.

---

## Phase 1 Architecture Review Remediation

Following the initial Phase 1 implementation, an independent architecture and code review was conducted. The following findings were resolved in the remediation pass:

### Review Findings and Resolutions

1. **Phase 1 Database Migrations Fully Implemented (Must Fix)**
   - *Problem*: Migrations were committed empty due to an authoring oversight.
   - *Resolution*: Implemented all three migrations with full schemas, primary keys, foreign keys, constraints, indexes, RLS policies, and triggers:
     - `supabase/migrations/20261005120000_create_inventory_reference_and_catalog.sql`: `sources`, `public_sources` view, `artists`, `artist_external_ids`, `artist_aliases`, `venues`, `venue_aliases`, `promoters`, `events`, `event_artists`, `event_promoters`, `event_ticket_links`.
     - `supabase/migrations/20261005120001_create_ingest_provenance.sql`: `raw_ingests`, `event_candidates`, `event_sources`, `event_field_evidence`, `candidate_resolutions`, and the `apply_canonicalization` PL/pgSQL atomic transaction function.
     - `supabase/migrations/20261005120002_secure_inventory_tables.sql`: Enabled RLS on all 16 tables. Configured public read-only access on catalog tables, safe public view `public_sources`, and private service-role-only access on all operational ingestion tables.

2. **Atomic Canonicalization Transaction (Must Fix)**
   - *Problem*: Canonicalization previously performed multiple independent writes in application code, which could leave orphaned records on failure.
   - *Resolution*: Canonicalization now executes inside a true atomic database transaction:
     - Implemented PostgreSQL function `apply_canonicalization(payload jsonb)` in `supabase/migrations/20261005120001_create_ingest_provenance.sql`.
     - `SupabaseCatalogRepository.applyCanonicalization` invokes this RPC within a single atomic PostgreSQL transaction.
     - `MemoryCatalogRepository.applyCanonicalization` snapshots state and automatically rolls back all Maps upon any thrown error.
     - Added unit tests in `canonicalization-coordinator.test.ts` and integration tests in `catalog-rls.test.ts` verifying that intentional partial failures leave zero partial records.

3. **Removed Hard-coded Colorado Defaults (Must Fix)**
   - *Problem*: Missing timezone or geography risked fabricating Denver, CO, or America/Denver.
   - *Resolution*: Removed any fallback to Colorado defaults:
     - If candidate or venue timezone is missing or invalid, the candidate is routed to `needs_review` with reason `missing_or_invalid_timezone`.
     - Preserves actual geography (e.g. Austin, TX; London, GB) and timezones (`America/Chicago`, `Europe/London`).
     - Added test cases verifying non-Colorado events preserve their exact geography and timezone.

4. **Correct UTC-to-Local Date Derivation (Must Fix)**
   - *Problem*: Substring on UTC timestamps (`startsAt.substring(0, 10)`) caused date errors when UTC rolled past midnight while local time was still on the prior calendar date.
   - *Resolution*: Created `deriveLocalDateFromInstant(instantIso, timeZone)` in `lib/domain/value-objects.ts` using `Intl.DateTimeFormat('en-CA', { timeZone })`.
   - Added unit test proving `2026-10-15T02:00:00Z` in `America/Denver` (UTC-6) correctly resolves to local calendar date `2026-10-14`.

5. **Preserved Real Source Provenance (Must Fix)**
   - *Problem*: `event-candidate-repository.ts` reconstructed fake provenance with hardcoded `sourceType`, `acquisitionMethod`, and empty `contentHash`.
   - *Resolution*: Stored `source_type`, `acquisition_method`, `source_url`, `content_hash`, and `fetched_at` directly in `event_candidates` (and joined with `raw_ingests` / `sources`), reconstructing the exact, unmodified provenance on retrieval.
   - Added round-trip tests for API, structured JSON, and HTML candidates.

6. **Conservative Artist & Event Matching (Must Fix)**
   - *Problem*: Same-date/same-venue shows sharing any artist were auto-merged, causing false-positive merges for different concerts sharing an opening act.
   - *Resolution*: Updated `EventMatcher`:
     - Matches only when primary/headline artist matches or all artists match.
     - When two shows at the same venue and date share only an opening/supporting artist, the candidate is routed to `needs_review` with reason `same_venue_and_date_opening_artist_overlap_requires_review`.
     - Added regression tests in `entity-resolution.test.ts`.

7. **Consistent Normalized Ticket URL Matching (Must Fix)**
   - *Problem*: URLs were normalized for candidate creation but not consistently matched or indexed in the database.
   - *Resolution*: Persisted both `url` (original) and `normalized_url` (cleaned with tracking params stripped) in `event_ticket_links`.
   - Indexed `normalized_url` and updated `findEventByTicketUrl` to match on `normalized_url`.

8. **Correct Ticket Provider Attribution (Should Fix)**
   - *Problem*: `ticketProviderSourceId` was automatically set to `candidate.sourceId`, conflating venue/promoter sources with ticket sellers.
   - *Resolution*: `ticketProviderSourceId` is set only when the source is explicitly a ticketing provider (`ticketing` or `primary_ticketing`); otherwise it remains `null`.

9. **Per-Observation Evidence Traceability (Should Fix)**
   - *Problem*: Subsequent observations of the same event by a source risked losing provenance to earlier observations.
   - *Resolution*: Every observation writes an independent record to `event_field_evidence` carrying the exact `raw_ingest_id`, `candidate_id`, and `source_id` of that observation.

10. **Direct Access to Sources Table Restricted (Should Fix)**
    - *Problem*: `sources` table RLS could expose internal operational health and retry counters to public clients.
    - *Resolution*: Restricted `sources` table RLS exclusively to `service_role`. Created safe public view `public_sources` exposing only safe catalog attributes (`id`, `name`, `slug`, `source_type`, `base_url`, `active`) with SELECT access granted to `anon` and `authenticated`.

11. **ArtistId Catalog Filtering Implemented (Should Fix)**
    - *Problem*: `EventListFilters.artistId` was present in the interface but silently ignored in repository queries.
    - *Resolution*: Implemented `artistId` filtering across `SupabaseCatalogRepository` and `MemoryCatalogRepository` by querying `event_artists`. Added unit tests.

12. **ISO Currency Formatting (Low-Cost Cleanup)**
    - *Problem*: Prices displayed with hardcoded `$`.
    - *Resolution*: Created `formatCurrencyAmount(amount, currency, locale)` using `Intl.NumberFormat`. Updated `EventCard.tsx` and added test cases for USD, EUR, and GBP.

13. **Removed Empty Placeholder Directories (Low-Cost Cleanup)**
    - *Problem*: Empty placeholder folders `lib/catalog` and `lib/ingestion` existed without code.
    - *Resolution*: Removed `lib/catalog` and `lib/ingestion`. Maintained clean module boundaries in `lib/domain/index.ts`, `lib/repositories/index.ts`, and `lib/entity-resolution/index.ts`.

14. **Security Hardening of apply_canonicalization (Final Remediation)**
    - *Problem*: `apply_canonicalization` RPC was SECURITY DEFINER but retained default execute permissions for PUBLIC, anon, and authenticated users, and lacked an explicit search path.
    - *Resolution*: Hardened `apply_canonicalization` with `SECURITY DEFINER` and `SET search_path = public, pg_temp`. Revoked execute from `PUBLIC`, `anon`, and `authenticated`, and granted execute strictly to `service_role`.
    - Added integration tests proving anonymous and standard authenticated users receive permission denied (SQLSTATE `42501`), while `service_role` executes successfully.

15. **Full Canonicalization Atomicity & Zero Upfront Entity Writes (Final Remediation)**
    - *Problem*: Venues and artists were being written to the database before the event transaction, leaving orphaned venue/artist records if event creation subsequently failed.
    - *Resolution*: Updated `VenueResolver` and `ArtistResolver` with `resolveOrPrepare` methods that evaluate identity in-memory without upfront database writes. The coordinator passes `venueToCreate` and inline artist creation payloads into `apply_canonicalization`.
    - The stored procedure (and memory repository) creates or updates the venue, artists, event, event_artists, ticket links, event_sources, field evidence, and candidate resolution in a single database transaction. If any step fails, all mutations are rolled back.
    - Added unit and integration tests asserting zero orphaned venues, artists, or events on failure.

16. **Domain Constraint & Enum Alignment (Final Remediation)**
    - *Problem*: Domain union types and database check constraints diverged from the specification on event kinds and statuses.
    - *Resolution*: Aligned `EventKind` to `'concert' | 'club_show' | 'outdoor_show' | 'free_event' | 'music_series' | 'residency' | 'festival' | 'multi_day_festival'`. Aligned `EventStatus` to `'scheduled' | 'cancelled' | 'postponed' | 'rescheduled' | 'unknown'`. Synchronized domain types, database check constraints, and test fixtures.

17. **Temporal Database Check Constraints (Final Remediation)**
    - *Problem*: Missing database-level constraints allowed inconsistent timestamps, invalid date ranges, or multi-day mismatches.
    - *Resolution*: Added PostgreSQL check constraints:
      - `check_events_instant_starts_at`: precision `instant` requires `starts_at IS NOT NULL`.
      - `check_events_date_only_no_starts_at`: precision `date_only` requires `starts_at IS NULL`.
      - `check_events_local_date_order`: requires `local_end_date >= local_start_date`.
      - `check_events_instant_order`: requires `ends_at >= starts_at`.
      - `check_events_multi_day_consistency`: requires `is_multi_day = false OR local_end_date > local_start_date`.
    - Added integration tests verifying rejection of violating rows.

18. **Candidate & Raw-Ingest Source Integrity (Final Remediation)**
    - *Problem*: `event_candidates` could reference a `raw_ingest_id` belonging to a different `source_id`.
    - *Resolution*: Added compound unique constraint `raw_ingests(id, source_id)` and compound foreign key `(raw_ingest_id, source_id) REFERENCES raw_ingests(id, source_id)` on both `event_candidates` and `event_sources`.
    - Added integration test proving cross-source candidate linking is rejected (SQLSTATE `23503`).

19. **Stable Replay and Idempotency (Final Remediation)**
    - *Problem*: Nullable `source_event_id` in PostgreSQL standard unique constraints treated `NULL` as distinct, risking duplicate source links, and candidate replays did not check upstream source event IDs first.
    - *Resolution*: Replaced simple unique constraint with two partial unique indexes (`WHERE source_event_id IS NOT NULL` and `WHERE source_event_id IS NULL`). Added Step 0 in `EventMatcher` querying `findEventBySourceEventId` for upstream ID matches.
    - Added unit tests proving candidate updates update the canonical event rather than duplicating it.

20. **Artist Disambiguation & Conflict Resolution (Final Remediation)**
    - *Problem*: Normalized name was treated as a universal match key, causing false merges when multiple artists share a name or have conflicting external IDs.
    - *Resolution*: `ArtistResolver` detects ambiguity when multiple artists share a normalized name, routing candidates to `needs_review` (`ambiguous_artist_name_multiple_matches`). Detects when incoming external ID disagrees with an existing artist's external ID (`conflicting_external_id_distinct_artist`).

21. **Removal of Fabricated Geography Defaults (Final Remediation)**
    - *Problem*: Database migrations had `DEFAULT 'US'` on `venues.country_code` and `events.country_code`.
    - *Resolution*: Removed all default `'US'` column definitions and application fallbacks. Preserved nullable `country_code` representing true source knowledge.

22. **Multi-Event Page Crawl & Candidate Separation (Convergence Pass)**
    - *Problem*: `raw_ingests` uniquely constrained on `(source_id, content_hash)` prevented recording distinct URLs that produce identical content, and candidate uniqueness on `(raw_ingest_id, content_hash)` caused candidate collisions when extracting multiple events from a single page observation.
    - *Resolution*: Updated `raw_ingests` unique constraint to `(source_id, source_url, content_hash)`. Added `candidate_fingerprint text` to `event_candidates` and unique partial indexes on `(raw_ingest_id, source_event_id)` and `(raw_ingest_id, candidate_fingerprint)`. Multi-event page crawls persist distinct candidates under a single raw ingest without collisions.

23. **Candidate Artist Survival & External ID Round-Trip (Convergence Pass)**
    - *Problem*: `event_candidates` only stored flat `artist_names text[]`, discarding structured `CandidateArtist` objects with external IDs. When reloaded from the database, external IDs were lost before reaching entity resolution.
    - *Resolution*: Added `candidate_artists jsonb NOT NULL DEFAULT '[]'::jsonb` to `event_candidates`. Repositories serialize `CandidateArtist[]` to/from JSONB. The coordinator and stored procedure `apply_canonicalization` read candidate artist external IDs and write them into `artist_external_ids`.

24. **Strict Locality & Zero Empty-String Venue Creation (Convergence Pass)**
    - *Problem*: Missing venue locality could fall back to empty strings (`city = ''`), creating malformed venue records.
    - *Resolution*: `VenueResolver` requires non-empty city strings and throws on empty string. `CanonicalizationCoordinator` detects missing or whitespace-only venue city and safely routes candidates to `needs_review` with reason `missing_venue_locality`. Zero empty-string venues are created.

25. **Golden-Path Persisted Pipeline Integration Test (Convergence Pass)**
    - *Problem*: Individual unit tests mocked repositories or executed direct SQL, leaving gaps between domain contracts, repository behavior, and PostgreSQL constraints.
    - *Resolution*: Implemented `tests/integration/golden-path.test.ts`, executing the entire production pipeline end-to-end against Supabase PostgreSQL: multi-event crawl page -> raw ingest -> distinct candidates -> canonicalization -> artist external IDs -> rescheduled observation -> immutable candidate observation -> field evidence accumulation without deleting historical evidence -> upstream identity conflict rejection (23505) -> raw ingest URL separation.

26. **Field-Level Evidence on Initial Canonical Event Creation (Final Remediation)**
    - *Problem*: `CanonicalizationCoordinator` previously emitted only a single coarse `canonical_event_created` marker row on event creation, leaving canonical attributes without field-level provenance audit trails.
    - *Resolution*: Updated coordinator to emit explicit `event_field_evidence` rows for every populated canonical field upon creation: `title`, `event_kind`, `status`, `venue`, `city`, `region`, `country_code`, `timezone`, `local_start_date`, `local_end_date`, `starts_at`, `ends_at`, `start_time_precision`, `doors_at`, and `primary_ticket_url`, in addition to the `canonical_event_created` marker. Null/unknown fields do not fabricate evidence. Tested in `golden-path.test.ts` step 1 asserting at least 10 field evidence rows linked to candidate and raw ingest.

27. **Persisted Date-Only Candidate Derivation (Final Remediation)**
    - *Problem*: Candidates without explicit `startTimePrecision` but lacking `startsAt` risked defaulting to `instant` or fabricating midnight timestamps.
    - *Resolution*: Candidate repositories and coordinator explicitly derive `start_time_precision: candidate.startTimePrecision ?? (candidate.startsAt ? 'instant' : 'date_only')`. When `startsAt` is absent, precision defaults cleanly to `date_only` without fabricating midnight instants. Tested in `golden-path.test.ts` step 6 proving round-trip persistence -> reload -> canonicalization leaves `starts_at` null and `start_time_precision = 'date_only'`.

28. **Artist ID Precedence in EventMatcher (Final Remediation)**
    - *Problem*: `EventMatcher` fell back to normalized name matching when two artists shared the same name (e.g. "Ghost"), risking false-positive event merges when their canonical artist IDs differed.
    - *Resolution*: Resolved canonical artist IDs take absolute precedence over normalized names. When canonical artist IDs are present for candidate and existing headliners, differing IDs strictly prevent merging, even if normalized artist names are identical. Opening artist overlap checks are preserved. Tested in `entity-resolution.test.ts` and `golden-path.test.ts` step 7.

29. **Composite Candidate ↔ Raw Observation Foreign Key Integrity (Final Remediation)**
    - *Problem*: Foreign keys on `event_sources` and `event_field_evidence` referenced `(candidate_id)` and `(raw_ingest_id)` independently, allowing cross-linking a candidate with a mismatched raw ingest observation.
    - *Resolution*: Added composite foreign key constraint `constraint fk_event_sources_candidate_source_raw foreign key (candidate_id, source_id, raw_ingest_id) references public.event_candidates(id, source_id, raw_ingest_id) on delete set null` to `event_sources` and `event_field_evidence`. Cross-raw candidate insertions are rejected by PostgreSQL with foreign key violation `23503`. Verified in `golden-path.test.ts` step 8.

30. **createMany() Idempotency on Batch Replay (Final Remediation)**
    - *Problem*: `EventCandidateRepository.createMany()` did not handle duplicate candidate inserts on batch replays, throwing duplicate key errors or duplicating records.
    - *Resolution*: Updated `createMany()` across `SupabaseEventCandidateRepository` and `MemoryEventCandidateRepository` to delegate to `create()` sequentially, inheriting the exact deduplication and stable ID reuse behavior. Verified in `canonicalization-coordinator.test.ts` and `golden-path.test.ts` step 9.

31. **Removal of Obsolete Raw-Ingest Query APIs (Final Remediation)**
    - *Problem*: Obsolete APIs `getBySourceAndContentHash` and `getByContentHash` existed on `IRawIngestRepository`, conflicting with the URL-aware unique constraint `(source_id, source_url, content_hash)`.
    - *Resolution*: Removed obsolete APIs from `IRawIngestRepository`, `SupabaseRawIngestRepository`, and `MemoryRawIngestRepository`. Standardized all raw ingest deduplication lookups on `getBySourceUrlAndContentHash`.

32. **Domain → RPC Snake-Case Payload Mapping (CI Closeout Pass)**
    - *Problem*: `evaluateFieldMerge` generated camelCase update keys (`localStartDate`, `startsAt`, etc.), which `apply_canonicalization` ignored because it expects snake_case keys (`local_start_date`, `starts_at`). This caused canonical event fields to fail to update on rescheduled observations in PostgreSQL.
    - *Resolution*: Implemented `mapEventUpdatesToCanonicalizationPayload` in `CanonicalizationCoordinator` to explicitly map all domain event fields into snake_case database columns without mutating domain objects. Preserves explicit nulls and omits unsupplied properties without fabricating nulls. Tested in `canonicalization-coordinator.test.ts`.

33. **Semantic Instant Equality & Non-Brittle Timezone Assertions (CI Closeout Pass)**
    - *Problem*: String matching `starts_at` directly against ISO strings in PostgreSQL integration tests caused test failures due to database/client time zone formatting offsets (`-06:00` vs `+00:00` vs `Z`).
    - *Resolution*: Assertions compare `local_start_date` as `'2026-10-17'`, `timezone` as `'America/Denver'`, and `starts_at` semantically as an instant (`new Date(updatedEvent.starts_at).getTime() === new Date(...).getTime()`), guaranteeing rock-solid date/time assertion fidelity.

34. **Artist External ID Precedence Over Contextual Disambiguation (CI Closeout Pass)**
    - *Problem*: `ArtistResolver.resolveOrPrepare` could silently retain a contextual artist if names matched, even if an incoming observation carried a strong external ID that conflicted with or pointed to a different artist.
    - *Resolution*: External IDs are checked first. If an incoming external ID conflicts with the contextual artist's registered external IDs or identifies a distinct artist in the catalog, it is routed to `ambiguous` with reason `conflicting_external_id_contextual_mismatch`. Added regression tests in `entity-resolution.test.ts`.

35. **Composite Foreign Key Delete Behavior - ON DELETE RESTRICT (CI Closeout Pass)**
    - *Problem*: Composite foreign keys `(candidate_id, source_id, raw_ingest_id)` with `ON DELETE SET NULL` on `event_sources` and `event_field_evidence` violated the `NOT NULL` constraint on `source_id` if a candidate were deleted.
    - *Resolution*: Updated composite foreign keys to `ON DELETE RESTRICT`, matching the immutable observation model of Phase 1.

36. **Independent Golden Path Integration Tests & CI Guard (CI Closeout Pass)**
    - *Problem*: Shared mutable variables across steps in `golden-path.test.ts` risked test ordering dependencies, and steps could silently return if database was unavailable in CI.
    - *Resolution*: Consolidated sequential steps 1-5 into a single self-contained `core golden path` test, gave step 8 its own isolated test event, and implemented `ensureDbAvailable()` which throws loudly when running in CI (`process.env.CI`), ensuring zero silent skips on pull requests.

---

## Accepted Deferrals

The following items were explicitly reviewed and deferred to subsequent phases:

1. **N+1 Catalog Query Optimization**:
   - `listEvents` queries artists and ticket links for each returned event. Safe to defer until catalog query volume warrants a consolidated SQL join/view.
2. **Advanced Venue Aliasing Infrastructure**:
   - Bidirectional suffix/alias normalization is implemented in application code; a dedicated alias registry table and alias maintenance pipeline is deferred to a future operator tooling phase.
3. **Manual Resolution Operator UI**:
   - `needs_review` statuses and reasons are stored in `candidate_resolutions`, but the human-in-the-loop review interface is deferred to a dedicated admin phase.
4. **Raw-Ingest Retention & Deletion Policy**:
   - Defining the retention window and pruning cron for raw ingest bodies is deferred to Phase 4 / production operations.
5. **Object-Storage Provider & Payload Size Threshold**:
   - Small payloads are stored in PostgreSQL with nullable `external_storage_ref` column in `raw_ingests`; choosing S3/GCS/R2 and offloading large HTML payloads is deferred until high-volume scraping begins.


