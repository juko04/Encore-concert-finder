// Finding: GET /api/catalog/search?q=a -> HTTP 500
// "Failed to query event_artists for search: URI too long"
// The repository put EVERY matching artist id into one .in() and every matching
// event id into one .or(); PostgREST rejects URLs above ~8 KB. This test uses a
// recording fake client that enforces a realistic URL budget.
import { describe, expect, it } from 'vitest';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import type { SupabaseClient } from '@supabase/supabase-js';

const MAX_URL = 8000;
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function makeClient(artistCount: number, eventsPerArtist: number) {
  const maxUrlSeen = { v: 0 };
  const client = {
    from(table: string) {
      let urlLen = 0;
      const b: Record<string, unknown> = {};
      const chain =
        (fn: (...a: unknown[]) => void) =>
        (...a: unknown[]) => {
          fn(...a);
          return b;
        };
      for (const m of [
        'select',
        'order',
        'eq',
        'neq',
        'gte',
        'lte',
        'gt',
        'lt',
        'ilike',
        'not',
        'is',
        'limit',
        'range',
        'filter',
        'contains',
        'or',
        'in',
        'overlaps',
        'textSearch',
        'match',
      ]) {
        b[m] = chain((...a) => {
          urlLen += JSON.stringify(a).length;
        });
      }
      let rangeFrom = 0;
      let rangeTo = Infinity;
      const origRange = b.range as (...a: unknown[]) => unknown;
      b.range = (from: number, to: number) => {
        rangeFrom = from;
        rangeTo = to;
        return origRange(from, to);
      };
      const rows = () => {
        if (table === 'artists')
          return Array.from({ length: artistCount }, (_, i) => ({
            id: uuid(i),
            name: `Artist ${i}`,
          }));
        if (table === 'event_artists')
          return Array.from(
            { length: artistCount * eventsPerArtist },
            (_, i) => ({
              event_id: uuid(100000 + i),
              artist_id: uuid(i % artistCount),
            }),
          );
        return [];
      };
      b.then = (resolve: (v: unknown) => void) => {
        maxUrlSeen.v = Math.max(maxUrlSeen.v, urlLen);
        if (urlLen > MAX_URL)
          return resolve({
            data: null,
            count: null,
            error: { message: 'URI too long' },
          });
        return resolve({
          data: rows().slice(
            rangeFrom,
            rangeTo === Infinity ? undefined : rangeTo + 1,
          ),
          count: 0,
          error: null,
        });
      };
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient, maxUrlSeen };
}

describe('REGRESSION search-uri-too-long', () => {
  it('listEvents with a broad query (q="a") does not overflow the request URL', async () => {
    const { client } = makeClient(1500, 2);
    const repo = new SupabaseCatalogRepository(client);
    await expect(
      repo.listEvents({
        searchQuery: 'a',
        limit: 50,
        offset: 0,
        fromDate: '2026-11-24',
      }),
    ).resolves.toBeDefined();
  });

  it('countEvents with a broad query does not overflow the request URL', async () => {
    const { client } = makeClient(1500, 2);
    const repo = new SupabaseCatalogRepository(client);
    await expect(
      repo.countEvents({ searchQuery: 'a', fromDate: '2026-11-24' }),
    ).resolves.toBeGreaterThanOrEqual(0);
  });

  it('page 2 of a broad query behaves like page 1', async () => {
    const { client } = makeClient(1500, 2);
    const repo = new SupabaseCatalogRepository(client);
    await expect(
      repo.listEvents({
        searchQuery: 'a',
        limit: 50,
        offset: 50,
        fromDate: '2026-11-24',
      }),
    ).resolves.toBeDefined();
  });
});
