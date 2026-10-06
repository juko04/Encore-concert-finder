-- Migration: 20261005120000_create_inventory_reference_and_catalog.sql
-- Description: Creates canonical inventory reference and catalog tables for artists, venues, promoters, events, and ticket links.

-- 1. Sources table (operational source registry)
create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  source_type text not null,
  acquisition_method text not null,
  base_url text,
  reliability_score numeric not null default 0.8 check (reliability_score >= 0 and reliability_score <= 1),
  active boolean not null default true,
  parser_version text not null default '1.0.0',
  consecutive_failures integer not null default 0,
  last_fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Safe public view of sources (hides internal operational health data)
create or replace view public.public_sources as
  select
    id,
    slug,
    name,
    source_type,
    base_url,
    active
  from public.sources
  where active = true;

-- 3. Artists
create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_artists_normalized_name on public.artists (normalized_name);

-- 4. Artist External Identifiers (Spotify, Ticketmaster, MusicBrainz)
create table if not exists public.artist_external_ids (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  provider text not null,
  external_id text not null,
  provider_url text,
  created_at timestamptz not null default now(),
  constraint uq_artist_provider_external_id unique (provider, external_id),
  constraint uq_artist_provider unique (artist_id, provider)
);

create index if not exists idx_artist_external_ids_provider_lookup on public.artist_external_ids (provider, external_id);

-- 5. Artist Aliases
create table if not exists public.artist_aliases (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  created_at timestamptz not null default now(),
  constraint uq_artist_alias unique (artist_id, normalized_alias)
);

create index if not exists idx_artist_aliases_normalized on public.artist_aliases (normalized_alias);

-- 6. Venues
create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  city text not null,
  region text,
  country_code text,
  lat numeric,
  lng numeric,
  timezone text,
  website text,
  capacity integer check (capacity is null or capacity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_venues_lookup on public.venues (normalized_name, city);
create index if not exists idx_venues_city_region on public.venues (city, region);

-- 7. Venue Aliases
create table if not exists public.venue_aliases (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  created_at timestamptz not null default now(),
  constraint uq_venue_alias unique (venue_id, normalized_alias)
);

create index if not exists idx_venue_aliases_normalized on public.venue_aliases (normalized_alias);

-- 8. Promoters
create table if not exists public.promoters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  website text,
  calendar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_promoters_normalized_name on public.promoters (normalized_name);

-- 9. Events (Canonical concerts, festivals, multi-day shows)
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  event_kind text not null default 'concert' check (event_kind in ('concert', 'club_show', 'outdoor_show', 'free_event', 'music_series', 'residency', 'festival', 'multi_day_festival')),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'postponed', 'rescheduled', 'unknown')),
  venue_id uuid references public.venues(id) on delete set null,
  city text,
  region text,
  country_code text,
  lat numeric,
  lng numeric,
  timezone text not null,
  local_start_date date not null,
  local_end_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  start_time_precision text not null default 'instant' check (start_time_precision in ('instant', 'date_only')),
  doors_at timestamptz,
  is_multi_day boolean not null default false,
  official_url text,
  primary_ticket_url text,
  announced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint check_events_instant_starts_at check (start_time_precision != 'instant' or starts_at is not null),
  constraint check_events_date_only_no_starts_at check (start_time_precision != 'date_only' or starts_at is null),
  constraint check_events_local_date_order check (local_end_date is null or local_end_date >= local_start_date),
  constraint check_events_instant_order check (ends_at is null or starts_at is null or ends_at >= starts_at),
  constraint check_events_multi_day_consistency check (
    (local_end_date is not null and local_end_date > local_start_date and is_multi_day = true) or
    ((local_end_date is null or local_end_date = local_start_date) and is_multi_day = false)
  )
);

create index if not exists idx_events_local_start_date on public.events (local_start_date);
create index if not exists idx_events_venue_date on public.events (venue_id, local_start_date);
create index if not exists idx_events_starts_at on public.events (starts_at);
create index if not exists idx_events_status on public.events (status);
create index if not exists idx_events_event_kind on public.events (event_kind);
create index if not exists idx_events_city on public.events (city);

-- 10. Event Artists (Billing order and relationship)
create table if not exists public.event_artists (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  billing_position text not null default 'unknown' check (billing_position in ('headliner', 'subheadliner', 'mid_card', 'support', 'unknown')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint uq_event_artist unique (event_id, artist_id)
);

create index if not exists idx_event_artists_event on public.event_artists (event_id);
create index if not exists idx_event_artists_artist on public.event_artists (artist_id);

-- 11. Event Promoters
create table if not exists public.event_promoters (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  promoter_id uuid not null references public.promoters(id) on delete cascade,
  relationship_type text not null default 'promoter' check (relationship_type in ('promoter', 'co_promoter', 'presenter', 'producer')),
  created_at timestamptz not null default now(),
  constraint uq_event_promoter unique (event_id, promoter_id)
);

create index if not exists idx_event_promoters_promoter on public.event_promoters (promoter_id);

-- 12. Event Ticket Links
create table if not exists public.event_ticket_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  ticket_provider_source_id uuid references public.sources(id) on delete set null,
  url text not null,
  normalized_url text not null,
  min_price numeric check (min_price is null or min_price >= 0),
  max_price numeric check (max_price is null or max_price >= 0),
  currency text check (currency is null or length(currency) = 3),
  inventory_status text not null default 'available' check (inventory_status in ('available', 'low_inventory', 'sold_out', 'cancelled', 'unknown')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_event_normalized_ticket_url unique (event_id, normalized_url)
);

create index if not exists idx_event_ticket_links_normalized on public.event_ticket_links (normalized_url);
create index if not exists idx_event_ticket_links_event on public.event_ticket_links (event_id);
create index if not exists idx_event_ticket_links_provider on public.event_ticket_links (ticket_provider_source_id);

