-- Multi-day festivals are ingested as one event row per day / ticket day. Listing them all
-- floods search and Discover, so each run of consecutive days at one venue is presented as a
-- single card: the first day is the group's primary, the rest are hidden from list views
-- (collapseFestivalDays filter) but stay as full canonical events (detail page, calendar,
-- provenance and scoring are untouched). Non-destructive: only these four presentation columns
-- are written; no event, source or evidence row is merged, deleted or mutated otherwise.
--
-- A group is: same venue, same base name (day / night / weekday suffixes stripped), each day
-- starting within 3 days of the previous day's end, spanning at least two calendar days, and either
-- (a) at least one day is classified as a festival (or explicitly named "Fest" / "Festival"), or
-- (b) the run is 3+ consecutive days (gap <= 1) - big festivals such as EDC are ingested as plain
-- concerts. Weekly club nights and series never chain (gap 7), and 2-night band stands and
-- same-day doubleheaders stay separate cards.

alter table public.events
  add column if not exists festival_group_id uuid null,
  add column if not exists festival_group_primary boolean not null default true,
  add column if not exists festival_group_size integer not null default 1,
  add column if not exists festival_group_end_date date null;

create index if not exists events_festival_group_primary_idx
  on public.events (local_start_date)
  where festival_group_primary;

create index if not exists events_festival_group_id_idx
  on public.events (festival_group_id)
  where festival_group_id is not null;

create or replace function public.refresh_festival_groups()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  grouped integer;
begin
  update public.events
     set festival_group_id = null,
         festival_group_primary = true,
         festival_group_size = 1,
         festival_group_end_date = null
   where festival_group_id is not null
      or not festival_group_primary
      or festival_group_size <> 1
      or festival_group_end_date is not null;

  with raw_cand as (
    select id,
           venue_id,
           lower(name) as lower_name,
           regexp_replace(
             lower(name),
             '\s*[-–:(]*\s*\m((day|night)\s*\d+|(thurs|fri|satur|sun)day)\M.*$',
             ''
           ) as stripped_name,
           local_start_date,
           coalesce(local_end_date, local_start_date) as end_date,
           (
             event_kind in ('festival', 'multi_day_festival')
             or lower(name) ~ '\m(fest|festival)\M'
           ) as is_festival
      from public.events
     where venue_id is not null
       and status <> 'cancelled'
  ), cand as (
    select id,
           venue_id,
           case when btrim(stripped_name) <> '' then stripped_name else lower_name end as base_name,
           local_start_date,
           end_date,
           is_festival
      from raw_cand
  ), ord as (
    select *,
           lag(end_date) over w as prev_end
      from cand
    window w as (partition by venue_id, base_name order by local_start_date, id)
  ), isl as (
    select *,
           sum(case when prev_end is null or local_start_date - prev_end > 3
                    then 1 else 0 end)
             over (partition by venue_id, base_name order by local_start_date, id) as island
      from ord
  ), grp as (
    select id,
           first_value(id) over w as primary_id,
           count(*) over (partition by venue_id, base_name, island) as size,
           min(local_start_date) over (partition by venue_id, base_name, island) as group_start,
           max(end_date) over (partition by venue_id, base_name, island) as group_end,
           bool_or(is_festival) over (partition by venue_id, base_name, island) as any_festival,
           max(case when prev_end is null or local_start_date - prev_end > 3
                    then 0 else local_start_date - prev_end end)
             over (partition by venue_id, base_name, island) as max_gap
      from isl
    window w as (partition by venue_id, base_name, island order by local_start_date, id)
  )
  update public.events e
     set festival_group_id = g.primary_id,
         festival_group_primary = (e.id = g.primary_id),
         festival_group_size = g.size,
         festival_group_end_date = g.group_end
    from grp g
   where e.id = g.id
     and g.size > 1
     and g.group_end > g.group_start
     and (g.any_festival or (g.size >= 3 and g.max_gap <= 1));

  get diagnostics grouped = row_count;
  return grouped;
end;
$$;

revoke all on function public.refresh_festival_groups() from public, anon, authenticated;
grant execute on function public.refresh_festival_groups() to service_role;

select public.refresh_festival_groups();
