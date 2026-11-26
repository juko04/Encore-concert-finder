import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { groupFestivalDays } from '@/lib/events/festival-groups';

/**
 * public.refresh_festival_groups against real Postgres, checked against the TypeScript
 * specification (lib/events/festival-groups.ts), plus the collapseFestivalDays list/count filter.
 * Self-seeded far-future synthetic rows (nonce names); removes exactly its own rows.
 */
function credentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return { url, key };
  try {
    const s = JSON.parse(
      execSync('npx supabase status -o json', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    ) as { API_URL?: string; SERVICE_ROLE_KEY?: string };
    if (s.API_URL && s.SERVICE_ROLE_KEY) {
      return { url: url || s.API_URL, key: key || s.SERVICE_ROLE_KEY };
    }
  } catch {
    // ignore
  }
  return null;
}

const creds = credentials();
const nonce = `fg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!creds)('festival day groups (SQL == TypeScript spec)', () => {
  let admin: SupabaseClient;
  let repo: SupabaseCatalogRepository;
  const venueId = randomUUID();
  const ids: string[] = [];
  const fest = () => `Fest ${nonce} (Synthetic Test)`;
  const rows: Array<{
    id: string;
    name: string;
    date: string;
    kind: string;
  }> = [];

  const payload = (id: string, name: string, date: string, kind: string) => ({
    venueToCreate: {
      id: venueId,
      name: `Venue ${nonce} (Synthetic Test)`,
      normalized_name: `venue ${nonce} synthetic test`,
      city: 'Synthetic City',
      region: 'ZZ',
      country_code: 'US',
      timezone: 'America/Chicago',
    },
    event: {
      id,
      name,
      normalized_name: `${name} ${id} synthetic test`.toLowerCase(),
      event_kind: kind,
      status: 'scheduled',
      venue_id: venueId,
      city: 'Synthetic City',
      region: 'ZZ',
      country_code: 'US',
      timezone: 'America/Chicago',
      local_start_date: date,
      start_time_precision: 'date_only',
      is_multi_day: false,
    },
    artists: [],
  });

  beforeAll(async () => {
    if (!creds) return;
    assertSafeDatabaseTarget(creds.url);
    admin = createClient(creds.url, creds.key);
    repo = new SupabaseCatalogRepository(admin as never);
    // 3-day festival (one name has a "Day 2" suffix), a second weekend 10 days later, a 2-day
    // "Fest" ingested as a concert (Night 1 / Night 2), a 2-night band stand, a same-day Fest
    // doubleheader, and a weekly club night that must never collapse.
    const plan: Array<[string, string, string]> = [
      [fest(), '2042-05-01', 'festival'],
      [`${fest()} - Day 2`, '2042-05-02', 'festival'],
      [fest(), '2042-05-03', 'festival'],
      [fest(), '2042-05-13', 'festival'],
      [`Club Night ${nonce} (Synthetic Test)`, '2042-05-02', 'concert'],
      // 2-day Fest ingested as a plain concert with Night 1 / Night 2: must group.
      [
        `Dungeon Fest ${nonce}: Night 1 (Synthetic Test)`,
        '2042-06-05',
        'concert',
      ],
      [
        `Dungeon Fest ${nonce}: Night 2 (Synthetic Test)`,
        '2042-06-06',
        'concert',
      ],
      // 2-night concert stand (not a festival): must stay separate.
      [
        `Band Stand ${nonce} - Night 1 (Synthetic Test)`,
        '2042-06-12',
        'concert',
      ],
      [
        `Band Stand ${nonce} - Night 2 (Synthetic Test)`,
        '2042-06-13',
        'concert',
      ],
      // Same-day Fest doubleheader (single day): must stay separate.
      [`Same Day Fest ${nonce} (Synthetic Test)`, '2042-06-20', 'concert'],
      [`Same Day Fest ${nonce} (Synthetic Test)`, '2042-06-20', 'concert'],
      // Two back-to-back 4-day runs (3+ is enough) of plain concerts (EDC-style): both must group.
      ...['01', '02', '03', '04', '10', '11', '12', '13'].map(
        (d): [string, string, string] => [
          `Run ${nonce} (Synthetic Test)`,
          `2042-07-${d}`,
          'concert',
        ],
      ),
      [`Club Night ${nonce} (Synthetic Test)`, '2042-05-09', 'concert'],
    ];
    for (const [name, date, kind] of plan) {
      const id = randomUUID();
      ids.push(id);
      rows.push({ id, name, date, kind });
      const r = await admin.rpc('apply_canonicalization', {
        payload: payload(id, name, date, kind),
      });
      expect(r.error).toBeNull();
    }
    const refreshed = await repo.refreshFestivalGroups();
    expect(refreshed).toBeGreaterThanOrEqual(3);
  });

  afterAll(async () => {
    if (!creds || !admin) return;
    await admin.from('events').delete().in('id', ids);
    await admin.from('venues').delete().eq('id', venueId);
    await repo.refreshFestivalGroups();
  });

  it('matches the TypeScript grouping for these rows', async () => {
    const spec = groupFestivalDays(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        venueId,
        eventKind: r.kind as never,
        status: 'scheduled' as const,
        localStartDate: r.date,
        localEndDate: null,
      })),
    );
    expect(spec).toHaveLength(4); // the festival + 2-day Fest + both 4-day concert runs
    const { data } = await admin
      .from('events')
      .select(
        'id, festival_group_id, festival_group_primary, festival_group_size, festival_group_end_date',
      )
      .in('id', ids);
    const byId = new Map((data ?? []).map((r) => [r.id, r]));
    for (const g of spec) {
      for (const m of g.members) {
        expect(byId.get(m.id)).toMatchObject({
          festival_group_id: g.primary.id,
          festival_group_primary: m.id === g.primary.id,
          festival_group_size: g.members.length,
          festival_group_end_date: g.endDate,
        });
      }
    }
    // The later weekend (gap > 3 days) and the club nights are untouched.
    const grouped = new Set(spec.flatMap((g) => g.members.map((m) => m.id)));
    for (const r of rows.filter((x) => !grouped.has(x.id))) {
      expect(byId.get(r.id)).toMatchObject({
        festival_group_id: null,
        festival_group_primary: true,
        festival_group_size: 1,
      });
    }
  });

  it('collapseFestivalDays hides non-primary days in list and count; default shows all', async () => {
    const filters = { venueId, fromDate: '2042-01-01', limit: 50 };
    const all = await repo.listEvents(filters);
    const collapsed = await repo.listEvents({
      ...filters,
      collapseFestivalDays: true,
    });
    expect(all).toHaveLength(20);
    // festival + later weekend + 2 club nights + 2-day Fest + 2 band nights + 2 same-day + 2 concert runs
    expect(collapsed).toHaveLength(11);
    expect(
      await repo.countEvents({ ...filters, collapseFestivalDays: true }),
    ).toBe(11);
    const card = collapsed.find((e) => e.localStartDate === '2042-05-01');
    expect(card?.localStartDate).toBe('2042-05-01');
    expect(card?.festivalGroupEndDate).toBe('2042-05-03');
    expect(
      (await repo.listFestivalDays(ids[1])).map((d) => d.localStartDate),
    ).toEqual(['2042-05-01', '2042-05-02', '2042-05-03']);
  });
});
