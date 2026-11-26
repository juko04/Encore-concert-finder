-- Migration: 20261127020000_market_price_observations.sql
-- Description: Market price observations (price-only enrichment; plan:
-- docs/phases/active/MARKET_PRICES_PLAN.md).
--
-- A marketplace (SeatGeek first) can tell us the lowest price currently listed for a show
-- that has no face-value price. These rows never touch canonical event fields
-- (events.min_price / max_price stay face value) and are display-only in v1.
--
-- Invariants:
--   * Append-only observations (AGENTS.md invariant 3): UPDATE is always rejected; a direct
--     DELETE is rejected. Rows only leave through an ON DELETE CASCADE from their event,
--     source or raw ingest.
--   * Provenance: every row points at the raw_ingests page it was parsed from.
--   * Currency is stored as reported and never converted (invariant 10).
--   * RLS on, no policies: only service_role touches the table. The public reads the
--     market_prices_current view, which exposes only fresh, non-empty, latest rows.

create table if not exists public.market_price_observations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  raw_ingest_id uuid not null,
  marketplace_event_id text not null check (length(marketplace_event_id) > 0),
  marketplace_url text,
  lowest_price numeric check (lowest_price is null or lowest_price >= 0),
  average_price numeric check (average_price is null or average_price >= 0),
  highest_price numeric check (highest_price is null or highest_price >= 0),
  listing_count integer not null check (listing_count >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  observed_at timestamptz not null,
  match_method text not null,
  match_confidence numeric not null check (match_confidence >= 0 and match_confidence <= 1),
  parser_version text not null,
  created_at timestamptz not null default now(),
  constraint fk_market_price_raw_ingest
    foreign key (raw_ingest_id, source_id)
    references public.raw_ingests (id, source_id)
    on delete cascade,
  constraint check_market_price_order
    check (lowest_price is null or highest_price is null or lowest_price <= highest_price),
  -- Re-writing the same observation is idempotent. observed_at is part of the key so an
  -- unchanged page (same raw ingest) seen again later still records a fresh sighting.
  constraint uq_market_price_observation
    unique (raw_ingest_id, marketplace_event_id, event_id, observed_at)
);

create index if not exists idx_market_price_observations_latest
  on public.market_price_observations (event_id, source_id, observed_at desc);

alter table public.market_price_observations enable row level security;

-- Append-only guard. Cascaded deletes run inside the referential-integrity trigger
-- (pg_trigger_depth() > 1 here), so removing an event still removes its observations.
create or replace function public.reject_market_price_observation_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'market_price_observations is append-only: UPDATE is not allowed'
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() <= 1 then
    raise exception 'market_price_observations is append-only: direct DELETE is not allowed'
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

revoke all on function public.reject_market_price_observation_mutation() from public, anon, authenticated;

drop trigger if exists trg_market_price_observations_append_only on public.market_price_observations;
create trigger trg_market_price_observations_append_only
  before update or delete on public.market_price_observations
  for each row execute function public.reject_market_price_observation_mutation();

-- Public view: the latest observation per event and source, shown only while it is fresh
-- (72 hours) and still has listings. A stale or sold-out latest row hides the price rather
-- than falling back to an older one.
create or replace view public.market_prices_current as
  select
    latest.event_id,
    latest.source_id,
    latest.source_slug,
    latest.marketplace_url,
    latest.lowest_price,
    latest.average_price,
    latest.highest_price,
    latest.listing_count,
    latest.currency,
    latest.observed_at
  from (
    select distinct on (o.event_id, o.source_id)
      o.event_id,
      o.source_id,
      s.slug as source_slug,
      o.marketplace_url,
      o.lowest_price,
      o.average_price,
      o.highest_price,
      o.listing_count,
      o.currency,
      o.observed_at
    from public.market_price_observations o
    join public.sources s on s.id = o.source_id
    where s.active
    order by o.event_id, o.source_id, o.observed_at desc, o.created_at desc
  ) latest
  where latest.observed_at > now() - interval '72 hours'
    and latest.listing_count > 0
    and latest.lowest_price is not null;

revoke all on public.market_prices_current from public, anon, authenticated;
grant select on public.market_prices_current to anon, authenticated;
