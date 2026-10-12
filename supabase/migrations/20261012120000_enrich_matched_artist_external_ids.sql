-- Migration: 20261012120000_enrich_matched_artist_external_ids.sql
-- Description: Updates public.apply_canonicalization stored procedure to atomically enrich external IDs on already matched artists (Tech Debt 1.2 closeout).

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
  v_existing_owner_id uuid;
  v_existing_ext_for_artist text;
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
        elsif v_artist_item->>'artist_id' is not null then
          v_artist_id := (v_artist_item->>'artist_id')::uuid;
        end if;

        -- Attach or enrich external IDs if provided (executes for both new and matched artists)
        if v_artist_id is not null and v_artist_item->'external_ids' is not null and jsonb_array_length(v_artist_item->'external_ids') > 0 then
          for v_ext_id_item in select * from jsonb_array_elements(v_artist_item->'external_ids') loop
            -- Check if this provider + external_id is already assigned to ANY artist
            select artist_id into v_existing_owner_id
            from public.artist_external_ids
            where provider = v_ext_id_item->>'provider'
              and external_id = v_ext_id_item->>'external_id';

            if v_existing_owner_id is not null then
              if v_existing_owner_id <> v_artist_id then
                raise exception 'Cannot assign external_id % for provider % to artist %: already assigned to artist %',
                  v_ext_id_item->>'external_id',
                  v_ext_id_item->>'provider',
                  v_artist_id,
                  v_existing_owner_id
                  using errcode = '23505';
              end if;
              -- Idempotent: identical (artist_id, provider, external_id) already attached -> no-op
            else
              -- Check if this artist already has a DIFFERENT external ID for this provider (violates uq_artist_provider)
              select external_id into v_existing_ext_for_artist
              from public.artist_external_ids
              where artist_id = v_artist_id
                and provider = v_ext_id_item->>'provider';

              if v_existing_ext_for_artist is not null and v_existing_ext_for_artist <> (v_ext_id_item->>'external_id') then
                raise exception 'Cannot assign external_id % for provider % to artist %: artist already has external_id %',
                  v_ext_id_item->>'external_id',
                  v_ext_id_item->>'provider',
                  v_artist_id,
                  v_existing_ext_for_artist
                  using errcode = '23505';
              end if;

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
              );
            end if;
          end loop;
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

