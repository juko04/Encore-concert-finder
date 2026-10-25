-- Phase 2: Add recommendation preset to public.profiles
-- Supports 4 fixed priority presets: balanced, artist_first, nearby, value

alter table public.profiles
  add column if not exists recommendation_preset text not null default 'balanced',
  add constraint chk_recommendation_preset check (
    recommendation_preset in ('balanced', 'artist_first', 'nearby', 'value')
  );

