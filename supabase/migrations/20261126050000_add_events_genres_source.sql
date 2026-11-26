-- Migration: 20261126050000_add_events_genres_source.sql
-- Description: Records where an event's genres came from, so inferred genres are never presented
-- as official source data. NULL means the genres (if any) were supplied by the ingested source
-- itself (e.g. Ticketmaster classifications). Other values are written by lib/genres:
--   'inferred_title'          keyword rules on the show title (lib/genres/infer.ts)
--   'ticketmaster_attraction' exact-name Ticketmaster attraction lookup for the headliner
-- Fill-if-empty semantics are enforced by CatalogRepository.fillEventGenres. Idempotent.

alter table public.events
  add column if not exists genres_source text null;
