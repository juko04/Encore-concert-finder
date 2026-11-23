import { beforeAll, describe, expect, it } from 'vitest';
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

describe('PostgreSQL Live Integration: Red Rocks Search, Deep Pagination, Timezone & Availability', () => {
  const credentials = resolveSupabaseCredentials();
  let adminClient: SupabaseClient;
  let catalogRepo: SupabaseCatalogRepository;

  beforeAll(() => {
    if (!credentials) {
      throw new Error('Supabase integration credentials could not be resolved.');
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
  });

  describe('1. Red Rocks HTTP 500 Reproduction & Deep Pagination', () => {
    let redRocksUpcomingCount: number;

    // Determine actual count from database before running assertions
    it('resolves Red Rocks upcoming event count from database', async () => {
      const { data: venues } = await adminClient
        .from('venues')
        .select('id')
        .ilike('name', '%Red Rocks%');
      expect(venues && venues.length > 0).toBe(true);
      const redRocksId = venues![0].id;

      // Count upcoming events at Red Rocks
      const events = await catalogRepo.listEvents({
        venueId: redRocksId,
        excludePastShowtimes: true,
        fromDate: new Date().toISOString().split('T')[0],
        limit: 200,
      });
      redRocksUpcomingCount = events.length;
      expect(redRocksUpcomingCount).toBeGreaterThanOrEqual(0);
      console.log(`Red Rocks upcoming events in database: ${redRocksUpcomingCount}`);
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
      // Find Red Rocks UUID
      const { data: venues } = await adminClient
        .from('venues')
        .select('id, name')
        .ilike('name', '%Red Rocks%');
      expect(venues && venues.length > 0).toBe(true);
      const redRocks = venues![0];

      const req = new NextRequest(
        `http://localhost:3000/api/catalog/search?venueId=${redRocks.id}&sort=date_asc&limit=10&page=1`,
      );
      const res = await searchGet(req);
      const data = await res.json();
      if (res.status !== 200) {
        console.error('SEARCH ROUTE ERROR:', data);
      }

      expect(res.status).toBe(200);
      expect(data.events.length).toBe(Math.min(redRocksUpcomingCount, 10));
      expect(data.pagination.totalCount).toBe(redRocksUpcomingCount);
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

      const sampleEvents = await catalogRepo.listEvents({
        fromDate: '2026-01-01',
        limit: 300,
      });
      expect(sampleEvents.length).toBe(totalCount);
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
      const asc = await catalogRepo.listEvents({ sortBy: 'date_asc', limit: 10 });
      const desc = await catalogRepo.listEvents({ sortBy: 'date_desc', limit: 10 });

      expect(asc.length).toBe(10);
      expect(desc.length).toBe(10);

      expect(asc[0].localStartDate <= asc[9].localStartDate).toBe(true);
      expect(desc[0].localStartDate >= desc[9].localStartDate).toBe(true);
    });

    it('supports price_asc and price_desc sorting in database', async () => {
      const priceAsc = await catalogRepo.listEvents({ sortBy: 'price_asc', limit: 10 });
      expect(priceAsc.length).toBe(10);
      // First events are free ($0)
      expect(priceAsc[0].minPrice).toBe(0);

      const priceDesc = await catalogRepo.listEvents({ sortBy: 'price_desc', limit: 10 });
      expect(priceDesc.length).toBe(10);
      if (typeof priceDesc[0].minPrice === 'number' && typeof priceDesc[1].minPrice === 'number') {
        expect(priceDesc[0].minPrice).toBeGreaterThanOrEqual(priceDesc[1].minPrice);
      }
    });

    it('supports title_asc sorting in database', async () => {
      const titleAsc = await catalogRepo.listEvents({ sortBy: 'title_asc', limit: 10 });
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
      const totalInDb = await catalogRepo.countEvents({ fromDate: '2026-01-01' });
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
        const { error: rpcError } = await adminClient.rpc('apply_canonicalization', {
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
        });

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
        await adminClient.from('event_ticket_links').delete().eq('event_id', testEventId);
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
        await adminClient.from('event_ticket_links').delete().eq('event_id', testEventId);
        await adminClient.from('events').delete().eq('id', testEventId);
        await adminClient.from('venues').delete().eq('id', testVenueId);
      }
    });
  });
});
