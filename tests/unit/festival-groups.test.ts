import { describe, expect, it } from 'vitest';
import {
  festivalBaseName,
  groupFestivalDays,
} from '@/lib/events/festival-groups';
import {
  formatFestivalRange,
  formatIndexEventDate,
} from '@/components/index/formatters';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';
import type { Event } from '@/lib/domain/catalog';

let n = 0;
const ev = (over: Partial<Event>): Event =>
  ({
    id: `e${String(++n).padStart(3, '0')}`,
    name: 'Fest',
    normalizedName: 'fest',
    eventKind: 'festival',
    status: 'scheduled',
    venueId: 'v1',
    timezone: 'America/Denver',
    localStartDate: '2027-05-13',
    startTimePrecision: 'date_only',
    isMultiDay: false,
    ...over,
  }) as Event;

describe('festival day grouping', () => {
  it('strips day, night and weekday suffixes without collapsing weekday-prefixed titles to empty', () => {
    expect(festivalBaseName('Old Town Music Festival - Day 3')).toBe(
      'old town music festival',
    );
    expect(
      festivalBaseName('Brighton Field Day Rodeo and Festival- FRIDAY'),
    ).toBe('brighton field day rodeo and festival');
    expect(festivalBaseName('FLORIDA DUNGEON FEST III: Night 1')).toBe(
      'florida dungeon fest iii',
    );
    expect(festivalBaseName('Sunday Cruise w/ Dino Gala')).toBe(
      'sunday cruise w/ dino gala',
    );
    expect(festivalBaseName('EDC Las Vegas')).toBe('edc las vegas');
  });

  it('groups consecutive days at one venue; first day is primary', () => {
    const days = [13, 14, 15].map((d) =>
      ev({ localStartDate: `2027-05-${d}`, name: 'EDC' }),
    );
    const groups = groupFestivalDays([days[2], days[0], days[1]]);
    expect(groups).toHaveLength(1);
    expect(groups[0].primary.id).toBe(days[0].id);
    expect(groups[0].members).toHaveLength(3);
    expect(groups[0].endDate).toBe('2027-05-15');
  });

  it('splits runs more than 3 days apart (separate weekends stay separate cards)', () => {
    const a = ev({ localStartDate: '2027-03-13', name: 'Thomas' });
    const b = ev({ localStartDate: '2027-03-14', name: 'Thomas' });
    const c = ev({ localStartDate: '2027-03-20', name: 'Thomas' });
    const d = ev({ localStartDate: '2027-03-21', name: 'Thomas' });
    const groups = groupFestivalDays([a, b, c, d]);
    expect(groups.map((g) => g.primary.id).sort()).toEqual([a.id, c.id].sort());
  });

  it('groups a 3+ consecutive-day run of plain concerts (EDC), but not 2-night stands or weekly nights', () => {
    const run = [13, 14, 15, 16].map((d) =>
      ev({ localStartDate: `2027-05-${d}`, name: 'EDC', eventKind: 'concert' }),
    );
    const g = groupFestivalDays(run);
    expect(g).toHaveLength(1);
    expect(g[0].endDate).toBe('2027-05-16');
    const stand = [1, 2].map((d) =>
      ev({
        localStartDate: `2027-08-0${d}`,
        name: 'Band',
        eventKind: 'concert',
      }),
    );
    expect(groupFestivalDays(stand)).toHaveLength(0);
    const weekly = [1, 8, 15, 22, 29].map((d) =>
      ev({
        localStartDate: `2027-09-${String(d).padStart(2, '0')}`,
        name: 'Club Night',
        eventKind: 'concert',
      }),
    );
    expect(groupFestivalDays(weekly)).toHaveLength(0);
    // Days with a 3-day hole are not "consecutive".
    const gappy = [1, 4, 7, 10].map((d) =>
      ev({
        localStartDate: `2027-10-${String(d).padStart(2, '0')}`,
        name: 'Gappy',
        eventKind: 'concert',
      }),
    );
    expect(groupFestivalDays(gappy)).toHaveLength(0);
  });

  it('groups 2-day festivals named Fest/Festival even when ingested as concerts, while keeping 2-night stands and same-day sets separate', () => {
    const fest2 = [
      ev({
        localStartDate: '2027-01-29',
        name: 'Dungeon Fest III: Night 1',
        eventKind: 'concert',
      }),
      ev({
        localStartDate: '2027-01-30',
        name: 'Dungeon Fest III: Night 2',
        eventKind: 'concert',
      }),
    ];
    const g2 = groupFestivalDays(fest2);
    expect(g2).toHaveLength(1);
    expect(g2[0].endDate).toBe('2027-01-30');

    // A 2-night band stand using Night 1 / Night 2 (not a festival) stays separate.
    const band2 = [
      ev({
        localStartDate: '2027-02-05',
        name: 'String Band - Night 1',
        eventKind: 'concert',
      }),
      ev({
        localStartDate: '2027-02-06',
        name: 'String Band - Night 2',
        eventKind: 'concert',
      }),
    ];
    expect(groupFestivalDays(band2)).toHaveLength(0);

    // Two sets on the same single day do not form a multi-day festival group.
    const sameDay = [
      ev({
        localStartDate: '2027-03-01',
        name: 'Jazz Fest',
        eventKind: 'concert',
      }),
      ev({
        localStartDate: '2027-03-01',
        name: 'Jazz Fest',
        eventKind: 'concert',
      }),
    ];
    expect(groupFestivalDays(sameDay)).toHaveLength(0);
  });

  it('does not group across venues, 2 plain concerts, cancelled days or singletons', () => {
    const base = { name: 'Same Name', localStartDate: '2027-06-01' };
    expect(
      groupFestivalDays([
        ev({ ...base, venueId: 'v1' }),
        ev({ ...base, venueId: 'v2', localStartDate: '2027-06-02' }),
      ]),
    ).toHaveLength(0);
    expect(
      groupFestivalDays([
        ev({ ...base, eventKind: 'concert' }),
        ev({ ...base, eventKind: 'concert', localStartDate: '2027-06-02' }),
      ]),
    ).toHaveLength(0);
    expect(
      groupFestivalDays([
        ev({ ...base }),
        ev({ ...base, localStartDate: '2027-06-02', status: 'cancelled' }),
      ]),
    ).toHaveLength(0);
    expect(groupFestivalDays([ev({ ...base })])).toHaveLength(0);
  });

  it('memory repository hides non-primary days only when collapseFestivalDays is set', async () => {
    const repo = new MemoryCatalogRepository();
    const days = [1, 2, 3].map((d) =>
      ev({ localStartDate: `2027-07-0${d}`, name: 'Big Fest' }),
    );
    const solo = ev({
      name: 'Solo Concert',
      eventKind: 'concert',
      localStartDate: '2027-07-02',
    });
    for (const e of [...days, solo]) repo.events.set(e.id, e);
    expect(await repo.refreshFestivalGroups()).toBe(3);
    const collapsed = await repo.listEvents({ collapseFestivalDays: true });
    expect(collapsed.map((e) => e.id).sort()).toEqual(
      [days[0].id, solo.id].sort(),
    );
    expect(await repo.countEvents({ collapseFestivalDays: true })).toBe(2);
    const all = await repo.listEvents({});
    expect(all).toHaveLength(4);
    expect((await repo.listFestivalDays(days[1].id)).map((d) => d.id)).toEqual(
      days.map((d) => d.id),
    );
  });
});

describe('festival date formatting', () => {
  it('formats same-month, cross-month and cross-year runs', () => {
    expect(formatFestivalRange('2027-04-01', '2027-04-04')).toBe('Apr 1–4');
    expect(formatFestivalRange('2027-04-30', '2027-05-02')).toBe(
      'Apr 30 – May 2',
    );
    expect(formatFestivalRange('2026-12-30', '2027-01-02')).toBe(
      'Dec 30, 2026 – Jan 2',
    );
  });

  it('uses the run for a collapsed festival and the normal label otherwise', () => {
    expect(
      formatIndexEventDate({
        localStartDate: '2027-04-01',
        festivalGroupEndDate: '2027-04-04',
      }),
    ).toBe('Apr 1–4');
    expect(
      formatIndexEventDate({ localStartDate: '2027-04-01', timezone: 'UTC' }),
    ).toContain('Apr');
  });
});
