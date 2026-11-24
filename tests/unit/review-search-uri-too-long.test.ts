import { describe, expect, it } from 'vitest';
import {
  SupabaseCatalogRepository,
  compareEventSummaries,
} from '@/lib/repositories/catalog-repository';

/**
 * Regression for the P0 "page 2 of /api/catalog/search returns HTTP 500":
 * a short query ("a") matched hundreds of artists, and every matched id was put
 * into a single PostgREST URL ("URI too long"). The fake client below rejects
 * any filter value over MAX_URL_PART like the real gateway does.
 */
const MAX_URL_PART = 4500;

type Row = Record<string, unknown>;

function makeFakeClient(db: {
  events: Row[];
  venues: Row[];
  artists: Row[];
  event_artists: Row[];
}) {
  const requests: number[] = [];
  const from = (table: keyof typeof db | string) => {
    let rows: Row[] = [...((db as Record<string, Row[]>)[table] ?? [])];
    let error: { message: string } | null = null;
    let from_ = 0;
    let to_: number | undefined;
    let head = false;
    const orders: Array<{ col: string; asc: boolean }> = [];
    const guard = (v: string) => {
      requests.push(v.length);
      if (v.length > MAX_URL_PART) error = { message: 'URI too long\n' };
    };
    const b: Record<string, unknown> = {
      select(_c?: string, o?: { head?: boolean }) {
        head = !!o?.head;
        return b;
      },
      ilike(col: string, pat: string) {
        const needle = pat.replace(/%/g, '').toLowerCase();
        rows = rows.filter((r) =>
          String(r[col] ?? '')
            .toLowerCase()
            .includes(needle),
        );
        return b;
      },
      in(col: string, vals: string[]) {
        guard(vals.join(','));
        rows = rows.filter((r) => vals.includes(r[col] as string));
        return b;
      },
      eq: () => b,
      gte: () => b,
      lte: () => b,
      or(expr: string) {
        guard(expr);
        if (expr.startsWith('local_start_date.gt')) return b; // past filter
        const parts = expr.split(/,(?=name\.|venue_id\.|id\.)/);
        rows = rows.filter((r) =>
          parts.some((p) => {
            const m = p.match(/^(venue_id|id)\.in\.\((.*)\)$/);
            if (m) return m[2].split(',').includes(r[m[1]] as string);
            const n = p.match(/^name\.ilike\."%(.*)%"$/);
            return n
              ? String(r.name).toLowerCase().includes(n[1].toLowerCase())
              : false;
          }),
        );
        return b;
      },
      order(col: string, o?: { ascending?: boolean }) {
        orders.push({ col, asc: o?.ascending !== false });
        return b;
      },
      range(f: number, t: number) {
        from_ = f;
        to_ = t;
        return b;
      },
      limit(n: number) {
        to_ = n - 1;
        return b;
      },
      then(res: (v: unknown) => void) {
        if (error) return res({ data: null, error, count: null });
        const sorted = [...rows].sort((x, y) => {
          for (const o of orders) {
            const a = x[o.col] as string | number | null;
            const c = y[o.col] as string | number | null;
            if (a === c) continue;
            if (a == null) return 1;
            if (c == null) return -1;
            return (a < c ? -1 : 1) * (o.asc ? 1 : -1);
          }
          return 0;
        });
        const page = sorted.slice(
          from_,
          to_ === undefined ? undefined : to_ + 1,
        );
        res({
          data: head ? null : page,
          error: null,
          count: head ? rows.length : null,
        });
      },
    };
    return b;
  };
  return { client: { from } as never, requests };
}

function build(nEvents: number, nArtists: number) {
  const venues = [{ id: 'v0', name: 'Hall' }];
  const artists: Row[] = [];
  const event_artists: Row[] = [];
  const events: Row[] = [];
  for (let i = 0; i < nEvents; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    events.push({
      id,
      name: `Show ${i}`, // no "a" in the title -> matches only via artist name
      local_start_date: `2027-01-${String((i % 28) + 1).padStart(2, '0')}`,
      starts_at: null,
      venue_id: 'v0',
      venues: venues[0],
      status: 'scheduled',
      timezone: 'America/Denver',
      start_time_precision: 'time',
      min_price: null,
    });
  }
  for (let i = 0; i < nArtists; i++) {
    const id = `a${i}`;
    artists.push({ id, name: `Band ${i}` });
    event_artists.push({
      event_id: (events[i % nEvents] as { id: string }).id,
      artist_id: id,
    });
  }
  return { events, venues, artists, event_artists };
}

describe('catalog search with many matched ids', () => {
  it('lists pages 1..N without URI-too-long and without dupes/skips', async () => {
    const db = build(300, 600);
    const { client, requests } = makeFakeClient(db);
    const repo = new SupabaseCatalogRepository(client);
    const seen: string[] = [];
    for (let page = 0; page < 6; page++) {
      const rows = await repo.listEvents({
        searchQuery: 'a',
        limit: 50,
        offset: page * 50,
        sortBy: 'date_asc',
      });
      expect(rows).toHaveLength(50);
      seen.push(...rows.map((r) => r.id));
    }
    expect(new Set(seen).size).toBe(300);
    expect(Math.max(...requests)).toBeLessThanOrEqual(MAX_URL_PART);
  });

  it('count equals the true number of distinct matching events', async () => {
    const db = build(300, 600);
    const { client } = makeFakeClient(db);
    const repo = new SupabaseCatalogRepository(client);
    expect(await repo.countEvents({ searchQuery: 'a' })).toBe(300);
  });

  it('keeps the single-request path for narrow queries', async () => {
    const db = build(20, 20);
    const { client } = makeFakeClient(db);
    const repo = new SupabaseCatalogRepository(client);
    const rows = await repo.listEvents({ searchQuery: 'Band 3', limit: 10 });
    expect(rows.length).toBeGreaterThan(0);
    expect(await repo.countEvents({ searchQuery: 'Band 3' })).toBe(rows.length);
  });
});

describe('compareEventSummaries', () => {
  const ev = (id: string, d: string, p: number | null) =>
    ({ id, title: id, localStartDate: d, minPrice: p }) as never;
  it('puts null prices last for both price sorts and breaks ties by id', () => {
    const list = [
      ev('b', '2027-01-01', null),
      ev('c', '2027-01-01', 5),
      ev('a', '2027-01-01', 5),
    ];
    expect(
      [...list]
        .sort(compareEventSummaries('price_asc'))
        .map((e: never) => (e as { id: string }).id),
    ).toEqual(['a', 'c', 'b']);
    expect(
      [...list]
        .sort(compareEventSummaries('price_desc'))
        .map((e: never) => (e as { id: string }).id),
    ).toEqual(['a', 'c', 'b']);
  });
});
