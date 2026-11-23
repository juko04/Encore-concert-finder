import type { SupabaseClient } from '@supabase/supabase-js';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';

export const TM_SOURCE_ID = 'b0000000-0000-0000-0000-000000000003';

export const TRACED_VENUES = [
  {
    id: 'e442730d-1979-423f-bbba-f4f3da72ad60',
    name: 'Avalon Theatre',
    city: 'Grand Junction',
    region: 'CO',
    country_code: 'US',
    timezone: 'America/Denver',
    normalized_name: 'avalon theatre',
  },
  {
    id: 'f9db5e86-da13-419f-8d47-642123b2e1fc',
    name: 'Summit Music Hall',
    city: 'Denver',
    region: 'CO',
    country_code: 'US',
    timezone: 'America/Denver',
    normalized_name: 'summit music hall',
  },
  {
    id: 'c5fd8976-e269-41c4-b3d4-4208a8e39ff2',
    name: 'Fillmore Auditorium (Denver)',
    city: 'Denver',
    region: 'CO',
    country_code: 'US',
    timezone: 'America/Denver',
    normalized_name: 'fillmore auditorium denver',
  },
];

export const TRACED_ARTISTS = [
  {
    id: '1fc8d87a-d2ac-4413-8ac4-d2a3b01db8a5',
    name: 'Community Concerts of the Grand Valley',
    normalized_name: 'community concerts of the grand valley',
  },
  {
    id: 'c2ee798f-5aae-4f35-9113-70cc2d000001',
    name: 'Saosin',
    normalized_name: 'saosin',
  },
  {
    id: '5e6a4023-a7f4-4806-bd91-0fab38db7ea6',
    name: 'Tyla',
    normalized_name: 'tyla',
  },
];

export const TRACED_EVENTS = [
  {
    id: '9ae75b94-a5da-4e49-90c8-dcd8fb3de920',
    name: 'Community Concerts of the Grand Valley 26-27',
    normalized_name: 'community concerts of the grand valley 26 27',
    venue_id: 'e442730d-1979-423f-bbba-f4f3da72ad60',
    city: 'Grand Junction',
    region: 'CO',
    country_code: 'US',
    timezone: 'America/Denver',
    local_start_date: '2026-09-24',
    local_end_date: '2027-04-11',
    starts_at: null as string | null,
    event_kind: 'multi_day_festival',
    status: 'scheduled',
    is_multi_day: true,
    start_time_precision: 'date_only',
    primary_ticket_url:
      'https://www.ticketmaster.com/community-concerts-of-the-grand-valley-grand-junction-colorado-09-24-2026/event/1E00648A835556FD',
  },
  {
    id: 'f00df05b-35d6-4396-b98a-82abc6558e0d',
    name: 'Saosin: 20 Years of Self-Titled',
    normalized_name: 'saosin 20 years of self titled',
    venue_id: 'f9db5e86-da13-419f-8d47-642123b2e1fc',
    city: 'Denver',
    region: 'CO',
    country_code: 'US',
    timezone: 'America/Denver',
    local_start_date: '2026-11-20',
    local_end_date: '2026-11-20',
    starts_at: '2026-11-21T01:00:00Z',
    event_kind: 'concert',
    status: 'scheduled',
    is_multi_day: false,
    start_time_precision: 'instant',
    primary_ticket_url:
      'https://www.ticketmaster.com/saosin-20-years-of-selftitled-denver-colorado-11-20-2026/event/1E0064A5C644EA37',
  },
  {
    id: '33db73d8-2764-4c50-96c0-c3f947bc1ab1',
    name: 'TYLA - THE A*POP WORLD TOUR',
    normalized_name: 'tyla the a pop world tour',
    venue_id: 'c5fd8976-e269-41c4-b3d4-4208a8e39ff2',
    city: 'Denver',
    region: 'CO',
    country_code: 'US',
    timezone: 'America/Denver',
    local_start_date: '2026-11-20',
    local_end_date: '2026-11-20',
    starts_at: '2026-11-21T01:30:00Z',
    event_kind: 'concert',
    status: 'scheduled',
    is_multi_day: false,
    start_time_precision: 'instant',
    primary_ticket_url:
      'https://www.ticketmaster.com/tyla-the-apop-world-tour-denver-colorado-11-20-2026/event/1E0064F6BBFECD61',
  },
];

export const TRACED_EVENT_ARTISTS = [
  {
    id: '1f97a711-6278-4353-bcea-abb6426ec69a',
    event_id: '9ae75b94-a5da-4e49-90c8-dcd8fb3de920',
    artist_id: '1fc8d87a-d2ac-4413-8ac4-d2a3b01db8a5',
    sort_order: 0,
    billing_position: 'unknown',
  },
  {
    id: '26522352-f9b0-46ac-9461-f38cc581df76',
    event_id: 'f00df05b-35d6-4396-b98a-82abc6558e0d',
    artist_id: 'c2ee798f-5aae-4f35-9113-70cc2d000001',
    sort_order: 0,
    billing_position: 'unknown',
  },
  {
    id: '69b9fb25-83d4-45b9-9660-74be0092541a',
    event_id: '33db73d8-2764-4c50-96c0-c3f947bc1ab1',
    artist_id: '5e6a4023-a7f4-4806-bd91-0fab38db7ea6',
    sort_order: 0,
    billing_position: 'unknown',
  },
];

export const TRACED_EVENT_SOURCES = [
  {
    id: '8503ffc7-9097-4140-bad1-3a14478e5b30',
    event_id: '9ae75b94-a5da-4e49-90c8-dcd8fb3de920',
    source_id: TM_SOURCE_ID,
    source_event_id: 'G5vzZ_Fnd44hW',
    confidence: 0.95,
    is_current: true,
  },
  {
    id: '856a709f-4cfb-4a83-8a61-63d379f34819',
    event_id: 'f00df05b-35d6-4396-b98a-82abc6558e0d',
    source_id: TM_SOURCE_ID,
    source_event_id: 'G5vzZ_19koCIM',
    confidence: 0.95,
    is_current: true,
  },
  {
    id: '8dd670c7-a363-4b04-a7dc-43e9860d1695',
    event_id: '33db73d8-2764-4c50-96c0-c3f947bc1ab1',
    source_id: TM_SOURCE_ID,
    source_event_id: 'G5vzZ_2QDTig-',
    confidence: 0.95,
    is_current: true,
  },
];

/**
 * Seeds the traced live events fixture idempotently into a local database
 * if they are missing (e.g. in fresh CI or ephemeral test environments).
 */
export async function seedTracedEventsFixture(
  client: SupabaseClient,
  targetUrl: string,
): Promise<void> {
  assertSafeDatabaseTarget(
    targetUrl,
    false,
    'Traced Live Events Fixture Seeder',
  );

  // 1. Ensure Ticketmaster source exists
  await client.from('sources').upsert(
    {
      id: TM_SOURCE_ID,
      slug: 'ticketmaster-discovery',
      name: 'Ticketmaster Discovery API',
      source_type: 'aggregator',
      acquisition_method: 'api',
      base_url: 'https://app.ticketmaster.com',
      reliability_score: 0.95,
      active: true,
      parser_version: '1.0.0',
    },
    { onConflict: 'slug' },
  );

  // 2. Upsert venues
  for (const v of TRACED_VENUES) {
    await client.from('venues').upsert(v, { onConflict: 'id' });
  }

  // 3. Upsert artists
  for (const a of TRACED_ARTISTS) {
    await client.from('artists').upsert(a, { onConflict: 'id' });
  }

  // 4. Upsert events
  for (const e of TRACED_EVENTS) {
    await client.from('events').upsert(e, { onConflict: 'id' });
  }

  // 5. Upsert event_artists
  for (const ea of TRACED_EVENT_ARTISTS) {
    await client.from('event_artists').upsert(ea, { onConflict: 'id' });
  }

  // 6. Upsert event_sources
  for (const es of TRACED_EVENT_SOURCES) {
    await client.from('event_sources').upsert(es, { onConflict: 'id' });
  }
}
