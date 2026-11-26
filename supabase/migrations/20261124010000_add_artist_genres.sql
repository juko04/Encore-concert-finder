-- Migration: 20261124010000_add_artist_genres.sql
-- Description: Adds Spotify-derived genre metadata to public.artists so the recommendation
-- engine can score "similar to artists you like" from real data.
--
-- Rules:
--   * Never fabricated: genres stay '{}' until a corroborated Spotify artist object supplies them.
--   * Provenance: genres_source ('spotify') and genres_updated_at record where/when they came from.
--   * Non-destructive: the enricher never overwrites non-empty genres with an empty list.
--   * Safe to run more than once (idempotent). Application reads tolerate the column not existing.

alter table public.artists add column if not exists genres text[] not null default '{}';
alter table public.artists add column if not exists genres_source text;
alter table public.artists add column if not exists genres_updated_at timestamptz;

create index if not exists artists_genres_gin_idx on public.artists using gin (genres);
