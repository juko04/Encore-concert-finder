-- Migration: 20261124030000_cleanup_ticket_package_listings.sql
-- Description: Ticketmaster lists seat/VIP/parking PRODUCTS next to real shows, e.g. the event
-- "Club Level Seating: Nickelback" with an attraction "Club Level Seating: Ball Arena". Earlier
-- ingests stored those attractions as artists and the package title as the show title.
--   1. Unlink package pseudo-artists from events and delete them when nothing else uses them.
--   2. Strip the package prefix from canonical event titles ("Club Level Seating: Nickelback" ->
--      "Nickelback"); a later sync upgrades it to the real tour title when Ticketmaster lists it.
-- The ingestion parser (lib/sources/ticketmaster/listing-filters.ts) now prevents new rows.
-- Raw ingests and candidates are immutable audit records and are NOT touched.
-- Idempotent: safe to run more than once.

do $$
declare
  package_prefix constant text :=
    '^\s*(club(\s+level)?\s+seat(s|ing)|premium\s+seat(s|ing)|vip(\s+(package|packages|experience|upgrade|ticket|tickets|parking|seating|lounge))?|parking|hospitality|suites?|loges?|meet\s*(&|and)\s*greet|fast\s*lane|ticket\s+package)\s*[:\-–—]\s*';
begin
  -- 1. Unlink and remove package pseudo-artists.
  delete from public.event_artists ea
  using public.artists a
  where ea.artist_id = a.id
    and a.name ~* package_prefix;

  delete from public.artists a
  where a.name ~* package_prefix
    and not exists (select 1 from public.event_artists ea where ea.artist_id = a.id)
    and not exists (
      select 1 from public.user_artist_preferences p where p.artist_id = a.id
    );

  -- 2. Strip the package prefix from event titles.
  update public.events e
  set name = btrim(regexp_replace(e.name, package_prefix, '', 'i')),
      normalized_name = btrim(
        regexp_replace(lower(regexp_replace(e.name, package_prefix, '', 'i')), '[^a-z0-9]+', ' ', 'g')
      ),
      updated_at = now()
  where e.name ~* package_prefix
    and btrim(regexp_replace(e.name, package_prefix, '', 'i')) <> '';
end
$$;
