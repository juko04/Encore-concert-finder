-- Migration: 20261120000000_add_event_pricing_and_search_indexes.sql
-- Description: Adds min_price, max_price, and currency directly to public.events,
-- sets up triggers on event_ticket_links to maintain rollups automatically,
-- backfills existing events, and adds price and search indexes for global pagination.

-- 1. Add pricing columns to public.events
alter table public.events
  add column if not exists min_price numeric(12,2) check (min_price is null or min_price >= 0),
  add column if not exists max_price numeric(12,2) check (max_price is null or max_price >= 0),
  add column if not exists currency text check (currency is null or length(currency) = 3);

-- 2. Trigger function to maintain price rollups on public.events
create or replace function public.fn_maintain_event_pricing()
returns trigger
language plpgsql
security definer
as $$
declare
  v_event_id uuid;
  v_old_event_id uuid;
begin
  if (tg_op = 'INSERT' or tg_op = 'UPDATE') then
    v_event_id := NEW.event_id;
  end if;
  if (tg_op = 'DELETE' or (tg_op = 'UPDATE' and OLD.event_id <> NEW.event_id)) then
    v_old_event_id := OLD.event_id;
  end if;

  if v_event_id is not null then
    update public.events e
    set
      min_price = case
        when e.event_kind = 'free_event' then 0
        else (
          select min(tl.min_price)
          from public.event_ticket_links tl
          where tl.event_id = v_event_id
            and tl.min_price is not null
        )
      end,
      max_price = (
        select max(tl.max_price)
        from public.event_ticket_links tl
        where tl.event_id = v_event_id
          and tl.max_price is not null
      ),
      currency = coalesce(
        (
          select tl.currency
          from public.event_ticket_links tl
          where tl.event_id = v_event_id
            and tl.currency is not null
          order by tl.created_at asc
          limit 1
        ),
        e.currency
      )
    where e.id = v_event_id;
  end if;

  if v_old_event_id is not null then
    update public.events e
    set
      min_price = case
        when e.event_kind = 'free_event' then 0
        else (
          select min(tl.min_price)
          from public.event_ticket_links tl
          where tl.event_id = v_old_event_id
            and tl.min_price is not null
        )
      end,
      max_price = (
        select max(tl.max_price)
        from public.event_ticket_links tl
        where tl.event_id = v_old_event_id
          and tl.max_price is not null
      ),
      currency = (
        select tl.currency
        from public.event_ticket_links tl
        where tl.event_id = v_old_event_id
          and tl.currency is not null
        order by tl.created_at asc
        limit 1
      )
    where e.id = v_old_event_id;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_maintain_event_pricing on public.event_ticket_links;
create trigger trg_maintain_event_pricing
after insert or update or delete on public.event_ticket_links
for each row
execute function public.fn_maintain_event_pricing();

-- 3. Trigger on public.events to default free_event min_price to 0
create or replace function public.fn_sync_free_event_pricing()
returns trigger
language plpgsql
as $$
begin
  if NEW.event_kind = 'free_event' and NEW.min_price is null then
    NEW.min_price := 0;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_sync_free_event_pricing on public.events;
create trigger trg_sync_free_event_pricing
before insert or update of event_kind on public.events
for each row
execute function public.fn_sync_free_event_pricing();

-- 4. Backfill existing events
update public.events e
set
  min_price = case
    when e.event_kind = 'free_event' then coalesce(rollup.min_p, 0)
    else rollup.min_p
  end,
  max_price = rollup.max_p,
  currency = rollup.curr
from (
  select
    event_id,
    min(min_price) as min_p,
    max(max_price) as max_p,
    (array_agg(currency) filter (where currency is not null))[1] as curr
  from public.event_ticket_links
  group by event_id
) rollup
where e.id = rollup.event_id;

update public.events
set min_price = 0
where event_kind = 'free_event' and min_price is null;

-- 5. Indexes for pricing, sorting, and multi-field text search
create index if not exists idx_events_min_price on public.events (min_price);
create index if not exists idx_events_local_start_date_min_price on public.events (local_start_date, min_price);
create index if not exists idx_events_normalized_name on public.events (normalized_name);
create index if not exists idx_events_name on public.events (name);

create extension if not exists pg_trgm;
create index if not exists idx_events_name_trgm on public.events using gin (name gin_trgm_ops);
create index if not exists idx_artists_name_trgm on public.artists using gin (name gin_trgm_ops);
create index if not exists idx_venues_name_trgm on public.venues using gin (name gin_trgm_ops);
