-- Migration: 20261126060000_fix_10_mile_music_hall_venue.sql
-- Description: The Z2 feed sells shows for 10 Mile Music Hall (Frisco) but the parser applied its
-- default city (Boulder), creating a second, wrongly-located venue row that also hid cross-source
-- duplicates (a show listed by Z2 and by the venue's own site). The parser now knows the venue
-- (lib/sources/venue/z2-entertainment/types.ts). This moves events from the wrongly-located row
-- to the correct Frisco row and removes the row once nothing references it.
-- Idempotent: does nothing when the Frisco row does not exist or the wrong row is already gone.

do $$
declare
  v_right uuid;
begin
  select id into v_right
  from public.venues
  where normalized_name = '10 mile music hall' and city = 'Frisco'
  order by created_at
  limit 1;

  if v_right is null then
    return;
  end if;

  update public.events
  set venue_id = v_right,
      city = 'Frisco',
      region = 'CO',
      updated_at = now()
  where venue_id in (
    select id from public.venues
    where normalized_name = '10 mile music hall' and city = 'Boulder'
  );

  delete from public.venues v
  where v.normalized_name = '10 mile music hall'
    and v.city = 'Boulder'
    and not exists (select 1 from public.events e where e.venue_id = v.id);
end
$$;
