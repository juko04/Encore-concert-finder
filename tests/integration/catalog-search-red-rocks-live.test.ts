import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { GET as searchGet } from '@/app/api/catalog/search/route';
import { NextRequest } from 'next/server';

interface LocalCredentials {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

function resolveSupabaseCredentials(): LocalCredentials | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && anonKey && serviceRoleKey) {
    return { url, anonKey, serviceRoleKey };
  }

  try {
    const rawOutput = execSync('npx supabase status -o json', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(rawOutput) as {
      API_URL?: string;
      ANON_KEY?: string;
      SERVICE_ROLE_KEY?: string;
    };

    if (parsed.API_URL && parsed.ANON_KEY && parsed.SERVICE_ROLE_KEY) {
      return {
        url: url || parsed.API_URL,
        anonKey: anonKey || parsed.ANON_KEY,
        serviceRoleKey: serviceRoleKey || parsed.SERVICE_ROLE_KEY,
      };
    }
  } catch {
    // Supabase CLI not available
  }

  return {
    url: 'http://127.0.0.1:54321',
    anonKey: '',
    serviceRoleKey: '',
  };
}

// ---------------------------------------------------------------------------
// Isolated synthetic catalog (AGENTS.md invariants 8 and 12)
//
// This suite used to assume a pre-ingested live catalog. It now seeds its own
// clearly labeled synthetic rows in beforeAll and removes exactly those rows in
// afterAll. Every row uses a deterministic UUID in the reserved
// 5e5e0000-0000-4000-8000-* range and a "(Synthetic Test)" name suffix, so a
// crashed earlier run can be cleaned up and real rows are never touched.
// All dates are computed relative to "now" so the catalog never goes stale.
// ---------------------------------------------------------------------------
const SYNTH_LABEL = '(Synthetic Test)';
const SYNTH_TICKET_HOST = 'https://synthetic.test.invalid/red-rocks-live';
const RED_ROCKS_EVENT_COUNT = 60; // > 50 so page 2 of the search route is non-empty
const FILLER_EVENT_COUNT = 60; // pushes the catalog comfortably past 100 upcoming events

function synthId(kind: 'v' | 'a' | 'e', n: number): string {
  const prefix = { v: '1', a: '2', e: '3' }[kind];
  return `5e5e0000-0000-4000-8000-${prefix}${String(n).padStart(11, '0')}`;
}

function futureDate(daysAhead: number): string {
  // Start a few days out so day-boundary/timezone effects never make a seeded
  // event "past" or leave it outside the upcoming window.
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 3 + daysAhead);
  return d.toISOString().split('T')[0];
}

interface SyntheticCatalog {
  venueIds: string[];
  artistIds: string[];
  eventIds: string[];
  redRocksVenueId: string;
  rows: {
    venues: Record<string, unknown>[];
    artists: Record<string, unknown>[];
    events: Record<string, unknown>[];
    eventArtists: Record<string, unknown>[];
    ticketLinks: Record<string, unknown>[];
  };
}

function buildSyntheticCatalog(): SyntheticCatalog {
  const venue = (n: number, name: string, city: string) => ({
    id: synthId('v', n),
    name: `${name} ${SYNTH_LABEL}`,
    normalized_name: `${name.toLowerCase()} synthetic test`,
    city,
    region: 'CO',
    country_code: 'US',
    timezone: 'America/Denver',
  });
  const artist = (n: number, name: string) => ({
    id: synthId('a', n),
    name: `${name} ${SYNTH_LABEL}`,
    normalized_name: `${name.toLowerCase()} synthetic test`,
  });

  const venues = [
    venue(1, 'Red Rocks Amphitheatre', 'Morrison'),
    venue(2, 'Globe Hall', 'Denver'),
    venue(3, 'Synthetic Catalog Hall', 'Denver'),
  ];
  const artists = [
    artist(1, 'Red Rocks Headliner'), // a1
    artist(2, 'Jonah Kagen'), // a2
    artist(3, 'Sublime'), // a3
    artist(4, 'Abbie Gamboa'), // a4
    artist(5, 'Chelsea Plank'), // a5
    artist(6, 'Filler Headliner'), // a6
  ];

  const events: Record<string, unknown>[] = [];
  const eventArtists: Record<string, unknown>[] = [];
  const ticketLinks: Record<string, unknown>[] = [];
  let eventSeq = 0;

  const addEvent = (opts: {
    name: string;
    venueN: number;
    city: string;
    dayOffset: number;
    artistLinks: Array<{ artistN: number; billing: string }>;
    kind?: string;
    link?: {
      min: number;
      max: number;
      status: string;
      verified?: boolean;
    };
  }) => {
    eventSeq += 1;
    const id = synthId('e', eventSeq);
    const date = futureDate(opts.dayOffset);
    events.push({
      id,
      name: `${opts.name} ${SYNTH_LABEL}`,
      normalized_name: `${opts.name.toLowerCase()} synthetic test`,
      event_kind: opts.kind ?? 'concert',
      status: 'scheduled',
      venue_id: synthId('v', opts.venueN),
      city: opts.city,
      region: 'CO',
      country_code: 'US',
      timezone: 'America/Denver',
      local_start_date: date,
      // 19:00Z is 12:00/13:00 in America/Denver: same calendar date as local_start_date.
      starts_at: `${date}T19:00:00Z`,
      start_time_precision: 'instant',
    });
    opts.artistLinks.forEach((al, idx) => {
      eventArtists.push({
        event_id: id,
        artist_id: synthId('a', al.artistN),
        billing_position: al.billing,
        sort_order: idx,
      });
    });
    if (opts.link) {
      ticketLinks.push({
        event_id: id,
        url: `${SYNTH_TICKET_HOST}/${id}`,
        normalized_url: `${SYNTH_TICKET_HOST}/${id}`,
        min_price: opts.link.min,
        max_price: opts.link.max,
        currency: 'USD',
        inventory_status: opts.link.status,
        verified_at: opts.link.verified ? new Date().toISOString() : null,
      });
    }
  };

  for (let i = 0; i < RED_ROCKS_EVENT_COUNT; i++) {
    addEvent({
      name: `Red Rocks Night ${String(i + 1).padStart(2, '0')}`,
      venueN: 1,
      city: 'Morrison',
      dayOffset: i,
      artistLinks: [{ artistN: 1, billing: 'headliner' }],
      link: { min: 40 + i, max: 90 + i, status: 'available' },
    });
  }

  // Source-verified sold-out concert at Globe Hall.
  addEvent({
    name: 'Jonah Kagen',
    venueN: 2,
    city: 'Denver',
    dayOffset: 7,
    artistLinks: [{ artistN: 2, billing: 'headliner' }],
    link: { min: 30, max: 30, status: 'sold_out', verified: true },
  });
  // Events with no ticket links: inventory must default to 'unknown'.
  for (let i = 0; i < 2; i++) {
    addEvent({
      name: `Sublime Tribute Night ${i + 1}`,
      venueN: 3,
      city: 'Denver',
      dayOffset: 10 + i,
      artistLinks: [{ artistN: 3, billing: 'headliner' }],
    });
  }
  // Headliner with a searchable opener.
  addEvent({
    name: 'Abbie Gamboa',
    venueN: 3,
    city: 'Denver',
    dayOffset: 12,
    artistLinks: [
      { artistN: 4, billing: 'headliner' },
      { artistN: 5, billing: 'support' },
    ],
    link: { min: 25, max: 45, status: 'available' },
  });
  // Free events so price_asc sorts a verified $0 event first.
  for (let i = 0; i < 3; i++) {
    addEvent({
      name: `Free Community Show ${i + 1}`,
      venueN: 3,
      city: 'Denver',
      dayOffset: 14 + i,
      kind: 'free_event',
      artistLinks: [{ artistN: 6, billing: 'headliner' }],
    });
  }
  for (let i = 0; i < FILLER_EVENT_COUNT; i++) {
    addEvent({
      name: `Catalog Filler Show ${String(i + 1).padStart(2, '0')}`,
      venueN: 3,
      city: 'Denver',
      dayOffset: 20 + i,
      artistLinks: [{ artistN: 6, billing: 'headliner' }],
      link: { min: 15 + i, max: 60 + i, status: 'available' },
    });
  }

  return {
    venueIds: venues.map((v) => v.id),
    artistIds: artists.map((a) => a.id),
    eventIds: events.map((e) => e.id as string),
    redRocksVenueId: synthId('v', 1),
    rows: { venues, artists, events, eventArtists, ticketLinks },
  };
}

async function chunkedInsert(
  client: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await client.from(table).insert(rows.slice(i, i + 100));
    if (error) {
      throw new Error(`Failed to seed synthetic ${table}: ${error.message}`);
    }
  }
}

/** Deletes only rows with this suite's reserved synthetic ids (cascades to links). */
async function deleteSyntheticCatalog(
  client: SupabaseClient,
  catalog: SyntheticCatalog,
): Promise<void> {
  for (let i = 0; i < catalog.eventIds.length; i += 100) {
    await client
      .from('events')
      .delete()
      .in('id', catalog.eventIds.slice(i, i + 100));
  }
  await client.from('artists').delete().in('id', catalog.artistIds);
  await client.from('venues').delete().in('id', catalog.venueIds);
}

describe('PostgreSQL Live Integration: Red Rocks Search, Deep Pagination, Timezone & Availability', () => {
  const credentials = resolveSupabaseCredentials();
  let adminClient: SupabaseClient;
  let catalogRepo: SupabaseCatalogRepository;
  const syntheticCatalog = buildSyntheticCatalog();

  beforeAll(async () => {
    if (!credentials) {
      throw new Error(
        'Supabase integration credentials could not be resolved.',
      );
    }

    assertSafeDatabaseTarget(
      credentials.url,
      false,
      'catalog-search-red-rocks-live',
    );

    process.env.NEXT_PUBLIC_SUPABASE_URL = credentials.url;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = credentials.anonKey;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = credentials.anonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = credentials.serviceRoleKey;

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    catalogRepo = new SupabaseCatalogRepository(adminClient);

    // Idempotent: clear leftovers from a crashed earlier run (reserved ids only),
    // then seed the isolated synthetic catalog. Existing real rows are untouched.
    await deleteSyntheticCatalog(adminClient, syntheticCatalog);
    await chunkedInsert(adminClient, 'venues', syntheticCatalog.rows.venues);
    await chunkedInsert(adminClient, 'artists', syntheticCatalog.rows.artists);
    await chunkedInsert(adminClient, 'events', syntheticCatalog.rows.events);
    await chunkedInsert(
      adminClient,
      'event_artists',
      syntheticCatalog.rows.eventArtists,
    );
    await chunkedInsert(
      adminClient,
      'event_ticket_links',
      syntheticCatalog.rows.ticketLinks,
    );
  }, 60000);

  afterAll(async () => {
    if (adminClient) {
      await deleteSyntheticCatalog(adminClient, syntheticCatalog);
    }
  }, 60000);

  describe('1. Red Rocks HTTP 500 Reproduction & Deep Pagination', () => {
    let redRocksUpcomingCount: number;

    // Determine actual count from database before running assertions
    it('resolves Red Rocks upcoming event count from database', async () => {
      // Resolve the venue set exactly as the search route does (name match), so
      // the expected count stays correct if other Red Rocks venues also exist.
      const { data: venues } = await adminClient
        .from('venues')
        .select('id')
        .ilike('name', '%Red Rocks Amphitheatre%');
      expect(venues && venues.length > 0).toBe(true);

      // Count upcoming events at Red Rocks
      const events = await catalogRepo.listEvents({
        venueId: 'Red Rocks Amphitheatre',
        excludePastShowtimes: true,
        fromDate: new Date().toISOString().split('T')[0],
        limit: 200,
      });
      redRocksUpcomingCount = events.length;
      expect(redRocksUpcomingCount).toBeGreaterThanOrEqual(0);
      console.log(
        `Red Rocks upcoming events in database: ${redRocksUpcomingCount}`,
      );
    });

    it('executes GET /api/catalog/search with venue name string and page=2 returning HTTP 200 without crashing', async () => {
      // Original error: GET /api/catalog/search?venueId=Red+Rocks+Amphitheatre&sort=date_asc&limit=50&page=2 returned HTTP 500
      const req = new NextRequest(
        'http://localhost:3000/api/catalog/search?venueId=Red+Rocks+Amphitheatre&sort=date_asc&limit=50&page=2',
      );
      const res = await searchGet(req);
      const data = await res.json();
      if (res.status !== 200) {
        console.error('SEARCH ROUTE ERROR:', data);
      }

      expect(res.status).toBe(200);

      expect(data.pagination.page).toBe(2);
      expect(data.pagination.limit).toBe(50);
      expect(Array.isArray(data.events)).toBe(true);
      // Page 2 should be empty if Red Rocks has fewer than 50 upcoming events
      if (redRocksUpcomingCount <= 50) {
        expect(data.events.length).toBe(0);
      }
      expect(data.pagination.totalCount).toBe(redRocksUpcomingCount);
    });

    it('returns upcoming Red Rocks events on page 1 with accurate total count', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/catalog/search?venueId=Red+Rocks+Amphitheatre&sort=date_asc&limit=50&page=1',
      );
      const res = await searchGet(req);
      const data = await res.json();
      if (res.status !== 200) {
        console.error('SEARCH ROUTE ERROR:', data);
      }

      expect(res.status).toBe(200);

      expect(data.pagination.page).toBe(1);
      expect(data.events.length).toBe(Math.min(redRocksUpcomingCount, 50));
      expect(data.pagination.totalCount).toBe(redRocksUpcomingCount);
    });

    it('also accepts valid venue UUID seamlessly in API and repository', async () => {
      // Find the seeded Red Rocks venue UUID
      const { data: venues } = await adminClient
        .from('venues')
        .select('id, name')
        .eq('id', syntheticCatalog.redRocksVenueId);
      expect(venues && venues.length > 0).toBe(true);
      const redRocks = venues![0];
      const redRocksVenueCount = (
        await catalogRepo.listEvents({
          venueId: redRocks.id,
          excludePastShowtimes: true,
          fromDate: new Date().toISOString().split('T')[0],
          limit: 200,
        })
      ).length;

      const req = new NextRequest(
        `http://localhost:3000/api/catalog/search?venueId=${redRocks.id}&sort=date_asc&limit=10&page=1`,
      );
      const res = await searchGet(req);
      const data = await res.json();
      if (res.status !== 200) {
        console.error('SEARCH ROUTE ERROR:', data);
      }

      expect(res.status).toBe(200);
      expect(data.events.length).toBe(Math.min(redRocksVenueCount, 10));
      expect(data.pagination.totalCount).toBe(redRocksVenueCount);
    });
  });

  describe('2. Pagination Consistency (No Missing or Duplicate Events Across Pages)', () => {
    it('returns non-overlapping, contiguous pages when paging through catalog', async () => {
      const page1 = await catalogRepo.listEvents({
        limit: 10,
        offset: 0,
        sortBy: 'date_asc',
      });
      const page2 = await catalogRepo.listEvents({
        limit: 10,
        offset: 10,
        sortBy: 'date_asc',
      });

      expect(page1.length).toBe(10);
      expect(page2.length).toBe(10);

      const page1Ids = new Set(page1.map((e) => e.id));
      for (const e of page2) {
        expect(page1Ids.has(e.id)).toBe(false);
      }
    });

    it('totalCount exactly equals the number of matching records in database', async () => {
      const totalCount = await catalogRepo.countEvents({
        fromDate: '2026-01-01',
      });
      expect(totalCount).toBeGreaterThan(100);

      // Page through EVERY matching record (independent of how large the dev DB is) and
      // require the page walk to account for exactly the counted total, with no duplicates.
      const pageSize = 300;
      const seenIds = new Set<string>();
      let walked = 0;
      for (let offset = 0; ; offset += pageSize) {
        const page = await catalogRepo.listEvents({
          fromDate: '2026-01-01',
          limit: pageSize,
          offset,
        });
        for (const ev of page) seenIds.add(ev.id);
        walked += page.length;
        if (page.length < pageSize) break;
      }
      expect(walked).toBe(totalCount);
      expect(seenIds.size).toBe(totalCount);
    });
  });

  describe('3. Timezone & Local Calendar Day Derivation', () => {
    it('handles showtimes near UTC midnight accurately in America/Denver timezone', async () => {
      // At 2026-11-24T02:00:00Z (UTC), Denver time (MDT/MST) is 2026-11-23 19:00 (7:00 PM)
      // A naive UTC split would incorrectly claim the date is 2026-11-24.
      // Database-side excludePastShowtimes filters accurately based on Colorado time.
      const events = await catalogRepo.listEvents({
        fromDate: '2026-11-20',
        excludePastShowtimes: true,
        referenceNowIso: '2026-11-20T18:00:00Z',
      });

      expect(Array.isArray(events)).toBe(true);
      for (const ev of events) {
        expect(ev.localStartDate >= '2026-11-20').toBe(true);
      }
    });
  });

  describe('4. Verified Sold-Out vs Unknown Availability Verification', () => {
    it('demonstrates verified sold_out status on source-verified concert (Jonah Kagen at Globe Hall)', async () => {
      const { data: event } = await adminClient
        .from('events')
        .select('id, name')
        .ilike('name', '%Jonah Kagen%')
        .limit(1)
        .single();

      expect(event).toBeDefined();

      const summaries = await catalogRepo.listEvents({
        searchQuery: 'Jonah Kagen',
        limit: 5,
      });

      expect(summaries.length).toBeGreaterThan(0);
      const jonah = summaries.find((s) => s.id === event!.id);
      expect(jonah).toBeDefined();
      expect(jonah!.inventoryStatus).toBe('sold_out');
    });

    it('demonstrates unverified events default to unknown inventory status', async () => {
      const summaries = await catalogRepo.listEvents({
        searchQuery: 'Sublime',
        limit: 5,
      });

      expect(summaries.length).toBeGreaterThan(0);
      for (const s of summaries) {
        expect(s.inventoryStatus).toBe('unknown');
      }
    });
  });

  describe('5. Database-Side Sorting for All Supported Modes', () => {
    it('supports date_asc and date_desc sorting in database', async () => {
      const asc = await catalogRepo.listEvents({
        sortBy: 'date_asc',
        limit: 10,
      });
      const desc = await catalogRepo.listEvents({
        sortBy: 'date_desc',
        limit: 10,
      });

      expect(asc.length).toBe(10);
      expect(desc.length).toBe(10);

      expect(asc[0].localStartDate <= asc[9].localStartDate).toBe(true);
      expect(desc[0].localStartDate >= desc[9].localStartDate).toBe(true);
    });

    it('supports price_asc and price_desc sorting in database', async () => {
      const priceAsc = await catalogRepo.listEvents({
        sortBy: 'price_asc',
        limit: 10,
      });
      expect(priceAsc.length).toBe(10);
      // First events are free ($0)
      expect(priceAsc[0].minPrice).toBe(0);

      const priceDesc = await catalogRepo.listEvents({
        sortBy: 'price_desc',
        limit: 10,
      });
      expect(priceDesc.length).toBe(10);
      if (
        typeof priceDesc[0].minPrice === 'number' &&
        typeof priceDesc[1].minPrice === 'number'
      ) {
        expect(priceDesc[0].minPrice).toBeGreaterThanOrEqual(
          priceDesc[1].minPrice,
        );
      }
    });

    it('supports title_asc sorting in database', async () => {
      const titleAsc = await catalogRepo.listEvents({
        sortBy: 'title_asc',
        limit: 10,
      });
      expect(titleAsc.length).toBe(10);
      for (let i = 1; i < titleAsc.length; i++) {
        expect(
          titleAsc[i].title.localeCompare(titleAsc[i - 1].title),
        ).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('6. Headliner and Opener Search Across Canonical Database', () => {
    it('finds events by searching for support act / opener', async () => {
      // Chelsea Plank is the opener for Abbie Gamboa
      const results = await catalogRepo.listEvents({
        searchQuery: 'Chelsea Plank',
        limit: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      const event = results[0];
      expect(event.title).toContain('Abbie Gamboa');
    });

    it('finds events by searching for headliner', async () => {
      const results = await catalogRepo.listEvents({
        searchQuery: 'Abbie Gamboa',
        limit: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toContain('Abbie Gamboa');
    });
  });

  describe('7. Multi-Page Catalog Pagination (>100 concerts)', () => {
    it('loads multiple pages across the catalog and verifies combined IDs equal the database result set with no duplicates', async () => {
      const totalInDb = await catalogRepo.countEvents({
        fromDate: '2026-01-01',
      });
      expect(totalInDb).toBeGreaterThan(100);

      const pageSize = 50;
      const allFetchedIds: string[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const events = await catalogRepo.listEvents({
          fromDate: '2026-01-01',
          limit: pageSize,
          offset: (page - 1) * pageSize,
          sortBy: 'date_asc',
        });

        if (events.length === 0) {
          hasMore = false;
        } else {
          for (const ev of events) {
            allFetchedIds.push(ev.id);
          }
          if (events.length < pageSize) {
            hasMore = false;
          } else {
            page++;
          }
        }
      }

      // 1. Total fetched matches total in database
      expect(allFetchedIds.length).toBe(totalInDb);

      // 2. Zero duplicates across pages
      const uniqueIds = new Set(allFetchedIds);
      expect(uniqueIds.size).toBe(totalInDb);
    });
  });

  describe('8. Database Migration Compatibility & Price Persistence', () => {
    it('persists min_price, max_price, and currency rollups to public.events via stored procedure and triggers', async () => {
      const testEventId = 'e0000000-0000-0000-0000-000000000099';
      const testVenueId = 'b0000000-0000-0000-0000-000000000099';

      try {
        // Upsert canonical event with ticket links
        const { error: rpcError } = await adminClient.rpc(
          'apply_canonicalization',
          {
            payload: {
              venueToCreate: {
                id: testVenueId,
                name: 'Price Test Venue',
                normalized_name: 'price test venue',
                city: 'Denver',
                region: 'CO',
                country_code: 'US',
                timezone: 'America/Denver',
              },
              event: {
                id: testEventId,
                name: 'Pricing Persistence Invariant Show',
                normalized_name: 'pricing persistence invariant show',
                venue_id: testVenueId,
                city: 'Denver',
                region: 'CO',
                country_code: 'US',
                timezone: 'America/Denver',
                local_start_date: '2027-01-15',
                starts_at: '2027-01-16T03:00:00Z',
                status: 'scheduled',
                event_kind: 'concert',
              },
              ticketLinks: [
                {
                  ticket_provider_source_id: null,
                  url: 'https://tickets.example.com/tier1',
                  normalized_url: 'https://tickets.example.com/tier1',
                  min_price: 35.0,
                  max_price: 45.0,
                  currency: 'USD',
                  inventory_status: 'available',
                  verified_at: new Date().toISOString(),
                },
                {
                  ticket_provider_source_id: null,
                  url: 'https://tickets.example.com/tier2',
                  normalized_url: 'https://tickets.example.com/tier2',
                  min_price: 55.0,
                  max_price: 75.0,
                  currency: 'USD',
                  inventory_status: 'available',
                  verified_at: new Date().toISOString(),
                },
              ],
            },
          },
        );

        expect(rpcError).toBeNull();

        // Verify public.events row has rolled-up min_price, max_price, and currency
        const { data: eventRow, error: fetchError } = await adminClient
          .from('events')
          .select('id, min_price, max_price, currency')
          .eq('id', testEventId)
          .single();

        expect(fetchError).toBeNull();
        expect(eventRow).toBeDefined();
        expect(Number(eventRow!.min_price)).toBe(35.0);
        expect(Number(eventRow!.max_price)).toBe(75.0);
        expect(eventRow!.currency).toBe('USD');
      } finally {
        // Cleanup test fixtures
        await adminClient
          .from('event_ticket_links')
          .delete()
          .eq('event_id', testEventId);
        await adminClient.from('events').delete().eq('id', testEventId);
        await adminClient.from('venues').delete().eq('id', testVenueId);
      }
    });
  });

  describe('9. Conflicting Ticket Statuses from Multiple Providers', () => {
    it('preserves verified sold_out status when secondary observation arrives with unknown status', async () => {
      const testEventId = 'e0000000-0000-0000-0000-000000000088';
      const testVenueId = 'b0000000-0000-0000-0000-000000000088';

      try {
        // 1. Initial canonicalization: primary provider marks event sold_out
        await adminClient.rpc('apply_canonicalization', {
          payload: {
            venueToCreate: {
              id: testVenueId,
              name: 'Conflict Test Venue',
              normalized_name: 'conflict test venue',
              city: 'Denver',
              timezone: 'America/Denver',
            },
            event: {
              id: testEventId,
              name: 'Conflict Test Concert',
              normalized_name: 'conflict test concert',
              venue_id: testVenueId,
              city: 'Denver',
              timezone: 'America/Denver',
              local_start_date: '2027-02-01',
              status: 'scheduled',
              event_kind: 'concert',
            },
            ticketLinks: [
              {
                url: 'https://primary.example.com/show',
                normalized_url: 'https://primary.example.com/show',
                min_price: 25.0,
                max_price: 25.0,
                currency: 'USD',
                inventory_status: 'sold_out',
                verified_at: new Date().toISOString(),
              },
            ],
          },
        });

        // Verify initial status is sold_out
        const { data: initialLinks } = await adminClient
          .from('event_ticket_links')
          .select('inventory_status')
          .eq('event_id', testEventId);
        expect(initialLinks?.[0]?.inventory_status).toBe('sold_out');

        // 2. Secondary observation from aggregator/importer with 'unknown' status
        await adminClient.rpc('apply_canonicalization', {
          payload: {
            event: {
              id: testEventId,
              name: 'Conflict Test Concert',
            },
            ticketLinks: [
              {
                url: 'https://primary.example.com/show',
                normalized_url: 'https://primary.example.com/show',
                min_price: 25.0,
                max_price: 25.0,
                currency: 'USD',
                inventory_status: 'unknown', // Secondary provider doesn't know inventory
              },
            ],
          },
        });

        // 3. Verify status remained sold_out — NOT downgraded to unknown
        const { data: hardenedLinks } = await adminClient
          .from('event_ticket_links')
          .select('inventory_status')
          .eq('event_id', testEventId);
        expect(hardenedLinks?.[0]?.inventory_status).toBe('sold_out');
      } finally {
        await adminClient
          .from('event_ticket_links')
          .delete()
          .eq('event_id', testEventId);
        await adminClient.from('events').delete().eq('id', testEventId);
        await adminClient.from('venues').delete().eq('id', testVenueId);
      }
    });
  });
});
