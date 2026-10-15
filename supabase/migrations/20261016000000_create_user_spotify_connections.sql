-- Migration: 20261016000000_create_user_spotify_connections.sql
-- Description: Establishes secure storage for Spotify OAuth connection tokens with zero-client RLS.
-- Invariant: One-to-one relationship between Spotify account and Encore user (UNIQUE on spotify_account_id).
-- Invariant: Sensitive token material is encrypted at rest and never accessible to client-facing Supabase queries.

-- 1. Create connection status enum if not exists
do $$
begin
  if not exists (select 1 from pg_type where typname = 'spotify_connection_status') then
    create type public.spotify_connection_status as enum (
      'connected',
      'expired',
      'disconnected',
      'revoked'
    );
  end if;
end $$;

-- 2. Create user_spotify_connections table
create table if not exists public.user_spotify_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  spotify_account_id text not null,
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  token_expires_at timestamptz not null,
  reauthorization_deadline timestamptz not null,
  scopes text[] not null,
  status public.spotify_connection_status not null default 'connected',
  last_synced_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Validation: IDs and encrypted payload must not be empty strings
  constraint check_spotify_account_id_non_empty check (length(trim(spotify_account_id)) > 0),
  constraint check_encrypted_access_token_non_empty check (length(trim(encrypted_access_token)) > 0),
  constraint check_encrypted_refresh_token_non_empty check (length(trim(encrypted_refresh_token)) > 0)
);

-- 3. Enforce strict one-to-one constraint:
-- A single Spotify account cannot be silently linked to multiple Encore accounts.
create unique index if not exists idx_user_spotify_connections_account_id
  on public.user_spotify_connections (spotify_account_id);

-- 4. Enable Row Level Security
alter table public.user_spotify_connections enable row level security;

-- 5. Zero-Client RLS Policy:
-- Deliberately create NO select, insert, update, or delete policies for 'authenticated' or 'anon'.
-- Regular users connecting via the browser-side Supabase client will receive 0 rows / access denied.
-- Access is restricted strictly to trusted backend server functions executing with service_role.

