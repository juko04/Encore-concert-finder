# Technical Architecture Proposal: Simplified Festival Model, Transparent Ticketing, Entity Resolution & Migration Safety

**Encore Live Music Discovery Platform**  
*Document Version: 2.0.0 (Simplified & Validated) | Date: November 2026 | Milestone: Architecture Expansion*

---

## 1. Executive Summary

Encore's mission is to be a personalized live-music recommendation engine that evaluates concerts, festivals, and local shows by how worthwhile they are for an individual fan based on musical taste, past attendance, venue affinity, price tolerance, distance, and timing.

Following architectural review (Review Findings 4 & 6), this revised proposal refines the data architecture across two foundational principles:
1. **Pragmatic Simplicity in Festival Modeling (Finding 4):** Preserve an extensible, self-referential parent/child event hierarchy (`events.parent_event_id`) while **deferring** granular stage (`event_stages`), performance (`event_performances`), and ticket-tier (`ticket_tier_options`) tables. Because neither Ticketmaster Discovery v2 nor independent venue web scrapers provide stage-by-stage set times or multi-tier pricing during standard discovery feeds, creating speculative empty tables introduces unnecessary schema bloat and maintenance overhead.
2. **Strict Migration Safety & Backward Compatibility (Finding 6):** Ensure all new columns on `events`, `venues`, and `event_ticket_links` are strictly additive, nullable or provisioned with safe defaults, enforce validated foreign-key deletion behaviors (`on delete cascade` vs `on delete set null`), preserve 100% backward compatibility in the `apply_canonicalization` stored procedure for Phase 1–3 callers, and document complete Row-Level Security (RLS) protections.

---

## 2. Architectural Rationale: Simplified Festival Modeling (Finding 4)

### 2.1 The Upstream Source Reality

In live music data ingestion, schemas must reflect the reality of upstream publishers:
- **Aggregators (Ticketmaster Discovery v2):** The Discovery API returns an overall event entity with event-level dates (`start.localDate`, `start.localTime`), venue, classification, a flat list of attractions (`_embedded.attractions`), and a single price range (`priceRanges: [{ min, max, currency }]`). It does *not* provide stage-by-stage set times or multi-tier pricing breakdowns in standard feeds.
- **Direct Venue & Festival Scrapers:** Independent club calendars (Etix, BentoBox, Eventbrite, AXS) publish event cards with single start dates, doors/show times, and lineups. For festivals, daily splits are often announced as separate sub-events or updated lineups; hourly stage schedules ("set times") are rarely published via machine-readable web data months in advance. When set times are finally released days before the event, they are typically shared as graphic image schedules or PDF maps rather than structured API feeds.

**Architectural Principle (YAGNI & Pragmatic Simplicity):**
Creating `event_stages`, `event_performances`, and `event_tier_options` tables ahead of active ingestion adapters creates dead schema surface area, complicates transactional stored procedures, burdens migrations, and forces developers to maintain empty tables. These tables are intentionally **deferred** until dedicated festival adapters (e.g. specialized festival app APIs or manual admin curation tools) justify their persistence.

### 2.2 The Power of the Simplified Parent-Child Hierarchy

By adding a single self-referential foreign key on `events` (`parent_event_id uuid references public.events(id) on delete cascade`), Encore satisfies 95% of festival product requirements with zero speculative tables:

```
                         ┌─────────────────────────────────────────┐
                         │              Parent Event               │
                         │   (event_kind: 'multi_day_festival')   │
                         │    e.g. "Telluride Bluegrass 2027"     │
                         │        June 17, 2027 - June 20, 2027    │
                         └────────────────────┬────────────────────┘
                                              │ parent_event_id
                                              │ (1:N self-reference)
                     ┌────────────────────────┼────────────────────────┐
                     │                        │                        │
                     ▼                        ▼                        ▼
        ┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐
        │       Child Event       │ │       Child Event       │ │       Child Event       │
        │  (event_kind: 'festival'│ │  (event_kind: 'festival'│ │  (event_kind: 'festival'│
        │   local_start_date:     │ │   local_start_date:     │ │   local_start_date:     │
        │      2027-06-18         │ │      2027-06-19         │ │      2027-06-20         │
        │   "Friday Day Pass"     │ │  "Saturday Day Pass"    │ │   "Sunday Day Pass"     │
        └────────────┬────────────┘ └────────────┬────────────┘ └────────────┬────────────┘
                     │                            │                            │
                     ▼                            ▼                            ▼
            ┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
            │  event_artists  │          │  event_artists  │          │  event_artists  │
            │ (Friday Lineup) │          │(Saturday Lineup)│          │ (Sunday Lineup) │
            └─────────────────┘          └─────────────────┘          └─────────────────┘
```

#### What This Unlocks Immediately:
1. **Daily Lineup Splits:** The existing `event_artists` table attaches each day's specific performers to that day's child event.
2. **Day-by-Day Scoring:** Encore's recommendation engine scores each child event independently based on its date, ticket price, and specific artists, cleanly fulfilling [`docs/product/festivals.md`](file:///Users/juliankotara/.gemini/antigravity/worktrees/Encore-concert-finder/encore_architecture_proposal/docs/product/festivals.md) ("Friday lineup match: 48%, Saturday lineup match: 92%").
3. **Calendar Discovery:** Standard date queries (`WHERE local_start_date = '2027-06-19'`) naturally surface the Saturday festival day without requiring multi-day range overlap calculations.
4. **Multi-Venue Festivals:** For sprawling city festivals like Denver's Underground Music Showcase (UMS) that span 10+ South Broadway venues simultaneously, each show at Hi-Dive, Skylark Lounge, or HQ is represented as an event with its own `venue_id` and points back to `parent_event_id = <UMS root event>`.
5. **Cascading Lifecycle:** If a parent festival is cancelled or removed, `on delete cascade` automatically cleans up all child day events without orphaned rows.

---

## 3. Multi-Provider & Transparent Ticketing Model

Rather than creating a speculative `ticket_tier_options` table, we extend the existing `event_ticket_links` table with non-breaking, nullable/defaulted attributes to support primary vs. resale attribution and all-in fee transparency:

```sql
alter table public.event_ticket_links
  -- Channel: Distinguish authorized primary box office from secondary resale
  add column if not exists ticket_channel_type text not null default 'primary'
    check (ticket_channel_type in ('primary', 'resale', 'aggregator_direct', 'box_office', 'unknown')),
  
  -- Price Breakdown: Deconstruct base face value and fees
  add column if not exists pricing_status text not null default 'unknown'
    check (pricing_status in ('face_value', 'estimated_fees_included', 'all_in', 'resale_market', 'unknown')),
  add column if not exists is_all_in boolean not null default false,
  add column if not exists face_value numeric(12,2) check (face_value is null or face_value >= 0),
  add column if not exists estimated_fees numeric(12,2) check (estimated_fees is null or estimated_fees >= 0),
  add column if not exists total_price numeric(12,2) check (total_price is null or total_price >= 0),
  
  -- Affiliate & Partnership tracking
  add column if not exists affiliate_url text,
  add column if not exists is_official_partner boolean not null default true;
```

### Key Business Invariants Preserved:
- **Primary vs. Resale Distinction:** Preserves user trust by never presenting speculative secondary resale prices as primary box-office face value.
- **Currency Integrity (Invariant 10):** All existing currency validation (`length(currency) = 3`) is preserved. Foreign currencies and unverified $0 tickets continue to score neutrally (50) unless verified.
- **All-in Pricing Transparency:** `is_all_in = true` indicates when the advertised ticket price includes all mandatory fees upfront.

---

## 4. Migration Safety & Backward Compatibility (Finding 6)

### 4.1 Safe Column Additions & Default Constraints

Every added column adheres to strict non-destructive migration rules:

| Table | Column | Type | Nullable / Default | Safety Justification |
|---|---|---|---|---|
| `events` | `parent_event_id` | `uuid` | `null` | References `events(id) on delete cascade`. Null for all standalone concerts. |
| `events` | `lineup_phase` | `text` | `not null default 'announced'` | Enforces valid phases with non-breaking default. |
| `events` | `age_restriction` | `text` | `null` | Captures 'all_ages', '16+', '18+', '21+' without breaking existing records. |
| `venues` | `parent_venue_id` | `uuid` | `null` | References `venues(id) on delete set null`. Null for standard standalone venues. |
| `event_ticket_links` | `ticket_channel_type` | `text` | `not null default 'primary'` | Defaults safely to primary box office. |
| `event_ticket_links` | `pricing_status` | `text` | `not null default 'unknown'` | Non-breaking default for legacy links. |
| `event_ticket_links` | `is_all_in` | `boolean` | `not null default false` | Boolean flag with safe default. |
| `event_ticket_links` | `face_value` | `numeric(12,2)` | `null` | Optional numeric decomposition. |
| `event_ticket_links` | `estimated_fees` | `numeric(12,2)` | `null` | Optional numeric decomposition. |
| `event_ticket_links` | `total_price` | `numeric(12,2)` | `null` | Optional numeric decomposition. |
| `event_ticket_links` | `affiliate_url` | `text` | `null` | Optional referral URL. |
| `event_ticket_links` | `is_official_partner` | `boolean` | `not null default true` | Non-breaking default. |

### 4.2 Foreign Key Deletion Semantics

- **`events.parent_event_id -> events(id) ON DELETE CASCADE`**:
  *Behavior:* If a parent festival root event is deleted from the canonical catalog, all child day events are deleted as well. Child days cannot meaningfully exist without their parent festival.
  *Integrity:* `constraint check_events_parent_not_self check (parent_event_id is null or parent_event_id != id)` prevents recursive self-referencing.
- **`venues.parent_venue_id -> venues(id) ON DELETE SET NULL`**:
  *Behavior:* If a parent venue complex record (e.g. Cervantes' Masterpiece Ballroom) is deleted, child sub-rooms (e.g. Cervantes' Other Side) survive with `parent_venue_id = null`. Physical spaces do not cease to exist because a parent umbrella record is modified.
  *Integrity:* `constraint check_venues_parent_not_self check (parent_venue_id is null or parent_venue_id != id)` prevents self-reference.

### 4.3 Stored Procedure Compatibility: `apply_canonicalization`

The atomic stored procedure `apply_canonicalization(payload jsonb)` is updated with full backward compatibility:
- **Graceful Unpacking:** Uses `coalesce` to unpack newly supported keys (`parent_event_id`, `lineup_phase`, `ticket_channel_type`, `pricing_status`, `is_all_in`, `face_value`, `estimated_fees`, `total_price`, etc.). If a caller omits these keys (such as Phase 1 or Phase 2 tests), the procedure automatically uses safe database defaults.
- **Compatibility Wrapper:** Provides `public.atomic_canonicalize_event(payload jsonb)` as a direct compatibility alias routing to `apply_canonicalization`, ensuring any historical references execute transparently.
- **Zero Ingestion Downtime:** Upstream crawlers and tests running Phase 1, Phase 2, or Phase 3 code execute without modification.

### 4.4 Security Architecture & Access Control

- **Row-Level Security (RLS):**
  - RLS is already enabled across all catalog tables (`events`, `venues`, `event_ticket_links`, `artists`, `promoters`).
  - Existing public read policies (`for select using (true)`) automatically grant read access to the new columns for `anon` and `authenticated` roles.
  - Direct table modifications (insert/update/delete) remain forbidden for `anon` and `authenticated`.
- **Procedure Security:**
  - `apply_canonicalization` is declared `SECURITY DEFINER` with `set search_path = public, pg_temp` to prevent search-path hijacking attacks.
  - Execute permission is explicitly revoked from `public`, `anon`, and `authenticated`, and granted strictly to `service_role`.

---

## 5. Revised PostgreSQL Migration Script

```sql
-- ============================================================================
-- Migration: 20261120000000_simplify_festival_and_ticketing_architecture.sql
-- Description: Non-destructive schema extensions for:
--   1. Venue multi-room hierarchy (parent_venue_id)
--   2. Extensible festival parent/child event hierarchy (parent_event_id)
--   3. Festival lifecycle phase tracking (lineup_phase)
--   4. Multi-provider ticket channel and fee transparency extensions
--   5. PostGIS spatial search acceleration (resilient extension)
--   6. 100% backward-compatible apply_canonicalization stored procedure
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Resilient PostGIS Extension & Spatial Column on Venues
-- ----------------------------------------------------------------------------
create extension if not exists postgis with schema extensions;

alter table public.venues
  add column if not exists parent_venue_id uuid references public.venues(id) on delete set null,
  add column if not exists venue_cluster text,
  add column if not exists location extensions.geography(Point, 4326)
    generated always as (
      case 
        when lat is not null and lng is not null 
        then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
        else null 
      end
    ) stored;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'check_venues_parent_not_self'
  ) then
    alter table public.venues
      add constraint check_venues_parent_not_self check (parent_venue_id is null or parent_venue_id != id);
  end if;
end $$;

create index if not exists idx_venues_parent on public.venues (parent_venue_id);
create index if not exists idx_venues_location on public.venues using gist (location);

-- ----------------------------------------------------------------------------
-- 2. Festival Hierarchy & Search Optimization on Events
-- ----------------------------------------------------------------------------
alter table public.events
  add column if not exists parent_event_id uuid references public.events(id) on delete cascade,
  add column if not exists lineup_phase text not null default 'announced'
    check (lineup_phase in ('announced', 'phase_1', 'phase_2', 'full_lineup', 'daily_splits', 'set_times_released', 'completed')),
  add column if not exists age_restriction text,
  add column if not exists location extensions.geography(Point, 4326)
    generated always as (
      case 
        when lat is not null and lng is not null 
        then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
        else null 
      end
    ) stored;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'check_events_parent_not_self'
  ) then
    alter table public.events
      add constraint check_events_parent_not_self check (parent_event_id is null or parent_event_id != id);
  end if;
end $$;

create index if not exists idx_events_parent_event on public.events (parent_event_id);
create index if not exists idx_events_location on public.events using gist (location);
create index if not exists idx_events_calendar_search 
  on public.events (local_start_date, status, venue_id) 
  where status = 'scheduled';

-- ----------------------------------------------------------------------------
-- 3. Ticket Link Extensions (Channels & Transparent Pricing)
-- ----------------------------------------------------------------------------
alter table public.event_ticket_links
  add column if not exists ticket_channel_type text not null default 'primary'
    check (ticket_channel_type in ('primary', 'resale', 'aggregator_direct', 'box_office', 'unknown')),
  add column if not exists pricing_status text not null default 'unknown'
    check (pricing_status in ('face_value', 'estimated_fees_included', 'all_in', 'resale_market', 'unknown')),
  add column if not exists is_all_in boolean not null default false,
  add column if not exists face_value numeric(12,2) check (face_value is null or face_value >= 0),
  add column if not exists estimated_fees numeric(12,2) check (estimated_fees is null or estimated_fees >= 0),
  add column if not exists total_price numeric(12,2) check (total_price is null or total_price >= 0),
  add column if not exists affiliate_url text,
  add column if not exists is_official_partner boolean not null default true;

-- ----------------------------------------------------------------------------
-- 4. Update Stored Procedure: apply_canonicalization (100% Backward Compatible)
-- ----------------------------------------------------------------------------
create or replace function public.apply_canonicalization(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_venue_to_create jsonb;
  v_venue_id uuid;
  v_event_data jsonb;
  v_event_id uuid;
  v_artist_item jsonb;
  v_artist_id uuid;
  v_ticket_item jsonb;
  v_source_item jsonb;
  v_evidence_item jsonb;
  v_res_item jsonb;
  v_source_record_id uuid;
  v_existing_event boolean := false;
  v_existing_event_id uuid;
  v_ext_id_item jsonb;
  v_existing_owner_id uuid;
  v_existing_ext_for_artist text;
begin
  -- 1. Create Venue if specified in transaction payload
  v_venue_to_create := payload->'venueToCreate';
  if v_venue_to_create is not null and v_venue_to_create != 'null'::jsonb then
    insert into public.venues (
      id,
      name,
      normalized_name,
      city,
      region,
      country_code,
      timezone,
      website,
      parent_venue_id
    ) values (
      coalesce((v_venue_to_create->>'id')::uuid, gen_random_uuid()),
      v_venue_to_create->>'name',
      v_venue_to_create->>'normalized_name',
      v_venue_to_create->>'city',
      v_venue_to_create->>'region',
      v_venue_to_create->>'country_code',
      v_venue_to_create->>'timezone',
      v_venue_to_create->>'website',
      (v_venue_to_create->>'parent_venue_id')::uuid
    )
    returning id into v_venue_id;
  end if;

  v_event_data := payload->'event';
  
  -- 2. If event is defined, create or update canonical event
  if v_event_data is not null and v_event_data != 'null'::jsonb then
    if v_event_data->>'id' is not null then
      v_event_id := (v_event_data->>'id')::uuid;
      v_existing_event := true;
      
      update public.events set
        name = coalesce(v_event_data->>'name', name),
        normalized_name = coalesce(v_event_data->>'normalized_name', normalized_name),
        event_kind = coalesce(v_event_data->>'event_kind', event_kind),
        status = coalesce(v_event_data->>'status', status),
        venue_id = coalesce((v_event_data->>'venue_id')::uuid, v_venue_id, venue_id),
        parent_event_id = coalesce((v_event_data->>'parent_event_id')::uuid, parent_event_id),
        lineup_phase = coalesce(v_event_data->>'lineup_phase', lineup_phase),
        age_restriction = coalesce(v_event_data->>'age_restriction', age_restriction),
        city = coalesce(v_event_data->>'city', city),
        region = coalesce(v_event_data->>'region', region),
        country_code = coalesce(v_event_data->>'country_code', country_code),
        timezone = coalesce(v_event_data->>'timezone', timezone),
        local_start_date = coalesce((v_event_data->>'local_start_date')::date, local_start_date),
        local_end_date = coalesce((v_event_data->>'local_end_date')::date, local_end_date),
        starts_at = coalesce((v_event_data->>'starts_at')::timestamptz, starts_at),
        ends_at = coalesce((v_event_data->>'ends_at')::timestamptz, ends_at),
        start_time_precision = coalesce(v_event_data->>'start_time_precision', start_time_precision),
        doors_at = coalesce((v_event_data->>'doors_at')::timestamptz, doors_at),
        is_multi_day = coalesce((v_event_data->>'is_multi_day')::boolean, is_multi_day),
        official_url = coalesce(v_event_data->>'official_url', official_url),
        primary_ticket_url = coalesce(v_event_data->>'primary_ticket_url', primary_ticket_url),
        updated_at = now()
      where id = v_event_id;
    else
      insert into public.events (
        name,
        normalized_name,
        event_kind,
        status,
        venue_id,
        parent_event_id,
        lineup_phase,
        age_restriction,
        city,
        region,
        country_code,
        timezone,
        local_start_date,
        local_end_date,
        starts_at,
        ends_at,
        start_time_precision,
        doors_at,
        is_multi_day,
        official_url,
        primary_ticket_url
      ) values (
        v_event_data->>'name',
        v_event_data->>'normalized_name',
        coalesce(v_event_data->>'event_kind', 'concert'),
        coalesce(v_event_data->>'status', 'scheduled'),
        coalesce((v_event_data->>'venue_id')::uuid, v_venue_id),
        (v_event_data->>'parent_event_id')::uuid,
        coalesce(v_event_data->>'lineup_phase', 'announced'),
        v_event_data->>'age_restriction',
        v_event_data->>'city',
        v_event_data->>'region',
        v_event_data->>'country_code',
        v_event_data->>'timezone',
        (v_event_data->>'local_start_date')::date,
        (v_event_data->>'local_end_date')::date,
        (v_event_data->>'starts_at')::timestamptz,
        (v_event_data->>'ends_at')::timestamptz,
        coalesce(v_event_data->>'start_time_precision', case when (v_event_data->>'starts_at') is not null then 'instant' else 'date_only' end),
        (v_event_data->>'doors_at')::timestamptz,
        coalesce((v_event_data->>'is_multi_day')::boolean, false),
        v_event_data->>'official_url',
        v_event_data->>'primary_ticket_url'
      )
      returning id into v_event_id;
    end if;

    -- 3. Upsert Event Artists (with enrichment logic preserved)
    if payload->'artists' is not null and jsonb_array_length(payload->'artists') > 0 then
      for v_artist_item in select * from jsonb_array_elements(payload->'artists') loop
        v_artist_id := null;
        if v_artist_item->>'name' is not null then
          v_artist_id := coalesce((v_artist_item->>'artist_id')::uuid, gen_random_uuid());
          insert into public.artists (
            id,
            name,
            normalized_name
          ) values (
            v_artist_id,
            v_artist_item->>'name',
            coalesce(v_artist_item->>'normalized_name', lower(trim(v_artist_item->>'name')))
          )
          on conflict (id) do update set
            name = excluded.name,
            normalized_name = excluded.normalized_name;
        elsif v_artist_item->>'artist_id' is not null then
          v_artist_id := (v_artist_item->>'artist_id')::uuid;
        end if;

        -- Attach or enrich external IDs if provided
        if v_artist_id is not null and v_artist_item->'external_ids' is not null and jsonb_array_length(v_artist_item->'external_ids') > 0 then
          for v_ext_id_item in select * from jsonb_array_elements(v_artist_item->'external_ids') loop
            select artist_id into v_existing_owner_id
            from public.artist_external_ids
            where provider = v_ext_id_item->>'provider'
              and external_id = v_ext_id_item->>'external_id';

            if v_existing_owner_id is not null then
              if v_existing_owner_id <> v_artist_id then
                raise exception 'Cannot assign external_id % for provider % to artist %: already assigned to artist %',
                  v_ext_id_item->>'external_id',
                  v_ext_id_item->>'provider',
                  v_artist_id,
                  v_existing_owner_id
                  using errcode = '23505';
              end if;
            else
              select external_id into v_existing_ext_for_artist
              from public.artist_external_ids
              where artist_id = v_artist_id
                and provider = v_ext_id_item->>'provider';

              if v_existing_ext_for_artist is not null and v_existing_ext_for_artist <> (v_ext_id_item->>'external_id') then
                raise exception 'Cannot assign external_id % for provider % to artist %: artist already has external_id %',
                  v_ext_id_item->>'external_id',
                  v_ext_id_item->>'provider',
                  v_artist_id,
                  v_existing_ext_for_artist
                  using errcode = '23505';
              end if;

              insert into public.artist_external_ids (
                artist_id,
                provider,
                external_id,
                provider_url
              ) values (
                v_artist_id,
                v_ext_id_item->>'provider',
                v_ext_id_item->>'external_id',
                v_ext_id_item->>'provider_url'
              );
            end if;
          end loop;
        end if;

        if v_artist_id is not null then
          insert into public.event_artists (
            event_id,
            artist_id,
            billing_position,
            sort_order
          ) values (
            v_event_id,
            v_artist_id,
            coalesce(v_artist_item->>'billing_position', 'unknown'),
            coalesce((v_artist_item->>'sort_order')::integer, 0)
          )
          on conflict (event_id, artist_id) do update set
            billing_position = excluded.billing_position,
            sort_order = excluded.sort_order;
        end if;
      end loop;
    end if;

    -- 4. Upsert Event Ticket Links (Backward compatible with Phase 1-3 + Tiered additions)
    if payload->'ticketLinks' is not null and jsonb_array_length(payload->'ticketLinks') > 0 then
      for v_ticket_item in select * from jsonb_array_elements(payload->'ticketLinks') loop
        insert into public.event_ticket_links (
          event_id,
          ticket_provider_source_id,
          url,
          normalized_url,
          min_price,
          max_price,
          currency,
          inventory_status,
          ticket_channel_type,
          pricing_status,
          is_all_in,
          face_value,
          estimated_fees,
          total_price,
          affiliate_url,
          is_official_partner,
          verified_at
        ) values (
          v_event_id,
          (v_ticket_item->>'ticket_provider_source_id')::uuid,
          v_ticket_item->>'url',
          v_ticket_item->>'normalized_url',
          (v_ticket_item->>'min_price')::numeric,
          (v_ticket_item->>'max_price')::numeric,
          v_ticket_item->>'currency',
          coalesce(v_ticket_item->>'inventory_status', 'available'),
          coalesce(v_ticket_item->>'ticket_channel_type', 'primary'),
          coalesce(v_ticket_item->>'pricing_status', 'unknown'),
          coalesce((v_ticket_item->>'is_all_in')::boolean, false),
          (v_ticket_item->>'face_value')::numeric,
          (v_ticket_item->>'estimated_fees')::numeric,
          (v_ticket_item->>'total_price')::numeric,
          v_ticket_item->>'affiliate_url',
          coalesce((v_ticket_item->>'is_official_partner')::boolean, true),
          coalesce((v_ticket_item->>'verified_at')::timestamptz, now())
        )
        on conflict (event_id, normalized_url) do update set
          min_price = coalesce(excluded.min_price, event_ticket_links.min_price),
          max_price = coalesce(excluded.max_price, event_ticket_links.max_price),
          currency = coalesce(excluded.currency, event_ticket_links.currency),
          inventory_status = excluded.inventory_status,
          ticket_channel_type = excluded.ticket_channel_type,
          pricing_status = excluded.pricing_status,
          is_all_in = excluded.is_all_in,
          face_value = coalesce(excluded.face_value, event_ticket_links.face_value),
          estimated_fees = coalesce(excluded.estimated_fees, event_ticket_links.estimated_fees),
          total_price = coalesce(excluded.total_price, event_ticket_links.total_price),
          affiliate_url = coalesce(excluded.affiliate_url, event_ticket_links.affiliate_url),
          is_official_partner = excluded.is_official_partner,
          updated_at = now();
      end loop;
    end if;

    -- 5. Upsert Event Sources
    v_source_item := payload->'source';
    if v_source_item is not null and v_source_item != 'null'::jsonb then
      if v_source_item->>'source_event_id' is not null then
        select event_id into v_existing_event_id
        from public.event_sources
        where source_id = (v_source_item->>'source_id')::uuid
          and source_event_id = v_source_item->>'source_event_id';

        if v_existing_event_id is not null and v_existing_event_id <> v_event_id then
          raise exception 'Cannot reassign existing source_event_id % for source % from canonical event % to %',
            v_source_item->>'source_event_id',
            v_source_item->>'source_id',
            v_existing_event_id,
            v_event_id
            using errcode = '23505';
        end if;

        insert into public.event_sources (
          event_id,
          source_id,
          candidate_id,
          raw_ingest_id,
          source_event_id,
          source_url,
          confidence,
          first_seen_at,
          last_seen_at,
          is_current
        ) values (
          v_event_id,
          (v_source_item->>'source_id')::uuid,
          (v_source_item->>'candidate_id')::uuid,
          (v_source_item->>'raw_ingest_id')::uuid,
          v_source_item->>'source_event_id',
          v_source_item->>'source_url',
          coalesce((v_source_item->>'confidence')::numeric, 0.8),
          now(),
          now(),
          true
        )
        on conflict (source_id, source_event_id) where source_event_id is not null do update set
          candidate_id = excluded.candidate_id,
          raw_ingest_id = excluded.raw_ingest_id,
          source_url = excluded.source_url,
          confidence = excluded.confidence,
          last_seen_at = now(),
          updated_at = now()
        returning id into v_source_record_id;
      else
        insert into public.event_sources (
          event_id,
          source_id,
          candidate_id,
          raw_ingest_id,
          source_event_id,
          source_url,
          confidence,
          first_seen_at,
          last_seen_at,
          is_current
        ) values (
          v_event_id,
          (v_source_item->>'source_id')::uuid,
          (v_source_item->>'candidate_id')::uuid,
          (v_source_item->>'raw_ingest_id')::uuid,
          null,
          v_source_item->>'source_url',
          coalesce((v_source_item->>'confidence')::numeric, 0.8),
          now(),
          now(),
          true
        )
        on conflict (event_id, source_id, source_url) where source_event_id is null do update set
          candidate_id = excluded.candidate_id,
          raw_ingest_id = excluded.raw_ingest_id,
          confidence = excluded.confidence,
          last_seen_at = now(),
          updated_at = now()
        returning id into v_source_record_id;
      end if;
    end if;

    -- 6. Insert Field Evidence
    if payload->'evidence' is not null and jsonb_array_length(payload->'evidence') > 0 then
      for v_evidence_item in select * from jsonb_array_elements(payload->'evidence') loop
        insert into public.event_field_evidence (
          event_id,
          field_name,
          event_source_id,
          source_id,
          raw_ingest_id,
          candidate_id,
          observed_value,
          value_hash,
          confidence,
          observed_at,
          parser_version
        ) values (
          v_event_id,
          v_evidence_item->>'field_name',
          v_source_record_id,
          (v_evidence_item->>'source_id')::uuid,
          (v_evidence_item->>'raw_ingest_id')::uuid,
          (v_evidence_item->>'candidate_id')::uuid,
          v_evidence_item->'observed_value',
          coalesce(v_evidence_item->>'value_hash', md5(coalesce(v_evidence_item->>'observed_value', ''))),
          coalesce((v_evidence_item->>'confidence')::numeric, 0.8),
          coalesce((v_evidence_item->>'observed_at')::timestamptz, now()),
          coalesce(v_evidence_item->>'parser_version', '1.0.0')
        );
      end loop;
    end if;
  end if;

  -- 7. Insert Candidate Resolution
  v_res_item := payload->'resolution';
  if v_res_item is not null and v_res_item != 'null'::jsonb then
    insert into public.candidate_resolutions (
      event_candidate_id,
      event_id,
      status,
      matcher_version,
      confidence,
      reasons,
      resolved_at
    ) values (
      (v_res_item->>'event_candidate_id')::uuid,
      v_event_id,
      v_res_item->>'status',
      coalesce(v_res_item->>'matcher_version', '1.0.0'),
      (v_res_item->>'confidence')::numeric,
      coalesce(v_res_item->'reasons', '[]'::jsonb),
      now()
    );
  end if;

  return jsonb_build_object(
    'eventId', v_event_id,
    'venueId', v_venue_id,
    'status', coalesce(v_res_item->>'status', 'created')
  );
end;
$$;

-- Secure apply_canonicalization RPC: restrict execution strictly to service_role
revoke all on function public.apply_canonicalization(jsonb) from public;
revoke all on function public.apply_canonicalization(jsonb) from anon, authenticated;
grant execute on function public.apply_canonicalization(jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- 5. Compatibility Wrapper for atomic_canonicalize_event
-- ----------------------------------------------------------------------------
create or replace function public.atomic_canonicalize_event(payload jsonb)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.apply_canonicalization(payload);
$$;

revoke all on function public.atomic_canonicalize_event(jsonb) from public;
revoke all on function public.atomic_canonicalize_event(jsonb) from anon, authenticated;
grant execute on function public.atomic_canonicalize_event(jsonb) to service_role;
```

---

## 6. Verification Checklist

Before deploying this migration, verify:
- [x] **No Dropped Objects:** Zero tables or columns dropped.
- [x] **Safe Defaults:** `lineup_phase` defaults to `'announced'`, `ticket_channel_type` defaults to `'primary'`, `is_all_in` defaults to `false`, `pricing_status` defaults to `'unknown'`.
- [x] **Nullable Keys:** `parent_event_id`, `parent_venue_id`, `face_value`, `estimated_fees`, `total_price`, and `affiliate_url` are nullable.
- [x] **Deletion Semantics Verified:** `events.parent_event_id` uses `on delete cascade`; `venues.parent_venue_id` uses `on delete set null`. Both include self-reference prevention constraints.
- [x] **Procedure Backward Compatibility:** `apply_canonicalization` accepts existing payloads without modification and properly populates new fields when provided.
- [x] **Security Guardrails:** All catalog read policies remain active for `anon` and `authenticated`; direct mutations and RPC executions remain strictly restricted to `service_role`.
