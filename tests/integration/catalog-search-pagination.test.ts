import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';

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
    return {
      url,
      anonKey,
      serviceRoleKey,
    };
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
    // Supabase CLI status not available
  }

  return null;
}

describe('PostgreSQL Integration: Catalog Search, Pagination & Global Pricing (>500 Events)', () => {
  const credentials = resolveSupabaseCredentials();
  let adminClient: SupabaseClient | null = null;
  let catalogRepo: SupabaseCatalogRepository | null = null;

  const testEventIds: string[] = [];
  const testArtistIds: string[] = [];
  const testVenueIds: string[] = [];

  let standardVenueId: string;
  let deepHiddenVenueId: string;
  let commonArtistId: string;
  let deepHiddenOpenerArtistId: string;
  let deepHiddenHeadlinerArtistId: string;

  beforeAll(async () => {
    if (!credentials) {
      throw new Error(
        '[catalog-search-pagination.test] Required Supabase integration test credentials could not be resolved.',
      );
    }

    assertSafeDatabaseTarget(
      credentials.url,
      false,
      'catalog-search-pagination-integration',
    );

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    catalogRepo = new SupabaseCatalogRepository(adminClient);

    // 1. Create Venues
    const { data: v1, error: v1Err } = await adminClient
      .from('venues')
      .insert({
        name: 'Standard Pagination Arena',
        normalized_name: 'standard pagination arena',
        city: 'Denver',
        region: 'CO',
        country_code: 'US',
        timezone: 'America/Denver',
      })
      .select('id')
      .single();
    if (v1Err) throw new Error(`Failed to create venue 1: ${v1Err.message}`);
    standardVenueId = v1.id;
    testVenueIds.push(standardVenueId);

    const { data: v2, error: v2Err } = await adminClient
      .from('venues')
      .insert({
        name: 'Deep Hidden Speakeasy Venue',
        normalized_name: 'deep hidden speakeasy venue',
        city: 'Boulder',
        region: 'CO',
        country_code: 'US',
        timezone: 'America/Denver',
      })
      .select('id')
      .single();
    if (v2Err) throw new Error(`Failed to create venue 2: ${v2Err.message}`);
    deepHiddenVenueId = v2.id;
    testVenueIds.push(deepHiddenVenueId);

    // 2. Create Artists
    const { data: a1, error: a1Err } = await adminClient
      .from('artists')
      .insert({
        name: 'Common Headliner Band',
        normalized_name: 'common headliner band',
      })
      .select('id')
      .single();
    if (a1Err) throw new Error(`Failed to create artist 1: ${a1Err.message}`);
    commonArtistId = a1.id;
    testArtistIds.push(commonArtistId);

    const { data: a2, error: a2Err } = await adminClient
      .from('artists')
      .insert({
        name: 'Deep Hidden Opener Act',
        normalized_name: 'deep hidden opener act',
      })
      .select('id')
      .single();
    if (a2Err) throw new Error(`Failed to create artist 2: ${a2Err.message}`);
    deepHiddenOpenerArtistId = a2.id;
    testArtistIds.push(deepHiddenOpenerArtistId);

    const { data: a3, error: a3Err } = await adminClient
      .from('artists')
      .insert({
        name: 'Deep Hidden Headliner Star',
        normalized_name: 'deep hidden headliner star',
      })
      .select('id')
      .single();
    if (a3Err) throw new Error(`Failed to create artist 3: ${a3Err.message}`);
    deepHiddenHeadlinerArtistId = a3.id;
    testArtistIds.push(deepHiddenHeadlinerArtistId);

    // 3. Batch Create 520 Events
    // Distribute local_start_date from 2029-01-01 upwards to prevent overlapping with existing events
    // Event 516 (chronologically placed on day 516) is given a bargain price of $5.00
    // Event 515 is given a luxury price of $500.00
    // Event 518 is at Deep Hidden Speakeasy Venue
    // Event 519 has Deep Hidden Opener Act as support
    // Event 520 has Deep Hidden Headliner Star as headliner
    // 10 events are free_event ($0)
    // 15 events have no ticket links (unknown price)

    const TOTAL_EVENTS = 520;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventRows: any[] = [];
    const baseDate = new Date('2029-01-01T00:00:00Z');

    for (let i = 0; i < TOTAL_EVENTS; i++) {
      const eventDate = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = eventDate.toISOString().split('T')[0];
      const isFree = i < 10;
      const isDeepVenue = i === 517;
      const venueId = isDeepVenue ? deepHiddenVenueId : standardVenueId;

      eventRows.push({
        name: `Pagination Test Concert #${i + 1}`,
        normalized_name: `pagination test concert #${i + 1}`,
        event_kind: isFree ? 'free_event' : 'concert',
        status: 'scheduled',
        venue_id: venueId,
        city: isDeepVenue ? 'Boulder' : 'Denver',
        region: 'CO',
        country_code: 'US',
        timezone: 'America/Denver',
        local_start_date: dateStr,
        starts_at: `${dateStr}T20:00:00-07:00`,
        start_time_precision: 'instant',
      });
    }

    // Insert events in chunks of 100
    for (let i = 0; i < eventRows.length; i += 100) {
      const chunk = eventRows.slice(i, i + 100);
      const { data, error } = await adminClient
        .from('events')
        .insert(chunk)
        .select('id');
      if (error) {
        throw new Error(
          `Failed to batch-insert events chunk: ${error.message}`,
        );
      }
      for (const row of data || []) {
        testEventIds.push(row.id);
      }
    }

    // 4. Batch Create Event Artists
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventArtistRows: any[] = [];
    for (let i = 0; i < testEventIds.length; i++) {
      const eventId = testEventIds[i];
      if (i === 518) {
        // Event 519: Common headliner + Deep Hidden Opener as support
        eventArtistRows.push({
          event_id: eventId,
          artist_id: commonArtistId,
          billing_position: 'headliner',
          sort_order: 0,
        });
        eventArtistRows.push({
          event_id: eventId,
          artist_id: deepHiddenOpenerArtistId,
          billing_position: 'support',
          sort_order: 1,
        });
      } else if (i === 519) {
        // Event 520: Deep Hidden Headliner
        eventArtistRows.push({
          event_id: eventId,
          artist_id: deepHiddenHeadlinerArtistId,
          billing_position: 'headliner',
          sort_order: 0,
        });
      } else {
        eventArtistRows.push({
          event_id: eventId,
          artist_id: commonArtistId,
          billing_position: 'headliner',
          sort_order: 0,
        });
      }
    }

    for (let i = 0; i < eventArtistRows.length; i += 100) {
      const chunk = eventArtistRows.slice(i, i + 100);
      const { error } = await adminClient.from('event_artists').insert(chunk);
      if (error) {
        throw new Error(
          `Failed to batch-insert event artists: ${error.message}`,
        );
      }
    }

    // 5. Batch Create Ticket Links
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ticketLinkRows: any[] = [];
    for (let i = 0; i < testEventIds.length; i++) {
      const eventId = testEventIds[i];
      // Skip ticket links for events 10..24 (unknown price)
      if (i >= 10 && i < 25) {
        continue;
      }

      let minP = 25.0;
      let maxP = 75.0;

      if (i < 10) {
        // Free event
        minP = 0.0;
        maxP = 0.0;
      } else if (i === 514) {
        // Luxury event 515: $500.00
        minP = 500.0;
        maxP = 850.0;
      } else if (i === 515) {
        // Bargain event 516 (at index 515, chronologically far in 2029): $5.00
        minP = 5.0;
        maxP = 15.0;
      } else if (i === 516) {
        // Event 517: $10.00
        minP = 10.0;
        maxP = 20.0;
      } else {
        // Spread prices from 20 to 250
        minP = 20 + (i % 230);
        maxP = minP + 35;
      }

      ticketLinkRows.push({
        event_id: eventId,
        url: `https://tickets.example.com/pagination-test/${eventId}`,
        normalized_url: `https://tickets.example.com/pagination-test/${eventId}`,
        min_price: minP,
        max_price: maxP,
        currency: 'USD',
        inventory_status: 'available',
      });
    }

    for (let i = 0; i < ticketLinkRows.length; i += 100) {
      const chunk = ticketLinkRows.slice(i, i + 100);
      const { error } = await adminClient
        .from('event_ticket_links')
        .insert(chunk);
      if (error) {
        throw new Error(
          `Failed to batch-insert ticket links: ${error.message}`,
        );
      }
    }
  }, 60000);

  afterAll(async () => {
    if (adminClient && testEventIds.length > 0) {
      for (let i = 0; i < testEventIds.length; i += 100) {
        const chunk = testEventIds.slice(i, i + 100);
        await adminClient.from('events').delete().in('id', chunk);
      }
    }
    if (adminClient && testArtistIds.length > 0) {
      await adminClient.from('artists').delete().in('id', testArtistIds);
    }
    if (adminClient && testVenueIds.length > 0) {
      await adminClient.from('venues').delete().in('id', testVenueIds);
    }
  }, 30000);

  it('accurately counts total catalog events including the 520 test records via countEvents', async () => {
    const totalCount = await catalogRepo!.countEvents({
      fromDate: '2029-01-01',
      toDate: '2030-12-31',
    });
    expect(totalCount).toBe(520);
  });

  it('discovers matching events, artists, openers, and venues located beyond the first 300 records', async () => {
    // 1. Search for venue located at record 518 (>300)
    const venueSearch = await catalogRepo!.listEvents({
      searchQuery: 'Deep Hidden Speakeasy',
      fromDate: '2029-01-01',
    });
    expect(venueSearch.length).toBe(1);
    expect(venueSearch[0].venueName).toBe('Deep Hidden Speakeasy Venue');
    expect(venueSearch[0].id).toBe(testEventIds[517]);

    // 2. Search for opener artist located at record 519 (>300)
    const openerSearch = await catalogRepo!.listEvents({
      searchQuery: 'Deep Hidden Opener',
      fromDate: '2029-01-01',
    });
    expect(openerSearch.length).toBe(1);
    expect(openerSearch[0].id).toBe(testEventIds[518]);
    expect(
      openerSearch[0].artists.some(
        (a) =>
          a.name === 'Deep Hidden Opener Act' &&
          a.billingPosition === 'support',
      ),
    ).toBe(true);

    // 3. Search for headliner artist located at record 520 (>300)
    const headlinerSearch = await catalogRepo!.listEvents({
      searchQuery: 'Deep Hidden Headliner Star',
      fromDate: '2029-01-01',
    });
    expect(headlinerSearch.length).toBe(1);
    expect(headlinerSearch[0].id).toBe(testEventIds[519]);
    expect(headlinerSearch[0].artists[0].name).toBe(
      'Deep Hidden Headliner Star',
    );

    // 4. Server-side pagination beyond 300 records
    const pageBeyond300 = await catalogRepo!.listEvents({
      fromDate: '2029-01-01',
      offset: 350,
      limit: 50,
    });
    expect(pageBeyond300.length).toBe(50);
    expect(pageBeyond300[0].id).toBe(testEventIds[350]);
    expect(pageBeyond300[49].id).toBe(testEventIds[399]);
  });

  it('correctly executes global price sorting across the entire 500+ record dataset', async () => {
    // Event 516 (testEventIds[515]) is at the tail end of the chronological list (June 2030),
    // but is priced at $5.00. Global price_asc sorting must pull it into the very first page!
    const priceAscPage1 = await catalogRepo!.listEvents({
      fromDate: '2029-01-01',
      toDate: '2030-12-31',
      sortBy: 'price_asc',
      limit: 20,
      offset: 0,
    });

    expect(priceAscPage1.length).toBe(20);

    // First 10 items must be the free events ($0)
    for (let i = 0; i < 10; i++) {
      expect(priceAscPage1[i].minPrice).toBe(0);
    }

    // The 11th item (first paid item) must be our $5.00 event (Event 516)
    expect(priceAscPage1[10].minPrice).toBe(5);
    expect(priceAscPage1[10].id).toBe(testEventIds[515]);

    // The 12th item must be our $10.00 event (Event 517)
    expect(priceAscPage1[11].minPrice).toBe(10);
    expect(priceAscPage1[11].id).toBe(testEventIds[516]);

    // Monotonicity check across page 1 and page 2
    const priceAscPage2 = await catalogRepo!.listEvents({
      fromDate: '2029-01-01',
      toDate: '2030-12-31',
      sortBy: 'price_asc',
      limit: 20,
      offset: 20,
    });

    const combinedPrices = [...priceAscPage1, ...priceAscPage2].map(
      (e) => e.minPrice ?? Infinity,
    );
    for (let i = 1; i < combinedPrices.length; i++) {
      expect(combinedPrices[i]).toBeGreaterThanOrEqual(combinedPrices[i - 1]);
    }

    // Query global price_desc: top event must be our luxury $500.00 event (Event 515)
    const priceDescPage1 = await catalogRepo!.listEvents({
      fromDate: '2029-01-01',
      toDate: '2030-12-31',
      sortBy: 'price_desc',
      limit: 5,
      offset: 0,
    });

    expect(priceDescPage1[0].minPrice).toBe(500);
    expect(priceDescPage1[0].id).toBe(testEventIds[514]);
  });

  it('preserves unknown price events when includeUnknownPrice is true and excludes them when false', async () => {
    // 1. With maxPrice: 30 and includeUnknownPrice: true (default)
    // Should include:
    // - 10 free events ($0)
    // - 15 events with unknown price (no ticket links, minPrice = null)
    // - Events with minPrice <= 30 ($5, $10, and cheap ones)
    const withUnknown = await catalogRepo!.listEvents({
      fromDate: '2029-01-01',
      toDate: '2030-12-31',
      maxPrice: 30,
      includeUnknownPrice: true,
      limit: 500,
    });

    const hasNullPrice = withUnknown.some((e) => e.minPrice === null);
    expect(hasNullPrice).toBe(true);

    const unknownEvents = withUnknown.filter((e) => e.minPrice === null);
    expect(unknownEvents.length).toBe(15);

    // Verify all non-null events are <= 30
    for (const e of withUnknown) {
      if (e.minPrice !== null) {
        expect(e.minPrice).toBeLessThanOrEqual(30);
      }
    }

    // 2. With maxPrice: 30 and includeUnknownPrice: false
    // Should strictly exclude all events where minPrice is null
    const withoutUnknown = await catalogRepo!.listEvents({
      fromDate: '2029-01-01',
      toDate: '2030-12-31',
      maxPrice: 30,
      includeUnknownPrice: false,
      limit: 500,
    });

    expect(withoutUnknown.length).toBeGreaterThan(0);
    const hasAnyNull = withoutUnknown.some((e) => e.minPrice === null);
    expect(hasAnyNull).toBe(false);

    for (const e of withoutUnknown) {
      expect(e.minPrice).toBeDefined();
      expect(e.minPrice).not.toBeNull();
      expect(e.minPrice!).toBeLessThanOrEqual(30);
    }
  });
});
