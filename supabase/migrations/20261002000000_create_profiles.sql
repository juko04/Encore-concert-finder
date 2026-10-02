-- Phase 0: Initial profile and private user data boundary
-- Establishes public.profiles referencing auth.users(id) with RLS.
-- No product inventory schema or automatic profile creation triggers are included in Phase 0.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  home_lat_approx double precision null,
  home_lng_approx double precision null,
  default_radius_miles integer null default 25,
  max_spontaneous_price numeric null,
  max_normal_ticket_price numeric null,
  max_favorite_artist_price numeric null,
  travel_willingness text null
);

-- Enable Row Level Security
alter table public.profiles enable row level security;

-- Policies: users may select, insert, and update only their own profile row
create policy "Users can select own profile"
  on public.profiles
  for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles
  for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
