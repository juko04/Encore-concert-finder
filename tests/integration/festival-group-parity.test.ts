import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { groupFestivalDays } from '@/lib/events/festival-groups';

/**
 * Parity between the two festival-grouping implementations: SQL public.refresh_festival_groups
 * (what production serves) and TypeScript groupFestivalDays (in-memory repo + executable spec).
 * A diverse, self-seeded, far-future synthetic data set is grouped by both and EVERY row's
 * presentation columns are compared. Also covers the repository behaviour built on top of the
 * groups (lineup of the whole run, search/artist retrieval of later days).
 * Removes exactly its own rows.
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
const nonce = `fp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface Row {
  id: string;
  venueId: string;
  name: string;
  start: string;
  end?: string;
  kind: string;
  status?: string;
}

describe.skipIf(!creds)('festival grouping: SQL == TypeScript parity', () => {
  let admin: SupabaseClient;
  let repo: SupabaseCatalogRepository;
  const v1 = randomUUID();
  const v2 = randomUUID();
  const venueIds = [v1, v2];
  const rows: Row[] = [];
  // Ids chosen so uuid ordering (digit < letter) decides the primary on same-day ties.
  const idLow = () => `1${randomUUID().slice(1)}`;
  const idHigh = () => `f${randomUUID().slice(1)}`;
  const add = (
    venueId: string,
    name: string,
    start: string,
    kind = 'festival',
    extra: Partial<Row> = {},
  ): Row => {
    const row: Row = {
      id: randomUUID(),
      venueId,
      name: `${name} ${nonce} (Synthetic Test)`,
      start,
      kind,
      ...extra,
    };
    rows.push(row);
    return row;
  };

  const payload = (r: Row) => ({
    venueToCreate: {
      id: r.venueId,
      name: `Venue ${r.venueId.slice(0, 8)} ${nonce} (Synthetic Test)`,
      normalized_name: `venue ${r.venueId.slice(0, 8)} ${nonce} synthetic test`,
      city: 'Synthetic City',
      region: 'ZZ',
      country_code: 'US',
      timezone: 'America/Chicago',
    },
    event: {
      id: r.id,
      name: r.name,
      normalized_name: `${r.name} ${r.id}`.toLowerCase(),
      event_kind: r.kind,
      status: r.status ?? 'scheduled',
      venue_id: r.venueId,
      city: 'Synthetic City',
      region: 'ZZ',
      country_code: 'US',
      timezone: 'America/Chicago',
      local_start_date: r.start,
      local_end_date: r.end ?? null,
      start_time_precision: 'date_only',
      is_multi_day: Boolean(r.end),
    },
    artists: [],
  });

  beforeAll(async () => {
    if (!creds) return;
    assertSafeDatabaseTarget(creds.url);
    admin = createClient(creds.url, creds.key);
    repo = new SupabaseCatalogRepository(admin as never);

    // S1: gap of exactly 3 days joins; gap of 4 splits.
    add(v1, 'GapThree Fest', '2043-01-01');
    add(v1, 'GapThree Fest', '2043-01-04');
    add(v1, 'GapThree Fest', '2043-01-08');
    // Same name at another venue never mixes.
    add(v2, 'GapThree Fest', '2043-01-02');
    // S2: local_end_date drives the gap (previous day's END, not its start).
    add(v1, 'EndDate Fest', '2043-02-01', 'festival', { end: '2043-02-03' });
    add(v1, 'EndDate Fest', '2043-02-05', 'festival', { end: '2043-02-06' });
    add(v1, 'EndDate Fest', '2043-02-12');
    // S3: a cancelled middle day is ignored (and stays ungrouped).
    add(v1, 'Cancelled Fest', '2043-03-01');
    add(v1, 'Cancelled Fest', '2043-03-02', 'festival', {
      status: 'cancelled',
    });
    add(v1, 'Cancelled Fest', '2043-03-03');
    // S3b: only one live day plus a cancelled day: single -> no group.
    add(v1, 'CancelledPair Fest', '2043-03-10');
    add(v1, 'CancelledPair Fest', '2043-03-11', 'festival', {
      status: 'cancelled',
    });
    // S4: weekday / Day / Night suffix variants (hyphen, en dash, parenthesis, colon).
    add(v1, 'Weekday Fest - Friday', '2043-04-03', 'concert');
    add(v1, 'Weekday Fest – Saturday', '2043-04-04', 'concert');
    add(v1, 'Weekday Fest (Sunday)', '2043-04-05', 'concert');
    add(v1, 'Weekday Fest: Day 4', '2043-04-06', 'concert');
    // Wednesday is not a recognised suffix: a different base name, ungrouped.
    add(v1, 'Weekday Fest Wednesday', '2043-04-07', 'concert');
    // S5: same-day tie-break on id decides the primary.
    const tieHigh = add(v1, 'Tie Fest', '2043-05-01');
    tieHigh.id = idHigh();
    const tieLow = add(v1, 'Tie Fest', '2043-05-01');
    tieLow.id = idLow();
    add(v1, 'Tie Fest', '2043-05-02');
    // S6: overlapping rows; the gap uses the LAST row's end, not the run's max end.
    add(v1, 'Overlap Fest', '2043-06-01', 'festival', { end: '2043-06-10' });
    add(v1, 'Overlap Fest', '2043-06-05', 'festival', { end: '2043-06-06' });
    add(v1, 'Overlap Fest', '2043-06-09');
    add(v1, 'Overlap Fest', '2043-06-11');
    // S7: plain concerts: 3 days but a gap of 2 -> not a festival; 3 consecutive -> festival.
    add(v1, 'PlainGap', '2043-07-01', 'concert');
    add(v1, 'PlainGap', '2043-07-03', 'concert');
    add(v1, 'PlainGap', '2043-07-05', 'concert');
    add(v1, 'PlainRun', '2043-08-01', 'concert');
    add(v1, 'PlainRun', '2043-08-02', 'concert');
    add(v1, 'PlainRun', '2043-08-03', 'concert');
    add(v1, 'PlainMixed', '2043-08-10', 'concert');
    add(v1, 'PlainMixed', '2043-08-11', 'concert');
    add(v1, 'PlainMixed', '2043-08-13', 'concert');
    // S8: a name that is only a suffix keeps its full name as base: different days never join.
    const d1 = add(v2, 'x', '2043-09-01');
    d1.name = 'Day 1';
    const d2 = add(v2, 'x', '2043-09-02');
    d2.name = 'Day 2';
    // S9: "Fest" as a word in a plain-concert name; "Festivus" is not a festival.
    add(v1, 'Pre-Fest Party', '2043-10-01', 'concert');
    add(v1, 'Pre-Fest Party', '2043-10-02', 'concert');
    add(v1, 'Festivus Night', '2043-10-10', 'concert');
    add(v1, 'Festivus Night', '2043-10-11', 'concert');
    // S10: case-insensitive base names and multi_day_festival kind.
    add(v1, 'UPPER FESTIVAL - DAY 1', '2043-11-01', 'concert');
    add(v1, 'Upper Festival - Day 2', '2043-11-02', 'concert');
    add(v1, 'Multi Kind', '2043-11-20', 'multi_day_festival');
    add(v1, 'Multi Kind', '2043-11-21', 'multi_day_festival');

    for (const r of rows) {
      const res = await admin.rpc('apply_canonicalization', {
        payload: payload(r),
      });
      expect(res.error).toBeNull();
    }
    await repo.refreshFestivalGroups();
  });

  afterAll(async () => {
    if (!creds || !admin) return;
    await admin
      .from('events')
      .delete()
      .in(
        'id',
        rows.map((r) => r.id),
      );
    await admin.from('venues').delete().in('id', venueIds);
    await repo.refreshFestivalGroups();
  });

  async function sqlState() {
    const { data, error } = await admin
      .from('events')
      .select(
        'id, festival_group_id, festival_group_primary, festival_group_size, festival_group_end_date',
      )
      .in(
        'id',
        rows.map((r) => r.id),
      );
    expect(error).toBeNull();
    return new Map((data ?? []).map((r) => [r.id as string, r]));
  }

  function expectedState() {
    const spec = groupFestivalDays(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        venueId: r.venueId,
        eventKind: r.kind as never,
        status: (r.status ?? 'scheduled') as never,
        localStartDate: r.start,
        localEndDate: r.end ?? null,
      })),
    );
    const out = new Map<
      string,
      {
        festival_group_id: string | null;
        festival_group_primary: boolean;
        festival_group_size: number;
        festival_group_end_date: string | null;
      }
    >();
    for (const r of rows) {
      out.set(r.id, {
        festival_group_id: null,
        festival_group_primary: true,
        festival_group_size: 1,
        festival_group_end_date: null,
      });
    }
    for (const g of spec) {
      for (const m of g.members) {
        out.set(m.id, {
          festival_group_id: g.primary.id,
          festival_group_primary: m.id === g.primary.id,
          festival_group_size: g.members.length,
          festival_group_end_date: g.endDate,
        });
      }
    }
    return { spec, out };
  }

  const byName = (prefix: string) =>
    rows.filter((r) => r.name.startsWith(prefix));

  it('SQL and TypeScript agree on every row (group, primary, size, end date)', async () => {
    const { out } = expectedState();
    const actual = await sqlState();
    for (const r of rows) {
      expect(actual.get(r.id), `${r.name} ${r.start}`).toMatchObject(
        out.get(r.id)!,
      );
    }
  });

  it('is idempotent: a second refresh changes nothing', async () => {
    const before = await sqlState();
    await repo.refreshFestivalGroups();
    expect(await sqlState()).toEqual(before);
  });

  it('pins the intended behaviour of the scenarios (so parity is not vacuous)', () => {
    const { out } = expectedState();
    const grouped = (r: Row) => out.get(r.id)!.festival_group_size > 1;
    const sizeOf = (prefix: string) =>
      byName(prefix).map((r) => out.get(r.id)!.festival_group_size);
    // gap 3 joins, gap 4 splits; other venue never mixes
    expect(sizeOf('GapThree').sort()).toEqual([1, 1, 2, 2]);
    // end dates chain days 1-3 and 5-6, day 12 is separate
    expect(sizeOf('EndDate').sort()).toEqual([1, 2, 2]);
    // cancelled middle day ignored: the two live days group
    expect(sizeOf('Cancelled Fest').sort()).toEqual([1, 2, 2]);
    expect(sizeOf('CancelledPair')).toEqual([1, 1]);
    // weekday variants: friday/saturday/sunday/day 4 group, Wednesday does not
    expect(byName('Weekday Fest Wednesday').some(grouped)).toBe(false);
    expect(byName('Weekday Fest').filter(grouped)).toHaveLength(4);
    // tie-break picks the lowest id as primary
    const tie = byName('Tie Fest').find(
      (r) => r.start === '2043-05-01' && r.id.startsWith('1'),
    )!;
    expect(out.get(tie.id)!.festival_group_primary).toBe(true);
    // overlap chain uses the last row's end
    expect(sizeOf('Overlap').every((n) => n === 4)).toBe(true);
    // plain concerts: gap 2 never groups; 3 consecutive does
    expect(byName('PlainGap').some(grouped)).toBe(false);
    expect(byName('PlainRun').every(grouped)).toBe(true);
    expect(byName('PlainMixed').some(grouped)).toBe(false);
    // suffix-only names stay separate; 'Fest' word groups, 'Festivus' does not
    expect(rows.filter((r) => /^Day [12]$/.test(r.name)).some(grouped)).toBe(
      false,
    );
    expect(byName('Pre-Fest').every(grouped)).toBe(true);
    expect(byName('Festivus').some(grouped)).toBe(false);
    expect(byName('UPPER').every(grouped)).toBe(true);
    expect(byName('Multi Kind').every(grouped)).toBe(true);
  });
});

describe.skipIf(!creds)(
  'collapsed festival cards (Supabase repository)',
  () => {
    let admin: SupabaseClient;
    let repo: SupabaseCatalogRepository;
    const venueId = randomUUID();
    const eventIds: string[] = [];
    const artistIds = [randomUUID(), randomUUID(), randomUUID()];
    const artistNames = ['Alpha', 'Bravo', 'Charlie'].map(
      (n) => `${n} ${nonce} Synthetic Test`,
    );

    beforeAll(async () => {
      if (!creds) return;
      assertSafeDatabaseTarget(creds.url);
      admin = createClient(creds.url, creds.key);
      repo = new SupabaseCatalogRepository(admin as never);
      for (let i = 0; i < 3; i++) {
        const id = randomUUID();
        eventIds.push(id);
        const res = await admin.rpc('apply_canonicalization', {
          payload: {
            venueToCreate: {
              id: venueId,
              name: `LineupVenue ${nonce} (Synthetic Test)`,
              normalized_name: `lineupvenue ${nonce} synthetic test`,
              city: 'Synthetic City',
              region: 'ZZ',
              country_code: 'US',
              timezone: 'America/Chicago',
            },
            event: {
              id,
              name: `Lineup ${nonce} Fest - Day ${i + 1} (Synthetic Test)`,
              normalized_name: `lineup ${nonce} fest day ${i + 1} ${id}`,
              event_kind: 'festival',
              status: 'scheduled',
              venue_id: venueId,
              city: 'Synthetic City',
              region: 'ZZ',
              country_code: 'US',
              timezone: 'America/Chicago',
              local_start_date: `2044-03-0${i + 1}`,
              start_time_precision: 'date_only',
              is_multi_day: false,
            },
            artists: [
              {
                artist_id: artistIds[i],
                name: artistNames[i],
                normalized_name: artistNames[i].toLowerCase(),
                billing_position: 'headliner',
                sort_order: 0,
              },
              // Alpha also plays day 2: must be listed once on the collapsed card.
              ...(i === 1
                ? [
                    {
                      artist_id: artistIds[0],
                      name: artistNames[0],
                      normalized_name: artistNames[0].toLowerCase(),
                      billing_position: 'support',
                      sort_order: 1,
                    },
                  ]
                : []),
            ],
          },
        });
        expect(res.error).toBeNull();
      }
      await repo.refreshFestivalGroups();
    });

    afterAll(async () => {
      if (!creds || !admin) return;
      await admin.from('events').delete().in('id', eventIds);
      await admin.from('artists').delete().in('id', artistIds);
      await admin.from('venues').delete().eq('id', venueId);
      await repo.refreshFestivalGroups();
    });

    const base = () => ({
      venueId,
      fromDate: '2044-01-01',
      limit: 50,
      collapseFestivalDays: true,
    });

    it("the collapsed card lists every day's artists once, primary day first", async () => {
      const cards = await repo.listEvents(base());
      expect(cards).toHaveLength(1);
      expect(cards[0].id).toBe(eventIds[0]);
      expect(cards[0].artists.map((a) => a.name)).toEqual(artistNames);
      // Uncollapsed lists keep each day's own lineup.
      const all = await repo.listEvents({
        ...base(),
        collapseFestivalDays: false,
      });
      expect(all).toHaveLength(3);
      expect(
        all.find((e) => e.id === eventIds[0])?.artists.map((a) => a.name),
      ).toEqual([artistNames[0]]);
    });

    it('text search for an artist on a later day returns the festival card (list == count)', async () => {
      for (const q of [artistNames[1], artistNames[2]]) {
        const filters = { ...base(), searchQuery: q };
        const cards = await repo.listEvents(filters);
        expect(cards.map((e) => e.id)).toEqual([eventIds[0]]);
        expect(await repo.countEvents(filters)).toBe(1);
      }
    });

    it('artist-id retrieval finds the festival once, as its single card (not a hidden day)', async () => {
      const filters = { ...base(), artistIds: [artistIds[2]] };
      const cards = await repo.listEvents(filters);
      // The artist plays a later day; the festival is returned as its primary-day card.
      expect(cards.map((e) => e.id)).toEqual([eventIds[0]]);
      expect(cards[0].festivalGroupEndDate).toBeTruthy();
      expect(await repo.countEvents(filters)).toBe(1);
      // Two matching artists on different days: still one card.
      const both = await repo.listEvents({
        ...base(),
        artistIds: [artistIds[0], artistIds[2]],
      });
      expect(both.map((e) => e.id)).toEqual([eventIds[0]]);
    });

    it('a festival under way stays listed (collapsed) until its last day; uncollapsed views are unchanged', async () => {
      for (const extra of [{}, { excludePastShowtimes: true }]) {
        for (const [from, expected] of [
          ['2044-03-02', 1],
          ['2044-03-03', 1],
          ['2044-03-04', 0],
        ] as const) {
          const filters = { ...base(), fromDate: from, ...extra };
          const cards = await repo.listEvents(filters);
          expect(cards).toHaveLength(expected);
          expect(await repo.countEvents(filters)).toBe(expected);
        }
      }
      const calendar = await repo.listEvents({
        ...base(),
        collapseFestivalDays: false,
        fromDate: '2044-03-02',
      });
      expect(calendar.map((e) => e.id).sort()).toEqual(
        [eventIds[1], eventIds[2]].sort(),
      );
    });
  },
);
