# 03 — Data Model

This is a conceptual schema. Exact column names/types can change during implementation, but entity boundaries should remain stable unless documented.

## profiles (private user data)

```text
id (references `auth.users.id`)
created_at
home_lat_approx
home_lng_approx
default_radius_miles
max_spontaneous_price
max_normal_ticket_price
max_favorite_artist_price
travel_willingness
```

Supabase Auth owns identity, credentials, and tokens. Store only product profile and
preference data in `public.profiles`; do not mirror credentials or provider tokens
there. User-private tables must reference `auth.users.id` and use row-level security
so a user can access only their own rows. Service-role access is reserved for trusted
server-side jobs.

Do not require an exact street address.

## artists

```text
id
name
normalized_name
spotify_id
ticketmaster_id
musicbrainz_id (optional)
genres[]
image_url
created_at
updated_at
```

## artist_external_ids

Useful if provider count grows:

```text
artist_id
provider
provider_artist_id
provider_url
```

## user_artist_affinity

```text
user_id
artist_id
spotify_short_term_score
spotify_medium_term_score
spotify_long_term_score
recent_listening_score
concert_history_score
manual_rating
saved_event_score
final_affinity_score
updated_at
```

## venues

```text
id
name
normalized_name
city
state
country
latitude
longitude
timezone (IANA name, for example `America/Denver`)
capacity (nullable)
venue_type
indoor_outdoor
website_url
```

## user_venue_affinity

```text
user_id
venue_id
times_attended
average_rating
would_return_score
venue_affinity
```

## promoters

```text
id
name
website_url
calendar_url
reliability_score
```

## events

Canonical event record.

```text
id
name
event_type
start_datetime
end_datetime
timezone (IANA name; required whenever a start/end time is known)
multi_day
venue_id
promoter_id
city
state
country
latitude
longitude
minimum_age
official_url
canonical_ticket_url
status
announced_at
created_at
updated_at
```

Store instants as `timestamptz`. Preserve the event's IANA time zone so date-only
and local-time source data can be normalized without changing the intended local day.

Suggested `event_type`:

```text
concert
festival
multi_day_festival
club_show
outdoor_show
music_series
free_event
residency
```

## event_days

For festivals/multi-day events.

```text
id
event_id
date
doors_open
doors_close
label
```

## performances

```text
id
event_id
event_day_id nullable
artist_id
stage nullable
start_time nullable
end_time nullable
billing_position
```

Suggested billing positions:
- headliner
- subheadliner
- mid_card
- support
- unknown

## ticket_options

```text
id
event_id
provider
name
ticket_type
days_included[]
face_value nullable
fees_estimate nullable
total_price nullable
currency
inventory_status
sale_type
sale_start
sale_end
ticket_url
last_verified_at
```

Examples:
- GA
- VIP
- lawn
- reserved
- weekend_pass
- single_day
- early_bird

## price_snapshots

```text
id
ticket_option_id
captured_at
price
fees
availability
source_id
```

## attendance_history

```text
id
user_id
event_id nullable
artist_id nullable
venue_id nullable
attendance_date
ticket_price nullable
rating nullable
would_see_again nullable
favorite_performance_artist_id nullable
source
notes nullable
```

## user_event_feedback

```text
id
user_id
event_id
action
created_at
metadata jsonb
```

Actions:
- viewed
- opened
- saved
- shared
- tickets_clicked
- attended
- not_interested
- too_expensive
- too_far
- bad_date
- dont_like_artist
- dont_like_venue

## watch_rules

```text
id
user_id
rule_type
artist_id nullable
event_id nullable
max_price nullable
max_distance nullable
trigger_on_announcement
trigger_on_presale
trigger_on_onsale
trigger_on_price_drop
trigger_on_lineup_change
enabled
created_at
```

## raw_ingests

```text
id
source_id
source_url
fetched_at
content_hash
content_type
raw_content_or_storage_pointer
http_status
parser_version
```

Large raw pages may eventually live in object storage with a DB pointer.

## event_candidates

```text
id
raw_ingest_id
source_id
source_event_id nullable
candidate_payload jsonb
artist_text
venue_text
city_text
event_date nullable
sale_date nullable
presale_date nullable
ticket_url nullable
price nullable
confidence
verification_status
created_at
```

## event_sources

Connect canonical event to supporting source records.

```text
id
event_id
source_id
source_event_id nullable
source_url
confidence
first_seen_at
last_seen_at
```

## sources

```text
id
name
source_type
base_url
acquisition_method
crawl_frequency_minutes nullable
reliability_score
active
last_success_at
last_failure_at
health_status
parser_version
```

## source_field_evidence (future but valuable)

For field-level provenance:

```text
id
event_id
field_name
source_id
raw_ingest_id
value_hash
confidence
observed_at
```

This allows future debugging of conflicting dates/prices/venues.
