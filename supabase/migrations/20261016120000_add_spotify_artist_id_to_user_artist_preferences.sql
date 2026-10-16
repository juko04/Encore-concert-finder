-- Migration: 20261016120000_add_spotify_artist_id_to_user_artist_preferences.sql
-- Description: Adds durable spotify_artist_id to user_artist_preferences,
-- enabling user-owned provider identity preservation, safe artist disambiguation,
-- and preventing same-name collisions for distinct Spotify acts.

alter table public.user_artist_preferences
  add column if not exists spotify_artist_id text null;

create index if not exists idx_user_artist_prefs_spotify_artist_id
  on public.user_artist_preferences (spotify_artist_id)
  where spotify_artist_id is not null;

-- Unique constraint: A user can only have one preference for a given Spotify artist ID
create unique index if not exists idx_user_artist_prefs_user_spotify
  on public.user_artist_preferences (user_id, spotify_artist_id)
  where spotify_artist_id is not null;

-- Update uncataloged unique index to apply only to non-Spotify uncataloged preferences
drop index if exists public.idx_user_artist_prefs_user_unresolved;
create unique index idx_user_artist_prefs_user_unresolved
  on public.user_artist_preferences (user_id, normalized_artist_name)
  where artist_id is null and archived_artist_id is null and spotify_artist_id is null;

