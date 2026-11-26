-- Migration: 20261125020000_apply_canonicalization_needs_review_conflicts.sql
-- Description: Makes public.apply_canonicalization resilient to ambiguous candidates.
--
--   1. Persist needs_review / rejected resolutions that carry no event. Previously a
--      payload with only `resolution` fell through to 'Invalid payload: missing event'
--      and NOTHING was written to candidate_resolutions (the in-memory repository did
--      persist it), so needs_review decisions were lost on Postgres.
--   2. Provider external-ID conflicts (two different artists in one payload claiming
--      the same provider external_id, or an external_id already owned by a different
--      artist) no longer RAISE and abort the whole ingestion batch when a resolution
--      is supplied. A needs_review resolution with reason
--      'duplicate_external_id_conflict' is persisted instead and NO canonical rows
--      (venue/event/artist/links/evidence) are written for that candidate, so the
--      per-candidate transaction stays atomic with zero orphans.
--      Without a `resolution` in the payload the original exception is preserved.
--
-- event_candidates (immutable observations) are never touched. Existing artists are
-- never merged: ambiguity routes to human review.
-- Body = 20261124000000 version plus the clearly marked additions below.

create or replace function public.apply_canonicalization(payload jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_venue_id uuid;
  v_event_id uuid;
  v_existing_event boolean := false;
  v_existing_event_id uuid;
  v_artist_id uuid;
  v_existing_owner_id uuid;
  v_venue_item jsonb;
  v_event_data jsonb;
  v_artist_item jsonb;
  v_ext_id_item jsonb;
  v_ticket_link_item jsonb;
  v_source_item jsonb;
  v_evidence_item jsonb;
  v_resolution_item jsonb;
  v_conflict_reason text;
  v_claims jsonb := '{}'::jsonb;
  v_claim_key text;
  v_claim_identity text;
begin
  -- 0. (new) External-ID conflict pre-check, before any write.
  v_resolution_item := payload->'resolution';
  if v_resolution_item is not null and v_resolution_item != 'null'::jsonb
     and v_resolution_item->>'event_candidate_id' is not null
     and payload->'event' is not null and payload->'event' != 'null'::jsonb
     and payload->'artists' is not null and jsonb_typeof(payload->'artists') = 'array' then
    for v_artist_item in select * from jsonb_array_elements(payload->'artists') loop
      if v_artist_item->'external_ids' is null or jsonb_typeof(v_artist_item->'external_ids') <> 'array' then
        continue;
      end if;
      v_claim_identity := coalesce(
        v_artist_item->>'artist_id',
        'name:' || coalesce(v_artist_item->>'normalized_name', lower(trim(v_artist_item->>'name')), '')
      );
      for v_ext_id_item in select * from jsonb_array_elements(v_artist_item->'external_ids') loop
        v_claim_key := (v_ext_id_item->>'provider') || E'\u0001' || (v_ext_id_item->>'external_id');
        if v_claims ? v_claim_key and v_claims->>v_claim_key <> v_claim_identity then
          v_conflict_reason := 'external_id_shared_by_multiple_artists_in_candidate';
        end if;
        v_claims := v_claims || jsonb_build_object(v_claim_key, v_claim_identity);

        select artist_id into v_existing_owner_id
        from public.artist_external_ids
        where provider = v_ext_id_item->>'provider'
          and external_id = v_ext_id_item->>'external_id';
        if v_existing_owner_id is not null
           and v_existing_owner_id is distinct from (v_artist_item->>'artist_id')::uuid then
          v_conflict_reason := coalesce(v_conflict_reason, 'external_id_owned_by_different_artist');
        end if;
      end loop;
    end loop;

    if v_conflict_reason is not null then
      insert into public.candidate_resolutions (
        event_candidate_id, event_id, status, matcher_version, confidence, reasons, resolved_at
      ) values (
        (v_resolution_item->>'event_candidate_id')::uuid,
        null,
        'needs_review',
        coalesce(v_resolution_item->>'matcher_version', '1.0.0'),
        least(coalesce((v_resolution_item->>'confidence')::numeric, 0.4), 0.4),
        jsonb_build_array('duplicate_external_id_conflict', v_conflict_reason),
        now()
      );
      return jsonb_build_object(
        'eventId', null,
        'venueId', null,
        'status', 'needs_review',
        'reasons', jsonb_build_array('duplicate_external_id_conflict', v_conflict_reason)
      );
    end if;
  end if;
  v_existing_owner_id := null;

  -- 1. Upsert Venue if requested
  v_venue_item := payload->'venueToCreate';
  if v_venue_item is not null and v_venue_item != 'null'::jsonb then
    v_venue_id := coalesce((v_venue_item->>'id')::uuid, gen_random_uuid());
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
      v_venue_id,
      v_venue_item->>'name',
      v_venue_item->>'normalized_name',
      v_venue_item->>'city',
      v_venue_item->>'region',
      v_venue_item->>'country_code',
      v_venue_item->>'timezone',
      v_venue_item->>'website'
    )
    on conflict (id) do update set
      name = excluded.name,
      normalized_name = excluded.normalized_name,
      city = excluded.city,
      region = coalesce(excluded.region, venues.region),
      country_code = coalesce(excluded.country_code, venues.country_code),
      timezone = coalesce(excluded.timezone, venues.timezone),
      website = coalesce(excluded.website, venues.website),
      updated_at = now();
  end if;

  -- 2. Upsert Canonical Event
  v_event_data := payload->'event';
  if v_event_data is not null and v_event_data != 'null'::jsonb then
    if v_event_data->>'id' is not null then
      v_event_id := (v_event_data->>'id')::uuid;

      select exists(select 1 from public.events where id = v_event_id) into v_existing_event;

      if v_existing_event then
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
          min_price = coalesce((v_event_data->>'min_price')::numeric, min_price),
          max_price = coalesce((v_event_data->>'max_price')::numeric, max_price),
          currency = coalesce(v_event_data->>'currency', currency),
          genre = coalesce(v_event_data->>'genre', genre),
          genres = case
            when v_event_data->'genres' is not null then
              array(select jsonb_array_elements_text(v_event_data->'genres'))
            else genres
          end,
          -- IMAGE (new): fill-if-empty, never overwrite an existing image
          image_url = coalesce(image_url, nullif(v_event_data->>'image_url', '')),
          updated_at = now()
        where id = v_event_id;
      else
        insert into public.events (
          id,
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
          primary_ticket_url,
          min_price,
          max_price,
          currency,
          genre,
          genres,
          image_url
        ) values (
          v_event_id,
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
          v_event_data->>'primary_ticket_url',
          (v_event_data->>'min_price')::numeric,
          (v_event_data->>'max_price')::numeric,
          v_event_data->>'currency',
          v_event_data->>'genre',
          coalesce(
            case when v_event_data->'genres' is not null then array(select jsonb_array_elements_text(v_event_data->'genres')) else null end,
            '{}'::text[]
          ),
          nullif(v_event_data->>'image_url', '')
        );
      end if;
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
        primary_ticket_url,
        min_price,
        max_price,
        currency,
        genre,
        genres,
        image_url
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
        v_event_data->>'primary_ticket_url',
        (v_event_data->>'min_price')::numeric,
        (v_event_data->>'max_price')::numeric,
        v_event_data->>'currency',
        v_event_data->>'genre',
        coalesce(
          case when v_event_data->'genres' is not null then array(select jsonb_array_elements_text(v_event_data->'genres')) else null end,
          '{}'::text[]
        ),
        nullif(v_event_data->>'image_url', '')
      )
      returning id into v_event_id;
    end if;

    -- 2b. Venue image (new): fill-if-empty on the event's venue, new or existing
    if nullif(v_event_data->>'venue_image_url', '') is not null then
      update public.venues
      set image_url = nullif(v_event_data->>'venue_image_url', ''),
          updated_at = now()
      where id = coalesce(
          (v_event_data->>'venue_id')::uuid,
          v_venue_id,
          (select e.venue_id from public.events e where e.id = v_event_id)
        )
        and image_url is null;
    end if;

    -- 3. Upsert Event Artists
    if payload->'artists' is not null and jsonb_array_length(payload->'artists') > 0 then
      for v_artist_item in select * from jsonb_array_elements(payload->'artists') loop
        v_artist_id := null;
        if v_artist_item->>'name' is not null then
          v_artist_id := coalesce((v_artist_item->>'artist_id')::uuid, gen_random_uuid());
          insert into public.artists (
            id,
            name,
            normalized_name,
            image_url
          ) values (
            v_artist_id,
            v_artist_item->>'name',
            coalesce(v_artist_item->>'normalized_name', lower(trim(v_artist_item->>'name'))),
            nullif(v_artist_item->>'image_url', '')
          )
          on conflict (id) do update set
            name = excluded.name,
            normalized_name = excluded.normalized_name,
            -- IMAGE (new): fill-if-empty (keeps e.g. an existing Spotify image)
            image_url = coalesce(artists.image_url, excluded.image_url);
        elsif v_artist_item->>'artist_id' is not null then
          v_artist_id := (v_artist_item->>'artist_id')::uuid;
          -- IMAGE (new): matched artist, fill-if-empty only
          if nullif(v_artist_item->>'image_url', '') is not null then
            update public.artists
            set image_url = nullif(v_artist_item->>'image_url', '')
            where id = v_artist_id
              and image_url is null;
          end if;
        end if;

        if v_artist_id is not null and v_artist_item->'external_ids' is not null and jsonb_array_length(v_artist_item->'external_ids') > 0 then
          for v_ext_id_item in select * from jsonb_array_elements(v_artist_item->'external_ids') loop
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
            else
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

    -- 4. Upsert Event Ticket Links with Status Protection
    if payload->'ticketLinks' is not null and jsonb_array_length(payload->'ticketLinks') > 0 then
      for v_ticket_link_item in select * from jsonb_array_elements(payload->'ticketLinks') loop
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
          (v_ticket_link_item->>'ticket_provider_source_id')::uuid,
          v_ticket_link_item->>'url',
          v_ticket_link_item->>'normalized_url',
          (v_ticket_link_item->>'min_price')::numeric,
          (v_ticket_link_item->>'max_price')::numeric,
          v_ticket_link_item->>'currency',
          coalesce(v_ticket_link_item->>'inventory_status', 'unknown'),
          (v_ticket_link_item->>'verified_at')::timestamptz
        )
        on conflict (event_id, normalized_url) do update set
          min_price = coalesce(excluded.min_price, event_ticket_links.min_price),
          max_price = coalesce(excluded.max_price, event_ticket_links.max_price),
          currency = coalesce(excluded.currency, event_ticket_links.currency),
          -- Protect verified sold_out / low_inventory status from being downgraded to unknown
          inventory_status = case
            when excluded.inventory_status = 'unknown' and event_ticket_links.inventory_status in ('sold_out', 'low_inventory') then event_ticket_links.inventory_status
            else excluded.inventory_status
          end,
          verified_at = coalesce(excluded.verified_at, event_ticket_links.verified_at),
          updated_at = now();
      end loop;
    end if;

    -- 5. Upsert Event Sources
    v_source_item := payload->'source';
    if v_source_item is not null and v_source_item != 'null'::jsonb then
      if v_source_item->>'source_event_id' is not null then
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
          event_id = excluded.event_id,
          candidate_id = excluded.candidate_id,
          raw_ingest_id = excluded.raw_ingest_id,
          source_url = excluded.source_url,
          confidence = excluded.confidence,
          last_seen_at = now(),
          is_current = true;
      else
        insert into public.event_sources (
          event_id,
          source_id,
          candidate_id,
          raw_ingest_id,
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
          v_source_item->>'source_url',
          coalesce((v_source_item->>'confidence')::numeric, 0.8),
          now(),
          now(),
          true
        );
      end if;
    end if;

    -- 6. Insert Evidence
    if payload->'evidence' is not null and jsonb_array_length(payload->'evidence') > 0 then
      for v_evidence_item in select * from jsonb_array_elements(payload->'evidence') loop
        insert into public.event_field_evidence (
          event_id,
          field_name,
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
          (v_evidence_item->>'source_id')::uuid,
          (v_evidence_item->>'raw_ingest_id')::uuid,
          (v_evidence_item->>'candidate_id')::uuid,
          v_evidence_item->'observed_value',
          v_evidence_item->>'value_hash',
          (v_evidence_item->>'confidence')::numeric,
          (v_evidence_item->>'observed_at')::timestamptz,
          v_evidence_item->>'parser_version'
        );
      end loop;
    end if;

    -- 7. Insert Resolution
    v_resolution_item := payload->'resolution';
    if v_resolution_item is not null and v_resolution_item != 'null'::jsonb and v_resolution_item->>'event_candidate_id' is not null then
      insert into public.candidate_resolutions (
        event_candidate_id,
        event_id,
        status,
        matcher_version,
        confidence,
        reasons,
        resolved_at
      ) values (
        (v_resolution_item->>'event_candidate_id')::uuid,
        v_event_id,
        v_resolution_item->>'status',
        coalesce(v_resolution_item->>'matcher_version', '1.0.0'),
        (v_resolution_item->>'confidence')::numeric,
        coalesce(v_resolution_item->'reasons', '[]'::jsonb),
        now()
      );
    end if;

    return jsonb_build_object(
      'eventId', v_event_id,
      'venueId', v_venue_id,
      'status', coalesce(v_resolution_item->>'status', 'created')
    );
  end if;

  -- (new) Event-less resolutions (needs_review / rejected) are persisted, not dropped.
  v_resolution_item := payload->'resolution';
  if v_resolution_item is not null and v_resolution_item != 'null'::jsonb
     and v_resolution_item->>'event_candidate_id' is not null
     and v_resolution_item->>'status' in ('needs_review', 'rejected') then
    insert into public.candidate_resolutions (
      event_candidate_id, event_id, status, matcher_version, confidence, reasons, resolved_at
    ) values (
      (v_resolution_item->>'event_candidate_id')::uuid,
      null,
      v_resolution_item->>'status',
      coalesce(v_resolution_item->>'matcher_version', '1.0.0'),
      (v_resolution_item->>'confidence')::numeric,
      coalesce(v_resolution_item->'reasons', '[]'::jsonb),
      now()
    );
    return jsonb_build_object(
      'eventId', null,
      'venueId', null,
      'status', v_resolution_item->>'status'
    );
  end if;

  return jsonb_build_object(
    'error', 'Invalid payload: missing event'
  );
end;
$$;

revoke all on function public.apply_canonicalization(jsonb) from public;
revoke all on function public.apply_canonicalization(jsonb) from anon, authenticated;
grant execute on function public.apply_canonicalization(jsonb) to service_role;
