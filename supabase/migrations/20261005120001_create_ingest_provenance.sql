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
  created_at timestamptz not null default now(),
  constraint uq_raw_ingests_id_source unique (id, source_id),
  constraint uq_raw_ingests_source_url_hash unique (source_id, source_url, content_hash)
);

create index if not exists idx_raw_ingests_content_hash on public.raw_ingests (content_hash);
create index if not exists idx_raw_ingests_source on public.raw_ingests (source_id);
create index if not exists idx_raw_ingests_source_fetched on public.raw_ingests (source_id, fetched_at desc);

-- 2. Event Candidates (Extracted intermediate candidates awaiting resolution)
create table if not exists public.event_candidates (
  id uuid primary key default gen_random_uuid(),
  raw_ingest_id uuid not null,
  source_id uuid not null references public.sources(id) on delete cascade,
  source_event_id text,
  source_type text not null,
  acquisition_method text not null,
  source_url text not null,
  content_hash text not null default '',
  candidate_fingerprint text not null default '',
  fetched_at timestamptz not null default now(),
  title text not null,
  artist_names text[] not null default '{}',
  candidate_artists jsonb not null default '[]'::jsonb,
  venue_name text not null,
  city text,
  state text,
  country text,
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
  event_kind text not null default 'concert' check (event_kind in ('concert', 'club_show', 'outdoor_show', 'free_event', 'music_series', 'residency', 'festival', 'multi_day_festival')),
  confidence numeric not null default 0.8,
  verification_status text not null default 'unverified',
  parser_version text not null default '1.0.0',
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  constraint fk_event_candidates_raw_ingest_source foreign key (raw_ingest_id, source_id)
    references public.raw_ingests(id, source_id) on delete cascade,
  constraint uq_event_candidates_id_source unique (id, source_id),
  constraint uq_event_candidates_id_source_raw unique (id, source_id, raw_ingest_id)
);

create index if not exists idx_event_candidates_raw_ingest on public.event_candidates (raw_ingest_id);
create index if not exists idx_event_candidates_source on public.event_candidates (source_id);
create index if not exists idx_event_candidates_source_event_id on public.event_candidates (source_id, source_event_id);
create unique index if not exists uq_event_candidates_raw_source_event on public.event_candidates (raw_ingest_id, source_event_id) where source_event_id is not null;
create unique index if not exists uq_event_candidates_raw_fingerprint on public.event_candidates (raw_ingest_id, candidate_fingerprint) where candidate_fingerprint != '';

-- 3. Event Sources (Provenance links between canonical events and sources)
create table if not exists public.event_sources (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  candidate_id uuid,
  raw_ingest_id uuid,
  source_event_id text,
  source_url text not null,
  confidence numeric not null default 0.8,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_event_sources_raw_ingest_source foreign key (raw_ingest_id, source_id)
    references public.raw_ingests(id, source_id) on delete restrict,
  constraint fk_event_sources_candidate_source_raw foreign key (candidate_id, source_id, raw_ingest_id)
    references public.event_candidates(id, source_id, raw_ingest_id) on delete restrict
);

create unique index if not exists uq_event_sources_source_event
  on public.event_sources (source_id, source_event_id)
  where source_event_id is not null;

create unique index if not exists uq_event_sources_without_ext_id
  on public.event_sources (event_id, source_id, source_url)
  where source_event_id is null;

create index if not exists idx_event_sources_event on public.event_sources (event_id);
create index if not exists idx_event_sources_source_lookup on public.event_sources (source_id, source_event_id);
create index if not exists idx_event_sources_raw_ingest on public.event_sources (raw_ingest_id);

-- 4. Event Field Evidence (Field-level observation provenance)
create table if not exists public.event_field_evidence (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  field_name text not null,
  event_source_id uuid references public.event_sources(id) on delete set null,
  source_id uuid not null references public.sources(id) on delete cascade,
  raw_ingest_id uuid,
  candidate_id uuid,
  observed_value jsonb,
  value_hash text not null,
  confidence numeric not null default 0.8,
  observed_at timestamptz not null default now(),
  parser_version text not null default '1.0.0',
  created_at timestamptz not null default now(),
  constraint fk_event_field_evidence_raw_ingest_source foreign key (raw_ingest_id, source_id)
    references public.raw_ingests(id, source_id) on delete restrict,
  constraint fk_event_field_evidence_candidate_source_raw foreign key (candidate_id, source_id, raw_ingest_id)
    references public.event_candidates(id, source_id, raw_ingest_id) on delete restrict
);

create index if not exists idx_event_field_evidence_event on public.event_field_evidence (event_id);
create index if not exists idx_event_field_evidence_candidate on public.event_field_evidence (candidate_id);
create index if not exists idx_event_field_evidence_source on public.event_field_evidence (source_id);
create index if not exists idx_event_field_evidence_raw_ingest on public.event_field_evidence (raw_ingest_id);

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
-- Ensures that canonical venues, artists, events, artist links, ticket links, source links, field evidence,
-- and resolution are committed atomically in a single PostgreSQL transaction.
create or replace function public.apply_canonicalization(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_venue_to_create jsonb;
  v_venue_id uuid;
  v_event_data jsonb;
  v_event_id uuid;
  v_artist_item jsonb;
  v_artist_id uuid;
  v_ticket_item jsonb;
  v_source_item jsonb;
  v_evidence_item jsonb;
  v_res_item jsonb;
  v_source_record_id uuid;
  v_existing_event boolean := false;
  v_existing_event_id uuid;
  v_ext_id_item jsonb;
begin
  -- 1. Create Venue if specified in transaction payload
  v_venue_to_create := payload->'venueToCreate';
  if v_venue_to_create is not null and v_venue_to_create != 'null'::jsonb then
    insert into public.venues (
      id,
      name,
      normalized_name,
      city,
      region,
      country_code,
      timezone,
      website
    ) values (
      coalesce((v_venue_to_create->>'id')::uuid, gen_random_uuid()),
      v_venue_to_create->>'name',
      v_venue_to_create->>'normalized_name',
      v_venue_to_create->>'city',
      v_venue_to_create->>'region',
      v_venue_to_create->>'country_code',
      v_venue_to_create->>'timezone',
      v_venue_to_create->>'website'
    )
    returning id into v_venue_id;
  end if;

  v_event_data := payload->'event';
  
  -- 2. If event is defined, create or update canonical event
  if v_event_data is not null and v_event_data != 'null'::jsonb then
    if v_event_data->>'id' is not null then
      v_event_id := (v_event_data->>'id')::uuid;
      v_existing_event := true;
      
      update public.events set
        name = coalesce(v_event_data->>'name', name),
        normalized_name = coalesce(v_event_data->>'normalized_name', normalized_name),
        event_kind = coalesce(v_event_data->>'event_kind', event_kind),
        status = coalesce(v_event_data->>'status', status),
        venue_id = coalesce((v_event_data->>'venue_id')::uuid, v_venue_id, venue_id),
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
        coalesce((v_event_data->>'venue_id')::uuid, v_venue_id),
        v_event_data->>'city',
        v_event_data->>'region',
        v_event_data->>'country_code',
        v_event_data->>'timezone',
        (v_event_data->>'local_start_date')::date,
        (v_event_data->>'local_end_date')::date,
        (v_event_data->>'starts_at')::timestamptz,
        (v_event_data->>'ends_at')::timestamptz,
        coalesce(v_event_data->>'start_time_precision', case when (v_event_data->>'starts_at') is not null then 'instant' else 'date_only' end),
        (v_event_data->>'doors_at')::timestamptz,
        coalesce((v_event_data->>'is_multi_day')::boolean, false),
        v_event_data->>'official_url',
        v_event_data->>'primary_ticket_url'
      )
      returning id into v_event_id;
    end if;

    -- 3. Upsert Event Artists (and create new artists if requested atomically)
    if payload->'artists' is not null and jsonb_array_length(payload->'artists') > 0 then
      for v_artist_item in select * from jsonb_array_elements(payload->'artists') loop
        v_artist_id := null;
        if v_artist_item->>'name' is not null then
          v_artist_id := coalesce((v_artist_item->>'artist_id')::uuid, gen_random_uuid());
          -- Upsert canonical artist inside the same atomic transaction
          insert into public.artists (
            id,
            name,
            normalized_name
          ) values (
            v_artist_id,
            v_artist_item->>'name',
            coalesce(v_artist_item->>'normalized_name', lower(trim(v_artist_item->>'name')))
          )
          on conflict (id) do update set
            name = excluded.name,
            normalized_name = excluded.normalized_name;

          -- Attach external IDs if provided
          if v_artist_item->'external_ids' is not null and jsonb_array_length(v_artist_item->'external_ids') > 0 then
            for v_ext_id_item in select * from jsonb_array_elements(v_artist_item->'external_ids') loop
              insert into public.artist_external_ids (
                artist_id,
                provider,
                external_id,
                provider_url
              ) values (
                v_artist_id,
                v_ext_id_item->>'provider',
                v_ext_id_item->>'external_id',
                v_ext_id_item->>'provider_url'
              )
              on conflict (provider, external_id) do nothing;
            end loop;
          end if;
        elsif v_artist_item->>'artist_id' is not null then
          v_artist_id := (v_artist_item->>'artist_id')::uuid;
        end if;

        if v_artist_id is not null then
          insert into public.event_artists (
            event_id,
            artist_id,
            billing_position,
            sort_order
          ) values (
            v_event_id,
            v_artist_id,
            coalesce(v_artist_item->>'billing_position', 'unknown'),
            coalesce((v_artist_item->>'sort_order')::integer, 0)
          )
          on conflict (event_id, artist_id) do update set
            billing_position = excluded.billing_position,
            sort_order = excluded.sort_order;
        end if;
      end loop;
    end if;

    -- 4. Upsert Event Ticket Links
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

    -- 5. Upsert Event Sources (handles nullable source_event_id partial uniqueness)
    v_source_item := payload->'source';
    if v_source_item is not null and v_source_item != 'null'::jsonb then
      if v_source_item->>'source_event_id' is not null then
        -- Invariant 4 & Point 8: Upstream stable identity must NEVER silently move between canonical events
        select event_id into v_existing_event_id
        from public.event_sources
        where source_id = (v_source_item->>'source_id')::uuid
          and source_event_id = v_source_item->>'source_event_id';

        if v_existing_event_id is not null and v_existing_event_id <> v_event_id then
          raise exception 'Cannot reassign existing source_event_id % for source % from canonical event % to %',
            v_source_item->>'source_event_id',
            v_source_item->>'source_id',
            v_existing_event_id,
            v_event_id
            using errcode = '23505';
        end if;

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
        on conflict (source_id, source_event_id) where source_event_id is not null do update set
          candidate_id = excluded.candidate_id,
          raw_ingest_id = excluded.raw_ingest_id,
          source_url = excluded.source_url,
          confidence = excluded.confidence,
          last_seen_at = now(),
          updated_at = now()
        returning id into v_source_record_id;
      else
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
          null,
          v_source_item->>'source_url',
          coalesce((v_source_item->>'confidence')::numeric, 0.8),
          now(),
          now(),
          true
        )
        on conflict (event_id, source_id, source_url) where source_event_id is null do update set
          candidate_id = excluded.candidate_id,
          raw_ingest_id = excluded.raw_ingest_id,
          confidence = excluded.confidence,
          last_seen_at = now(),
          updated_at = now()
        returning id into v_source_record_id;
      end if;
    end if;

    -- 6. Insert Field Evidence
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

  -- 7. Insert Resolution
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
    'venueId', v_venue_id,
    'status', coalesce(v_res_item->>'status', 'created')
  );
end;
$$;

-- Secure apply_canonicalization RPC: restrict execution strictly to service_role
revoke all on function public.apply_canonicalization(jsonb) from public;
revoke all on function public.apply_canonicalization(jsonb) from anon, authenticated;
grant execute on function public.apply_canonicalization(jsonb) to service_role;


