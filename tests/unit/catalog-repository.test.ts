import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';

describe('SupabaseCatalogRepository - Chunked Artist Pagination (Unit Tests)', () => {
  interface MockEventData {
    id: string;
    name: string;
    local_start_date: string;
    artistIds: string[];
  }

  function createMockSupabaseClient(events: MockEventData[]) {
    const executedQueries: Array<{
      table: string;
      filters: Record<string, unknown>;
      limit?: number;
      range?: [number, number];
    }> = [];

    const mockClient = {
      from: (table: string) => {
        const queryState: {
          table: string;
          selected?: string;
          inFilters: Record<string, unknown[]>;
          eqFilters: Record<string, unknown>;
          orders: Array<{ column: string; ascending: boolean }>;
          limitVal?: number;
          rangeVal?: [number, number];
        } = {
          table,
          inFilters: {},
          eqFilters: {},
          orders: [],
        };

        const builder: Record<string, unknown> = {
          select: vi.fn((sel: string) => {
            queryState.selected = sel;
            return builder;
          }),
          in: vi.fn((col: string, vals: unknown[]) => {
            queryState.inFilters[col] = vals;
            return builder;
          }),
          eq: vi.fn((col: string, val: unknown) => {
            queryState.eqFilters[col] = val;
            return builder;
          }),
          order: vi.fn((col: string, opts?: { ascending: boolean }) => {
            queryState.orders.push({
              column: col,
              ascending: opts?.ascending ?? true,
            });
            return builder;
          }),
          gte: vi.fn(() => builder),
          lte: vi.fn(() => builder),
          ilike: vi.fn(() => builder),
          limit: vi.fn((l: number) => {
            queryState.limitVal = l;
            return builder;
          }),
          range: vi.fn((from: number, to: number) => {
            queryState.rangeVal = [from, to];
            return builder;
          }),
          then: (
            onfulfilled?: (value: { data: unknown[]; error: null }) => unknown,
          ) => {
            executedQueries.push({
              table: queryState.table,
              filters: { ...queryState.inFilters, ...queryState.eqFilters },
              limit: queryState.limitVal,
              range: queryState.rangeVal,
            });

            if (table === 'events') {
              // Filter mock events based on event_artists.artist_id
              const requestedArtistIds =
                (queryState.inFilters['event_artists.artist_id'] as string[]) ||
                [];
              let matched = events.filter((e) =>
                e.artistIds.some((aid) => requestedArtistIds.includes(aid)),
              );

              // Sort matching rows
              matched.sort(
                (a, b) =>
                  a.local_start_date.localeCompare(b.local_start_date) ||
                  a.id.localeCompare(b.id),
              );

              // Apply pagination
              if (queryState.rangeVal) {
                const [start, end] = queryState.rangeVal;
                matched = matched.slice(start, end + 1);
              } else if (queryState.limitVal !== undefined) {
                matched = matched.slice(0, queryState.limitVal);
              }

              const rows = matched.map((e) => ({
                id: e.id,
                name: e.name,
                normalized_name: e.name.toLowerCase(),
                event_kind: 'concert',
                status: 'scheduled',
                venue_id: 'venue-1',
                city: 'Denver',
                region: 'CO',
                country_code: 'US',
                lat: 39.75,
                lng: -104.99,
                timezone: 'America/Denver',
                local_start_date: e.local_start_date,
                local_end_date: null,
                starts_at: `${e.local_start_date}T20:00:00-07:00`,
                ends_at: null,
                start_time_precision: 'instant',
                doors_at: null,
                is_multi_day: false,
                official_url: null,
                primary_ticket_url: null,
                announced_at: null,
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
                venues: {
                  id: 'venue-1',
                  name: 'Mission Ballroom',
                  normalized_name: 'mission ballroom',
                  city: 'Denver',
                  region: 'CO',
                  country_code: 'US',
                  lat: 39.75,
                  lng: -104.99,
                  timezone: 'America/Denver',
                  website: null,
                  capacity: 3950,
                  created_at: '2026-01-01T00:00:00Z',
                  updated_at: '2026-01-01T00:00:00Z',
                },
              }));

              const result = { data: rows, error: null };
              return Promise.resolve(
                onfulfilled ? onfulfilled(result) : result,
              );
            }

            if (table === 'event_artists') {
              const eventIds =
                (queryState.inFilters['event_id'] as string[]) || [];
              const rows: unknown[] = [];
              for (const eid of eventIds) {
                const ev = events.find((e) => e.id === eid);
                if (ev) {
                  for (let i = 0; i < ev.artistIds.length; i++) {
                    const aid = ev.artistIds[i];
                    rows.push({
                      id: `ea-${eid}-${aid}`,
                      event_id: eid,
                      artist_id: aid,
                      billing_position: i === 0 ? 'headliner' : 'support',
                      sort_order: i + 1,
                      artists: {
                        id: aid,
                        name: `Artist ${aid}`,
                        normalized_name: `artist ${aid}`,
                        image_url: null,
                        created_at: '2026-01-01T00:00:00Z',
                        updated_at: '2026-01-01T00:00:00Z',
                        artist_external_ids: [
                          { provider: 'spotify', external_id: `spot-${aid}` },
                        ],
                      },
                    });
                  }
                }
              }
              const result = { data: rows, error: null };
              return Promise.resolve(
                onfulfilled ? onfulfilled(result) : result,
              );
            }

            if (table === 'event_ticket_links' || table === 'event_sources') {
              const result = { data: [], error: null };
              return Promise.resolve(
                onfulfilled ? onfulfilled(result) : result,
              );
            }

            const fallback = { data: [], error: null };
            return Promise.resolve(
              onfulfilled ? onfulfilled(fallback) : fallback,
            );
          },
        };

        return builder;
      },
    };

    return {
      client: mockClient as unknown as SupabaseClient,
      executedQueries,
    };
  }

  it('correctly chunks >50 artist IDs, does not pass offset to subqueries, and slices global page deterministically', async () => {
    // Generate 55 unique artist IDs
    const artistIds = Array.from({ length: 55 }, (_, i) => `artist-${i}`);

    // Create 8 events sharing the exact same localStartDate ('2026-11-20'),
    // interleaved across Chunk 0 (artists 0..49) and Chunk 1 (artists 50..54)
    const mockEvents: MockEventData[] = [
      {
        id: 'event-1',
        name: 'Show 1',
        local_start_date: '2026-11-20',
        artistIds: ['artist-0'], // chunk 0
      },
      {
        id: 'event-2',
        name: 'Show 2',
        local_start_date: '2026-11-20',
        artistIds: ['artist-50'], // chunk 1
      },
      {
        id: 'event-3',
        name: 'Show 3',
        local_start_date: '2026-11-20',
        artistIds: ['artist-1'], // chunk 0
      },
      {
        id: 'event-4',
        name: 'Show 4',
        local_start_date: '2026-11-20',
        artistIds: ['artist-51'], // chunk 1
      },
      {
        id: 'event-5',
        name: 'Show 5',
        local_start_date: '2026-11-20',
        artistIds: ['artist-2'], // chunk 0
      },
      {
        id: 'event-6',
        name: 'Show 6',
        local_start_date: '2026-11-20',
        artistIds: ['artist-52'], // chunk 1
      },
      {
        id: 'event-7',
        name: 'Show 7',
        local_start_date: '2026-11-20',
        artistIds: ['artist-3'], // chunk 0
      },
      {
        id: 'event-8',
        name: 'Show 8',
        local_start_date: '2026-11-20',
        artistIds: ['artist-53'], // chunk 1
      },
    ];

    const { client, executedQueries } = createMockSupabaseClient(mockEvents);
    const repo = new SupabaseCatalogRepository(client);

    // Request with 55 artist IDs, nonzero offset (offset: 2), and limit (limit: 4)
    // Global expected order before slice:
    // event-1, event-2, event-3, event-4, event-5, event-6, event-7, event-8
    // With offset: 2, limit: 4:
    // Slice(2, 6) -> event-3, event-4, event-5, event-6
    const results = await repo.listEvents({
      artistIds,
      offset: 2,
      limit: 4,
    });

    // 1. Verify chunking behavior
    // Chunk size is 50, so 55 artists should produce 2 subqueries on events table
    const eventQueries = executedQueries.filter((q) => q.table === 'events');
    expect(eventQueries).toHaveLength(2);

    // Verify Chunk 0 queried 50 artists and Chunk 1 queried 5 artists
    const chunk0Artists = eventQueries[0].filters[
      'event_artists.artist_id'
    ] as string[];
    const chunk1Artists = eventQueries[1].filters[
      'event_artists.artist_id'
    ] as string[];
    expect(chunk0Artists).toHaveLength(50);
    expect(chunk1Artists).toHaveLength(5);

    // 2. Invariant verification: Chunk sub-queries MUST NOT receive offset (no range filter)
    expect(eventQueries[0].range).toBeUndefined();
    expect(eventQueries[1].range).toBeUndefined();

    // 3. Invariant verification: Chunk sub-queries MUST query limit: globalOffset + globalLimit = 2 + 4 = 6
    expect(eventQueries[0].limit).toBe(6);
    expect(eventQueries[1].limit).toBe(6);

    // 4. Invariant verification: Exact returned event IDs match deterministic global sort and slice
    expect(results).toHaveLength(4);
    expect(results.map((r) => r.id)).toEqual([
      'event-3',
      'event-4',
      'event-5',
      'event-6',
    ]);
  });

  it('deduplicates events matching artists across multiple chunks', async () => {
    const artistIds = Array.from({ length: 55 }, (_, i) => `artist-${i}`);

    // Event has artists in both Chunk 0 (artist-0) and Chunk 1 (artist-50)
    const mockEvents: MockEventData[] = [
      {
        id: 'event-cross-chunk',
        name: 'Festival Collab',
        local_start_date: '2026-11-20',
        artistIds: ['artist-0', 'artist-50'],
      },
      {
        id: 'event-single-chunk',
        name: 'Solo Show',
        local_start_date: '2026-11-21',
        artistIds: ['artist-1'],
      },
    ];

    const { client } = createMockSupabaseClient(mockEvents);
    const repo = new SupabaseCatalogRepository(client);

    const results = await repo.listEvents({
      artistIds,
      limit: 10,
    });

    // Festival Collab must appear only once despite matching both chunks
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toEqual([
      'event-cross-chunk',
      'event-single-chunk',
    ]);
  });
});
