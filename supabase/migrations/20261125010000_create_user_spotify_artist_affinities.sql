-- Migration: 20261125010000_create_user_spotify_artist_affinities.sql
-- Description: Durable per-user snapshot of Spotify-derived artist rankings/affinities.
-- Invariant: Spotify-imported listening signals and manual preferences persist after disconnect,
--   token expiry/revocation, or developer-allowlist removal. Disconnect deletes ONLY
--   user_spotify_connections (tokens); it must never delete rows here or in user_artist_preferences.
-- Invariant: Account deletion (auth.users) cascades to ALL private rows via ON DELETE CASCADE.
-- Invariant: Canonical artist deletion nulls canonical_artist_id (ON DELETE SET NULL), never the row.

create table if not exists public.user_spotify_artist_affinities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  spotify_artist_id text not null,
  artist_name text not null,
  canonical_artist_id uuid null references public.artists(id) on delete set null,
  rank integer not null check (rank >= 1),
  ranks_by_range jsonb not null default '{}'::jsonb,
  affinity numeric null check (affinity is null or (affinity >= 0 and affinity <= 1)),
  affinity_reason text null,
  trend text null check (trend is null or trend in ('rising', 'consistent', 'fading')),
  popularity integer not null default 0,
  genres text[] not null default '{}',
  image_url text null,
  spotify_url text null,
  source text not null default 'spotify',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint check_spotify_affinity_artist_id_non_empty check (length(trim(spotify_artist_id)) > 0),
  constraint check_spotify_affinity_name_non_empty check (length(trim(artist_name)) > 0),
  constraint check_spotify_affinity_source check (source = 'spotify')
);

create unique index if not exists idx_user_spotify_affinities_user_artist
  on public.user_spotify_artist_affinities (user_id, spotify_artist_id);

create index if not exists idx_user_spotify_affinities_user_rank
  on public.user_spotify_artist_affinities (user_id, rank);

create index if not exists idx_user_spotify_affinities_canonical
  on public.user_spotify_artist_affinities (canonical_artist_id)
  where canonical_artist_id is not null;

alter table public.user_spotify_artist_affinities enable row level security;

-- Users may read and delete (clear) their own stored listening snapshot.
-- Writes happen only from trusted server code using service_role (which bypasses RLS).
create policy "Users can select own spotify affinities"
  on public.user_spotify_artist_affinities
  for select
  using (auth.uid() = user_id);

create policy "Users can delete own spotify affinities"
  on public.user_spotify_artist_affinities
  for delete
  using (auth.uid() = user_id);
