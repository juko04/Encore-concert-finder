-- Migration: 20261124020000_add_artist_weight_to_profiles.sql
-- Description: Adds an optional per-user "artist importance" weight (percent) to public.profiles.
-- When set, the recommendation engine gives artist fit this share of the composite score and splits
-- the remainder between distance and price using the active preset's ratio. NULL means "use the
-- preset's own artist weight". Bounded so artist fit can never be fully ignored or fully dominate
-- (explicit-preference suppression rules are unaffected by this weight).
-- Safe to run more than once (idempotent). Covered by existing row-level security on public.profiles.

alter table public.profiles
  add column if not exists artist_weight smallint null;

alter table public.profiles
  drop constraint if exists profiles_artist_weight_check;

alter table public.profiles
  add constraint profiles_artist_weight_check
  check (artist_weight is null or (artist_weight >= 20 and artist_weight <= 80));
