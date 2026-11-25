/**
 * Integration: `near=1` (within my radius) must hold on EVERY page, not only the first.
 *
 * Drives the real /api/catalog/search handler and the shared searchCatalogPage() against local
 * Postgres with a self-seeded synthetic catalog. Only the session-derived scope
 * (resolveNearContext) is stubbed; there is no real login in this suite.
 *
 * Data safety: every row uses a reserved id prefix and a "(Synthetic Test)" name, and cleanup
 * deletes ONLY those exact ids (never a broad delete; the local DB holds real data). Searches are
 * isolated to the seeded rows with the q token below.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { searchCatalogPage } from '@/lib/location/catalog-search';
import { clearNearScanCache } from '@/lib/location/near-search';
import { filterEventsWithinRadius } from '@/lib/location/radius';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';

const holder = vi.hoisted(() => ({
  client: null as unknown,
  scope: null as null | {
    home: { lat: number; lng: number };
    radiusMiles: number;
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => holder.client,
}));
vi.mock('@/lib/location/near-context', () => ({
  resolveNearContext: async () => ({ scope: holder.scope }),
}));

import { GET } from '@/app/api/catalog/search/route';

const TOKEN = 'ZZNEARPAGETEST';
const DENVER = { lat: 39.7392, lng: -104.9903 };
const RADIUS = 25;
const VENUE_PREFIX = '5ea4c4a0-0000-4000-8000-';
const EVENT_PREFIX = '5ea4c4e0-0000-4000-8000-';
const hex12 = (n: number) => n.toString(16).padStart(12, '0');

function credentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return { url, key };
  try {
    const out = JSON.parse(
      execSync('npx supabase status -o json', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    ) as { API_URL?: string; SERVICE_ROLE_KEY?: string };
    if (out.API_URL && out.SERVICE_ROLE_KEY)
      return { url: url || out.API_URL, key: key || out.SERVICE_ROLE_KEY };
  } catch {
    /* handled below */
  }
  return null;
}

interface Seed {
  id: string;
  city: string;
  region: string;
  venueIdx: number;
  date: string;
  price: number | null;
  inRange: boolean;
}

// venues: 0 Denver, 1 Boulder, 2 Fort Collins (out), 3 Seattle (out), 4 a city absent from the city table + no coords,
// 5 "Nowhereville" with a venue coordinate in Denver (in), 6 city "Denver" but a venue
// coordinate in Seattle (venue coordinate wins -> out).
const VENUES = [
  { city: 'Denver', region: 'CO', lat: null, lng: null },
  { city: 'Boulder', region: 'CO', lat: null, lng: null },
  { city: 'Fort Collins', region: 'CO', lat: null, lng: null },
  { city: 'Seattle', region: 'WA', lat: null, lng: null },
  { city: 'Atlantis', region: 'ZZ', lat: null, lng: null },
  { city: 'Nowhereville', region: 'ZZ', lat: 39.74, lng: -104.99 },
  { city: 'Denver', region: 'CO', lat: 47.6062, lng: -122.3321 },
];
const COUNTS = [60, 60, 40, 20, 20, 12, 10]; // in range: 60 + 60 + 12 = 132 (3 pages of 50)
const IN_RANGE = new Set([0, 1, 5]);

function isoDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

describe('PostgreSQL integration: near=1 across pages (Load More)', () => {
  const creds = credentials();
  let admin: SupabaseClient;
  let repo: SupabaseCatalogRepository;
  const seeds: Seed[] = [];
  const eventIds: string[] = [];
  const venueIds: string[] = [];

  async function cleanup() {
    if (!admin) return;
    // Exact reserved ids only (events first, then venues).
    const evIds: string[] = [];
    for (let i = 1; i <= 400; i++) evIds.push(`${EVENT_PREFIX}${hex12(i)}`);
    const vIds = VENUES.map((_, i) => `${VENUE_PREFIX}${hex12(i + 1)}`);
    for (let i = 0; i < evIds.length; i += 100) {
      const { error } = await admin
        .from('events')
        .delete()
        .in('id', evIds.slice(i, i + 100));
      if (error) throw new Error(`cleanup events: ${error.message}`);
    }
    const { error } = await admin.from('venues').delete().in('id', vIds);
    if (error) throw new Error(`cleanup venues: ${error.message}`);
  }

  beforeAll(async () => {
    if (!creds) throw new Error('Supabase credentials could not be resolved.');
    assertSafeDatabaseTarget(
      creds.url,
      false,
      'catalog-search-near-pagination',
    );
    admin = createClient(creds.url, creds.key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    holder.client = admin;
    repo = new SupabaseCatalogRepository(admin);
    await cleanup(); // idempotent: removes leftovers of an aborted earlier run

    const venueRows = VENUES.map((v, i) => {
      const id = `${VENUE_PREFIX}${hex12(i + 1)}`;
      venueIds.push(id);
      return {
        id,
        name: `${TOKEN} Venue ${i} (Synthetic Test)`,
        normalized_name: `${TOKEN.toLowerCase()} venue ${i} synthetic test`,
        city: v.city,
        region: v.region,
        country_code: 'US',
        lat: v.lat,
        lng: v.lng,
        timezone: 'America/Denver',
      };
    });
    const { error: vErr } = await admin.from('venues').insert(venueRows);
    if (vErr) throw new Error(`seed venues: ${vErr.message}`);

    let n = 0;
    const rows: Array<Record<string, unknown>> = [];
    VENUES.forEach((v, vi_) => {
      for (let k = 0; k < COUNTS[vi_]; k++) {
        n++;
        const id = `${EVENT_PREFIX}${hex12(n)}`;
        // Many shows share a date so ordering ties are resolved by the id tiebreaker.
        const date = isoDay(20 + (n % 40));
        // Prices 5..95 in steps; every 7th unknown; exact 40 boundary present.
        const price =
          n % 7 === 0 ? null : n % 11 === 0 ? 40 : 5 + ((n * 5) % 91);
        const name = `${TOKEN} Show ${String(n).padStart(3, '0')} (Synthetic Test)`;
        seeds.push({
          id,
          city: v.city ?? '',
          region: v.region ?? '',
          venueIdx: vi_,
          date,
          price,
          inRange: IN_RANGE.has(vi_),
        });
        eventIds.push(id);
        rows.push({
          id,
          name,
          normalized_name: name.toLowerCase(),
          event_kind: 'concert',
          status: 'scheduled',
          venue_id: venueIds[vi_],
          city: v.city,
          region: v.region,
          country_code: 'US',
          timezone: 'America/Denver',
          local_start_date: date,
          starts_at: `${date}T20:00:00-06:00`,
          start_time_precision: 'instant',
          min_price: price,
          max_price: price,
          currency: price === null ? null : 'USD',
        });
      }
    });
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await admin
        .from('events')
        .insert(rows.slice(i, i + 100));
      if (error) throw new Error(`seed events: ${error.message}`);
    }
  }, 120000);

  afterAll(async () => {
    await cleanup();
  }, 60000);

  const inRangeSeeds = () => seeds.filter((s) => s.inRange);

  async function loadAllPages(query: string) {
    const pages: Array<{
      events: CanonicalEventSummary[];
      pagination: {
        totalCount: number;
        hasMore: boolean;
        nearApplied: boolean;
      };
    }> = [];
    for (let page = 1; page <= 20; page++) {
      clearNearScanCache();
      const res = await GET(
        new Request(
          `http://localhost/api/catalog/search?q=${TOKEN}&limit=50&page=${page}&${query}`,
        ),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      pages.push(body);
      if (!body.pagination.hasMore) break;
    }
    return pages;
  }

  /** Independent oracle: plain paged listEvents (no near), then the radius filter in memory. */
  async function oracle(filters: Record<string, unknown>) {
    const all: CanonicalEventSummary[] = [];
    for (let offset = 0; ; offset += 100) {
      const batch = await repo.listEvents({
        searchQuery: TOKEN,
        ...filters,
        limit: 100,
        offset,
      });
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return filterEventsWithinRadius(all, DENVER, RADIUS);
  }

  it('seeded data is as expected', () => {
    expect(inRangeSeeds()).toHaveLength(132);
    expect(seeds).toHaveLength(222);
  });

  for (const sort of ['date_asc', 'date_desc', 'price_asc', 'title_asc']) {
    it(`sort=${sort}: no out-of-range event on any page, counts == sum of pages, stable order`, async () => {
      holder.scope = { home: DENVER, radiusMiles: RADIUS };
      const pages = await loadAllPages(`near=1&sort=${sort}`);
      expect(pages.length).toBe(3); // genuinely multi-page (132 / 50)
      const inIds = new Set(inRangeSeeds().map((s) => s.id));
      const ids = pages.flatMap((p) => p.events.map((e) => e.id));
      for (const p of pages) {
        expect(p.pagination.nearApplied).toBe(true);
        expect(p.pagination.totalCount).toBe(132);
        for (const e of p.events) expect(inIds.has(e.id)).toBe(true);
      }
      expect(ids).toHaveLength(132);
      expect(new Set(ids).size).toBe(132); // no duplicates across pages
      expect(pages.reduce((a, p) => a + p.events.length, 0)).toBe(
        pages[0].pagination.totalCount,
      );
      const expected = await oracle({ sortBy: sort });
      expect(ids).toEqual(expected.map((e) => e.id)); // identical order to the oracle
    });
  }

  it('date_asc order matches the specified ORDER BY (date, start instant, id)', async () => {
    holder.scope = { home: DENVER, radiusMiles: RADIUS };
    const ids = (await loadAllPages('near=1&sort=date_asc')).flatMap((p) =>
      p.events.map((e) => e.id),
    );
    const expected = inRangeSeeds()
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map((s) => s.id);
    expect(ids).toEqual(expected);
  });

  it('price filter combines with the radius on every page (exact maxPrice=40)', async () => {
    holder.scope = { home: DENVER, radiusMiles: RADIUS };
    for (const [unknown, keepNull] of [
      ['false', false],
      ['true', true],
    ] as const) {
      const pages = await loadAllPages(
        `near=1&maxPrice=40&includeUnknownPrice=${unknown}&sort=price_asc&limit=20`,
      );
      const expected = inRangeSeeds().filter((s) =>
        s.price === null ? keepNull : s.price <= 40,
      );
      const got = pages.flatMap((p) => p.events);
      expect(got.map((e) => e.id).sort()).toEqual(
        expected.map((s) => s.id).sort(),
      );
      for (const p of pages) {
        expect(p.pagination.totalCount).toBe(expected.length);
        for (const e of p.events) {
          // The summary's minPrice is derived from ticket links (none seeded), so assert the
          // seeded events.min_price instead.
          const seed = seeds.find((x) => x.id === e.id)!;
          expect(seed.price === null ? keepNull : seed.price <= 40).toBe(true);
        }
      }
    }
    // The boundary price is really exercised: a seeded show priced exactly 40 is kept.
    expect(inRangeSeeds().some((s) => s.price === 40)).toBe(true);
    const strict = await loadAllPages(
      'near=1&maxPrice=40&includeUnknownPrice=false&limit=100',
    );
    const strictIds = strict.flatMap((p) => p.events).map((e) => e.id);
    const at40 = inRangeSeeds()
      .filter((s) => s.price === 40)
      .map((s) => s.id);
    for (const id of at40) expect(strictIds).toContain(id);
    const at41plus = inRangeSeeds().filter((s) => (s.price ?? 0) > 40);
    for (const s of at41plus) expect(strictIds).not.toContain(s.id);
  });

  it('page 1 from the shared function equals page 1 from the API (SSR parity)', async () => {
    holder.scope = { home: DENVER, radiusMiles: RADIUS };
    clearNearScanCache();
    const direct = await searchCatalogPage(
      repo,
      { searchQuery: TOKEN, sortBy: 'date_asc', limit: 50, offset: 0 },
      holder.scope,
      { cacheTtlMs: 0, concurrency: 4, batchSize: 40 },
    );
    const api = (await loadAllPages('near=1&sort=date_asc'))[0];
    expect(direct.events.map((e) => e.id)).toEqual(api.events.map((e) => e.id));
    expect(direct.totalCount).toBe(api.pagination.totalCount);
  });

  it('a smaller server-derived radius narrows every page; client radius/lat/lng are ignored', async () => {
    holder.scope = { home: DENVER, radiusMiles: 10 }; // Boulder (~25 mi) drops out
    const pages = await loadAllPages(
      'near=1&radius=5000&radiusMiles=5000&lat=47.6&lng=-122.3',
    );
    const got = pages.flatMap((p) => p.events);
    const denverish = inRangeSeeds().filter((s) => s.venueIdx !== 1);
    expect(got.map((e) => e.id).sort()).toEqual(
      denverish.map((s) => s.id).sort(),
    );
  });

  it('guest / no home location: near is not applied and nothing is filtered', async () => {
    holder.scope = null;
    const pages = await loadAllPages('near=1&sort=date_asc');
    expect(pages.every((p) => p.pagination.nearApplied === false)).toBe(true);
    expect(pages[0].pagination.totalCount).toBe(222);
    expect(pages.flatMap((p) => p.events)).toHaveLength(222);
  });

  it('exclusion rules: unknown location excluded, venue coordinate beats city', async () => {
    holder.scope = { home: DENVER, radiusMiles: RADIUS };
    const got = (await loadAllPages('near=1')).flatMap((p) => p.events);
    const byVenue = new Map<number, number>();
    for (const e of got) {
      const s = seeds.find((x) => x.id === e.id)!;
      byVenue.set(s.venueIdx, (byVenue.get(s.venueIdx) ?? 0) + 1);
    }
    expect(byVenue.get(4)).toBeUndefined(); // city absent from the table, no coords
    expect(byVenue.get(6)).toBeUndefined(); // city Denver, venue coordinate in Seattle
    expect(byVenue.get(5)).toBe(12); // unknown city, venue coordinate in Denver
  });

  it('light scan + id hydration return exactly what the full listEvents walk returns', async () => {
    for (const sortBy of [
      'date_asc',
      'date_desc',
      'price_asc',
      'title_asc',
    ] as const) {
      const filters = { searchQuery: TOKEN, sortBy };
      // Oracle: the full (hydrating) walk in 100-row pages.
      const full: CanonicalEventSummary[] = [];
      for (let offset = 0; ; offset += 100) {
        const batch = await repo.listEvents({ ...filters, limit: 100, offset });
        full.push(...batch);
        if (batch.length < 100) break;
      }
      const light = await repo.listEventLocations(filters);
      expect(light.map((r) => r.id)).toEqual(full.map((e) => e.id));
      for (const [i, row] of light.entries()) {
        expect(row).toEqual({
          id: full[i].id,
          city: full[i].city ?? null,
          region: full[i].region ?? null,
          lat: full[i].lat ?? null,
          lng: full[i].lng ?? null,
        });
      }
      // Hydrating a page of ids gives identical summaries, in the requested order.
      const pageIds = light.slice(45, 95).map((r) => r.id);
      const hydrated = await repo.getEventsByIds(pageIds);
      expect(hydrated).toEqual(full.slice(45, 95));
      // Order follows the ids given, not the database order.
      const reversed = await repo.getEventsByIds([...pageIds].reverse());
      expect(reversed.map((e) => e.id)).toEqual([...pageIds].reverse());
    }
  });

  it('light scan spans more than one 1000-row range exactly (no cap, no duplicates)', async () => {
    // The whole upcoming catalog (real rows + the 222 seeded) crosses the page size when the
    // real catalog is large; either way the light scan must equal the exact count.
    const filters = { fromDate: isoDay(-1), sortBy: 'date_asc' as const };
    const light = await repo.listEventLocations(filters);
    expect(new Set(light.map((r) => r.id)).size).toBe(light.length);
    expect(light.length).toBe(await repo.countEvents(filters));
  });
});
