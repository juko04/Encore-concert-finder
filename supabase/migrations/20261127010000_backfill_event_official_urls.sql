-- Backfill events.official_url with the show's page on the venue/promoter website.
--
-- Venue and promoter scrapers already store that page as event_sources.source_url, but
-- event_sources is service-role only, so public pages could not link to it and fell back to a web
-- search. New syncs now write official_url directly (lib/events/official-url.ts); this fills the
-- events ingested before that change.
--
-- Rules (same as the ingestion path):
--   * fill-if-empty only: an existing official_url is never replaced;
--   * only venue/promoter sources (aggregator/ticketing URLs are API requests or ticket pages);
--   * only browsable http(s) URLs, never API hosts or URLs carrying an API key;
--   * the most recently seen current source row wins;
--   * every filled value gets an event_field_evidence row pointing at its event_sources row,
--     so the field stays traceable to its source (field-level provenance).

with picked as (
  select distinct on (es.event_id)
    es.event_id,
    es.id as event_source_id,
    es.source_id,
    es.raw_ingest_id,
    es.candidate_id,
    es.source_url,
    es.confidence
  from public.event_sources es
  join public.sources s on s.id = es.source_id
  join public.events e on e.id = es.event_id
  where e.official_url is null
    and s.source_type in ('venue', 'promoter')
    and es.source_url ~* '^https?://'
    and es.source_url !~* '^https?://(api\.|app\.ticketmaster\.)'
    and es.source_url !~* '[?&]api[_-]?key='
  order by es.event_id, es.is_current desc, es.last_seen_at desc
),
filled as (
  update public.events e
  set official_url = p.source_url,
      updated_at = now()
  from picked p
  where e.id = p.event_id
    and e.official_url is null
  returning e.id
)
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
  parser_version
)
select
  p.event_id,
  'official_url',
  p.event_source_id,
  p.source_id,
  p.raw_ingest_id,
  p.candidate_id,
  to_jsonb(p.source_url),
  'official_url_' || p.source_url,
  p.confidence,
  'backfill-20261127010000'
from picked p
join filled f on f.id = p.event_id;
