-- Migration: 20261014000000_create_user_artist_preferences.sql
-- Description: Establishes explicit user artist preferences with RLS, audit timestamps, and catalog independence.
-- Invariant: Deleting or retiring a canonical artist must NOT delete user preferences (ON DELETE SET NULL).
-- Invariant: Explicit manual preferences are isolated from Spotify listening signals (handled in PR 4B).

-- 1. Create preference_level enum
do $$
begin
  if not exists (select 1 from pg_type where typname = 'preference_level') then
    create type public.preference_level as enum (
      'favorite',
      'like',
      'interested',
      'dislike'
    );
  end if;
end $$;

-- 2. Create user_artist_preferences table
create table if not exists public.user_artist_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid null references public.artists(id) on delete set null,
  archived_artist_id uuid null,
  artist_name text not null,
  normalized_artist_name text not null,
  preference_level public.preference_level not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Validation: names must not be empty or whitespace only
  constraint check_artist_name_non_empty check (length(trim(artist_name)) > 0),
  constraint check_normalized_artist_name_non_empty check (length(trim(normalized_artist_name)) > 0)
);

-- 3. Indexes for fast user queries and canonical artist lookups
create index if not exists idx_user_artist_prefs_user_id
  on public.user_artist_preferences (user_id);

create index if not exists idx_user_artist_prefs_artist_id
  on public.user_artist_preferences (artist_id)
  where artist_id is not null;

create index if not exists idx_user_artist_prefs_archived_artist_id
  on public.user_artist_preferences (archived_artist_id)
  where archived_artist_id is not null;

create index if not exists idx_user_artist_prefs_normalized_name
  on public.user_artist_preferences (user_id, normalized_artist_name);

-- 4. Uniqueness constraints preventing duplicate preference rows per user
-- 4a. A user can have only one preference for a given active canonical artist
create unique index if not exists idx_user_artist_prefs_user_canonical
  on public.user_artist_preferences (user_id, artist_id)
  where artist_id is not null;

-- 4b. A user can have only one preference for a given purely uncataloged artist name
create unique index if not exists idx_user_artist_prefs_user_unresolved
  on public.user_artist_preferences (user_id, normalized_artist_name)
  where artist_id is null and archived_artist_id is null;

-- 4c. A user can have only one preference for a given formerly-canonical archived artist
create unique index if not exists idx_user_artist_prefs_user_archived
  on public.user_artist_preferences (user_id, archived_artist_id)
  where archived_artist_id is not null;

-- 5. Trigger on canonical artist deletion:
-- When a canonical artist is deleted, archive the artist ID before foreign key nullification
-- to prevent collisions with uncataloged artist preferences sharing the same name.
create or replace function public.handle_canonical_artist_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.user_artist_preferences
  set archived_artist_id = OLD.id,
      artist_id = null
  where artist_id = OLD.id;
  return OLD;
end;
$$;

drop trigger if exists trg_handle_canonical_artist_deletion on public.artists;
create trigger trg_handle_canonical_artist_deletion
  before delete on public.artists
  for each row
  execute function public.handle_canonical_artist_deletion();

-- 6. Enable Row Level Security
alter table public.user_artist_preferences enable row level security;

-- 7. Strict RLS Policies: users may only select, insert, update, and delete their own rows
create policy "Users can select own artist preferences"
  on public.user_artist_preferences
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own artist preferences"
  on public.user_artist_preferences
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own artist preferences"
  on public.user_artist_preferences
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own artist preferences"
  on public.user_artist_preferences
  for delete
  using (auth.uid() = user_id);
