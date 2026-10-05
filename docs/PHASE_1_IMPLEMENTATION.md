# Phase 1 — Canonical Inventory and Ingestion Foundation

## Status

Implementation. This document is the persistent implementation source of truth for
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
rationale, affected tests, and any required update to `docs/12-decisions.md` or
the roadmap.
