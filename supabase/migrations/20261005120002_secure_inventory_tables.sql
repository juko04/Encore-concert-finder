-- Migration: 20261005120002_secure_inventory_tables.sql
-- Description: Enables RLS across inventory and provenance tables.
-- Grants read-only access for public catalog tables; restricts operational and provenance tables to service_role.

-- 1. Enable RLS on catalog reference tables
alter table public.sources enable row level security;
alter table public.artists enable row level security;
alter table public.artist_external_ids enable row level security;
alter table public.artist_aliases enable row level security;
alter table public.venues enable row level security;
alter table public.venue_aliases enable row level security;
alter table public.promoters enable row level security;
alter table public.events enable row level security;
alter table public.event_artists enable row level security;
alter table public.event_promoters enable row level security;
alter table public.event_ticket_links enable row level security;

-- 2. Enable RLS on operational and provenance tables
alter table public.raw_ingests enable row level security;
alter table public.event_candidates enable row level security;
alter table public.event_sources enable row level security;
alter table public.event_field_evidence enable row level security;
alter table public.candidate_resolutions enable row level security;

-- 3. Public read policies for catalog tables
create policy "Allow public read on artists"
  on public.artists for select
  using (true);

create policy "Allow public read on artist_external_ids"
  on public.artist_external_ids for select
  using (true);

create policy "Allow public read on artist_aliases"
  on public.artist_aliases for select
  using (true);

create policy "Allow public read on venues"
  on public.venues for select
  using (true);

create policy "Allow public read on venue_aliases"
  on public.venue_aliases for select
  using (true);

create policy "Allow public read on promoters"
  on public.promoters for select
  using (true);

create policy "Allow public read on events"
  on public.events for select
  using (true);

create policy "Allow public read on event_artists"
  on public.event_artists for select
  using (true);

create policy "Allow public read on event_promoters"
  on public.event_promoters for select
  using (true);

create policy "Allow public read on event_ticket_links"
  on public.event_ticket_links for select
  using (true);

-- 4. Source table access control (Finding 10)
-- The underlying sources table contains operational health, retry counts, and reliability scores.
-- Direct table access is restricted to service_role; safe public view public_sources is exposed.
grant select on public.public_sources to anon, authenticated;

-- Operational and provenance tables (raw_ingests, event_candidates, event_sources,
-- event_field_evidence, candidate_resolutions) have RLS enabled with NO public policies,
-- restricting all direct read/write operations exclusively to service_role.

