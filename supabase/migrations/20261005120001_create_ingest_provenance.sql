-- Migration: 20261005120001_create_ingest_provenance.sql
-- Description: Creates ingest provenance tables (raw_ingests, event_candidates, event_sources, event_field_evidence, candidate_resolutions) and atomic canonicalization transaction function.

-- 1. Raw Ingests (Immutable crawl observations)
create table if not exists public.raw_ingests (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  source_url text not null,
  acquisition_method text not null,
  fetched_at timestamptz not null default now(),
  content_hash text not null,
  content_type text not null default 'application/json',
  raw_content text,
  payload jsonb,
  external_storage_ref text,
  http_status integer not null default 200,
  parser_version text not null default '1.0.0',
  created_at timestamptz not null default now()
);

create index if not exists idx_raw_ingests_content_hash on public.raw_ingests (content_hash);
create index if not exists idx_raw_ingests_source on public.raw_ingests (source_id);

-- 2. Event Candidates (Extracted intermediate candidates awaiting resolution)
create table if not exists public.event_candidates (
  id uuid primary key default gen_random_uuid(),
  raw_ingest_id uuid references public.raw_ingests(id) on delete set null,
  source_id uuid not null references public.sources(id) on delete cascade,
  source_event_id text,
  source_type text not null,
  acquisition_method text not null,
  source_url text not null,
  content_hash text not null default '',
  fetched_at timestamptz not null default now(),
  title text not null,
  artist_names text[] not null default '{}',
  venue_name text not null,
  city text,
  state text,
  country text default 'US',
  timezone text,
  local_start_date date,
  local_end_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  start_time_precision text not null default 'instant',
  doors_open_at timestamptz,
  ticket_url text,
  price jsonb,
  is_festival boolean not null default false,
  confidence numeric not null default 0.8,
  verification_status text not null default 'unverified',
  parser_version text not null default '1.0.0',
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_event_candidates_raw_ingest on public.event_candidates (raw_ingest_id);
create index if not exists idx_event_candidates_source on public.event_candidates (source_id);
create index if not exists idx_event_candidates_source_event_id on public.event_candidates (source_id, source_event_id);

-- 3. Event Sources (Provenance links between canonical events and sources)
create table if not exists public.event_sources (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  candidate_id uuid references public.event_candidates(id) on delete set null,
  raw_ingest_id uuid references public.raw_ingests(id) on delete set null,
  source_event_id text,
  source_url text not null,
  confidence numeric not null default 0.8,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_event_source unique (event_id, source_id, source_event_id)
);

create index if not exists idx_event_sources_event on public.event_sources (event_id);

-- 4. Event Field Evidence (Field-level observation provenance)
create table if not exists public.event_field_evidence (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  field_name text not null,
  event_source_id uuid references public.event_sources(id) on delete set null,
  source_id uuid not null references public.sources(id) on delete cascade,
  raw_ingest_id uuid references public.raw_ingests(id) on delete set null,
  candidate_id uuid references public.event_candidates(id) on delete set null,
  observed_value jsonb,
  value_hash text not null,
  confidence numeric not null default 0.8,
  observed_at timestamptz not null default now(),
  parser_version text not null default '1.0.0',
  created_at timestamptz not null default now()
);

create index if not exists idx_event_field_evidence_event on public.event_field_evidence (event_id);
create index if not exists idx_event_field_evidence_candidate on public.event_field_evidence (candidate_id);

-- 5. Candidate Resolutions (Resolution decisions and matcher explanations)
create table if not exists public.candidate_resolutions (
  id uuid primary key default gen_random_uuid(),
  event_candidate_id uuid not null references public.event_candidates(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  status text not null check (status in ('created', 'matched', 'needs_review', 'rejected')),
  matcher_version text not null default '1.0.0',
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  reasons jsonb not null default '[]'::jsonb,
  resolved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_candidate_resolutions_candidate on public.candidate_resolutions (event_candidate_id);
create index if not exists idx_candidate_resolutions_event on public.candidate_resolutions (event_id);

-- 6. Atomic Canonicalization Transaction Function
-- Ensures that canonical events, artist links, ticket links, source links, field evidence,
-- and resolution are committed atomically in a single PostgreSQL transaction.
create or replace function public.apply_canonicalization(payload jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_event_data jsonb;
  v_event_id uuid;
  v_artist_item jsonb;
  v_ticket_item jsonb;
  v_source_item jsonb;
  v_evidence_item jsonb;
  v_res_item jsonb;
  v_source_record_id uuid;
  v_existing_event boolean := false;
begin
  v_event_data := payload->'event';
  
  -- If event is defined, create or update canonical event
  if v_event_data is not null and v_event_data != 'null'::jsonb then
    if v_event_data->>'id' is not null then
      v_event_id := (v_event_data->>'id')::uuid;
      v_existing_event := true;
      
      update public.events set
        name = coalesce(v_event_data->>'name', name),
        normalized_name = coalesce(v_event_data->>'normalized_name', normalized_name),
        event_kind = coalesce(v_event_data->>'event_kind', event_kind),
        status = coalesce(v_event_data->>'status', status),
        venue_id = coalesce((v_event_data->>'venue_id')::uuid, venue_id),
        city = coalesce(v_event_data->>'city', city),
        region = coalesce(v_event_data->>'region', region),
        country_code = coalesce(v_event_data->>'country_code', country_code),
        timezone = coalesce(v_event_data->>'timezone', timezone),
        local_start_date = coalesce((v_event_data->>'local_start_date')::date, local_start_date),
        local_end_date = coalesce((v_event_data->>'local_end_date')::date, local_end_date),
        starts_at = coalesce((v_event_data->>'starts_at')::timestamptz, starts_at),
        ends_at = coalesce((v_event_data->>'ends_at')::timestamptz, ends_at),
        start_time_precision = coalesce(v_event_data->>'start_time_precision', start_time_precision),
        doors_at = coalesce((v_event_data->>'doors_at')::timestamptz, doors_at),
        is_multi_day = coalesce((v_event_data->>'is_multi_day')::boolean, is_multi_day),
        official_url = coalesce(v_event_data->>'official_url', official_url),
        primary_ticket_url = coalesce(v_event_data->>'primary_ticket_url', primary_ticket_url),
        updated_at = now()
      where id = v_event_id;
    else
      insert into public.events (
        name,
        normalized_name,
        event_kind,
        status,
        venue_id,
        city,
        region,
        country_code,
        timezone,
        local_start_date,
        local_end_date,
        starts_at,
        ends_at,
        start_time_precision,
        doors_at,
        is_multi_day,
        official_url,
        primary_ticket_url
      ) values (
        v_event_data->>'name',
        v_event_data->>'normalized_name',
        coalesce(v_event_data->>'event_kind', 'concert'),
        coalesce(v_event_data->>'status', 'scheduled'),
        (v_event_data->>'venue_id')::uuid,
        v_event_data->>'city',
        v_event_data->>'region',
        coalesce(v_event_data->>'country_code', 'US'),
        v_event_data->>'timezone',
        (v_event_data->>'local_start_date')::date,
        (v_event_data->>'local_end_date')::date,
        (v_event_data->>'starts_at')::timestamptz,
        (v_event_data->>'ends_at')::timestamptz,
        coalesce(v_event_data->>'start_time_precision', 'instant'),
        (v_event_data->>'doors_at')::timestamptz,
        coalesce((v_event_data->>'is_multi_day')::boolean, false),
        v_event_data->>'official_url',
        v_event_data->>'primary_ticket_url'
      )
      returning id into v_event_id;
    end if;

    -- Upsert Event Artists
    if payload->'artists' is not null and jsonb_array_length(payload->'artists') > 0 then
      for v_artist_item in select * from jsonb_array_elements(payload->'artists') loop
        insert into public.event_artists (
          event_id,
          artist_id,
          billing_position,
          sort_order
        ) values (
          v_event_id,
          (v_artist_item->>'artist_id')::uuid,
          coalesce(v_artist_item->>'billing_position', 'unknown'),
          coalesce((v_artist_item->>'sort_order')::integer, 0)
        )
        on conflict (event_id, artist_id) do update set
          billing_position = excluded.billing_position,
          sort_order = excluded.sort_order;
      end loop;
    end if;

    -- Upsert Event Ticket Links
    if payload->'ticketLinks' is not null and jsonb_array_length(payload->'ticketLinks') > 0 then
      for v_ticket_item in select * from jsonb_array_elements(payload->'ticketLinks') loop
        insert into public.event_ticket_links (
          event_id,
          ticket_provider_source_id,
          url,
          normalized_url,
          min_price,
          max_price,
          currency,
          inventory_status,
          verified_at
        ) values (
          v_event_id,
          (v_ticket_item->>'ticket_provider_source_id')::uuid,
          v_ticket_item->>'url',
          v_ticket_item->>'normalized_url',
          (v_ticket_item->>'min_price')::numeric,
          (v_ticket_item->>'max_price')::numeric,
          v_ticket_item->>'currency',
          coalesce(v_ticket_item->>'inventory_status', 'available'),
          coalesce((v_ticket_item->>'verified_at')::timestamptz, now())
        )
        on conflict (event_id, normalized_url) do update set
          min_price = coalesce(excluded.min_price, event_ticket_links.min_price),
          max_price = coalesce(excluded.max_price, event_ticket_links.max_price),
          currency = coalesce(excluded.currency, event_ticket_links.currency),
          inventory_status = excluded.inventory_status,
          updated_at = now();
      end loop;
    end if;

    -- Upsert Event Sources
    v_source_item := payload->'source';
    if v_source_item is not null and v_source_item != 'null'::jsonb then
      insert into public.event_sources (
        event_id,
        source_id,
        candidate_id,
        raw_ingest_id,
        source_event_id,
        source_url,
        confidence,
        first_seen_at,
        last_seen_at,
        is_current
      ) values (
        v_event_id,
        (v_source_item->>'source_id')::uuid,
        (v_source_item->>'candidate_id')::uuid,
        (v_source_item->>'raw_ingest_id')::uuid,
        v_source_item->>'source_event_id',
        v_source_item->>'source_url',
        coalesce((v_source_item->>'confidence')::numeric, 0.8),
        now(),
        now(),
        true
      )
      on conflict (event_id, source_id, source_event_id) do update set
        candidate_id = excluded.candidate_id,
        raw_ingest_id = excluded.raw_ingest_id,
        confidence = excluded.confidence,
        last_seen_at = now(),
        updated_at = now()
      returning id into v_source_record_id;
    end if;

    -- Insert Field Evidence
    if payload->'evidence' is not null and jsonb_array_length(payload->'evidence') > 0 then
      for v_evidence_item in select * from jsonb_array_elements(payload->'evidence') loop
        insert into public.event_field_evidence (
          event_id,
          field_name,
          event_source_id,
          source_id,
          raw_ingest_id,
          candidate_id,
          observed_value,
          value_hash,
          confidence,
          observed_at,
          parser_version
        ) values (
          v_event_id,
          v_evidence_item->>'field_name',
          v_source_record_id,
          (v_evidence_item->>'source_id')::uuid,
          (v_evidence_item->>'raw_ingest_id')::uuid,
          (v_evidence_item->>'candidate_id')::uuid,
          v_evidence_item->'observed_value',
          coalesce(v_evidence_item->>'value_hash', md5(coalesce(v_evidence_item->>'observed_value', ''))),
          coalesce((v_evidence_item->>'confidence')::numeric, 0.8),
          coalesce((v_evidence_item->>'observed_at')::timestamptz, now()),
          coalesce(v_evidence_item->>'parser_version', '1.0.0')
        );
      end loop;
    end if;
  end if;

  -- Insert Resolution
  v_res_item := payload->'resolution';
  if v_res_item is not null and v_res_item != 'null'::jsonb then
    insert into public.candidate_resolutions (
      event_candidate_id,
      event_id,
      status,
      matcher_version,
      confidence,
      reasons,
      resolved_at
    ) values (
      (v_res_item->>'event_candidate_id')::uuid,
      v_event_id,
      v_res_item->>'status',
      coalesce(v_res_item->>'matcher_version', '1.0.0'),
      (v_res_item->>'confidence')::numeric,
      coalesce(v_res_item->'reasons', '[]'::jsonb),
      now()
    );
  end if;

  return jsonb_build_object(
    'eventId', v_event_id,
    'status', coalesce(v_res_item->>'status', 'created')
  );
end;
$$;

