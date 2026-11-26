import { describe, expect, it } from 'vitest';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';
import type { Artist, Event } from '@/lib/domain/catalog';

/**
 * Collapsed festival cards stand for the whole run: artists who play a later day must not be
 * lost (lineup, text search, favourite-artist retrieval). Memory twin of the SQL repository.
 */
let n = 0;
const ev = (over: Partial<Event>): Event =>
  ({
    id: `e${String(++n).padStart(3, '0')}`,
    name: 'Big Fest',
    normalizedName: 'big fest',
    eventKind: 'festival',
    status: 'scheduled',
    venueId: 'v1',
    timezone: 'America/Chicago',
    localStartDate: '2027-07-01',
    startTimePrecision: 'date_only',
    isMultiDay: false,
    ...over,
  }) as Event;

function seed() {
  const repo = new MemoryCatalogRepository();
  const days = [1, 2, 3].map((d) =>
    ev({ localStartDate: `2027-07-0${d}`, name: `Big Fest - Day ${d}` }),
  );
  const names = ['Alpha Band', 'Bravo Duo', 'Charlie Trio'];
  const artists = names.map(
    (name, i) =>
      ({
        id: `a${i}`,
        name,
        normalizedName: name.toLowerCase(),
      }) as unknown as Artist,
  );
  for (const e of days) repo.events.set(e.id, e);
  artists.forEach((a, i) => {
    repo.artists.set(a.id, a);
    repo.eventArtists.set(`ea${i}`, {
      eventId: days[i].id,
      artistId: a.id,
      billingPosition: 'headliner',
      sortOrder: 0,
    });
  });
  // Bravo Duo also plays day 1 (support): must be listed once.
  repo.eventArtists.set('ea-dup', {
    eventId: days[0].id,
    artistId: 'a1',
    billingPosition: 'support',
    sortOrder: 1,
  });
  return { repo, days };
}

describe("collapsed festival cards keep every day's artists", () => {
  it('lists the whole run lineup once, primary day first, only when collapsing', async () => {
    const { repo, days } = seed();
    await repo.refreshFestivalGroups();
    const [card] = await repo.listEvents({ collapseFestivalDays: true });
    expect(card.id).toBe(days[0].id);
    expect(card.artists.map((a) => a.name)).toEqual([
      'Alpha Band',
      'Bravo Duo',
      'Charlie Trio',
    ]);
    // Uncollapsed (calendar / detail) rows keep their own day's lineup.
    const all = await repo.listEvents({});
    expect(
      all.find((e) => e.id === days[0].id)?.artists.map((a) => a.name),
    ).toEqual(['Alpha Band', 'Bravo Duo']);
  });

  it('text search for a later-day artist still finds the festival card', async () => {
    const { repo, days } = seed();
    await repo.refreshFestivalGroups();
    const hits = await repo.listEvents({
      collapseFestivalDays: true,
      searchQuery: 'charlie',
    });
    expect(hits.map((e) => e.id)).toEqual([days[0].id]);
    expect(
      await repo.countEvents({
        collapseFestivalDays: true,
        searchQuery: 'charlie',
      }),
    ).toBe(1);
  });

  it('a favourite playing day 3 returns the festival once, as its single merged card', async () => {
    const { repo, days } = seed();
    await repo.refreshFestivalGroups();
    // Day 3 is not hidden in the query (the favourite's festival must not vanish) but is shown as
    // the festival's one card: the primary day with the whole run's lineup and date range.
    const hits = await repo.listEvents({
      collapseFestivalDays: true,
      artistIds: ['a2'],
    });
    expect(hits.map((e) => e.id)).toEqual([days[0].id]);
    expect(hits[0].festivalGroupEndDate).toBe('2027-07-03');
    expect(hits[0].artists.map((a) => a.name)).toContain('Charlie Trio');
    // Two favourites on different days still give one card.
    const both = await repo.listEvents({
      collapseFestivalDays: true,
      artistIds: ['a0', 'a2'],
    });
    expect(both).toHaveLength(1);
    // Without the collapse flag the real day row is returned.
    const raw = await repo.listEvents({ artistIds: ['a2'] });
    expect(raw.map((e) => e.id)).toEqual([days[2].id]);
  });

  it('refresh clears the group end date of events that left a group', async () => {
    const { repo, days } = seed();
    await repo.refreshFestivalGroups();
    expect((await repo.listEvents({}))[0].festivalGroupEndDate).toBe(
      '2027-07-03',
    );
    repo.events.delete(days[1].id);
    repo.events.delete(days[2].id);
    await repo.refreshFestivalGroups();
    const [only] = await repo.listEvents({});
    expect(only.festivalGroupEndDate).toBeNull();
  });

  it('a festival already under way stays listed (collapsed) until its last day', async () => {
    const { repo, days } = seed();
    await repo.refreshFestivalGroups();
    for (const extra of [{}, { excludePastShowtimes: true }]) {
      const mid = await repo.listEvents({
        collapseFestivalDays: true,
        fromDate: '2027-07-02',
        ...extra,
      });
      expect(mid.map((e) => e.id)).toEqual([days[0].id]);
      expect(
        await repo.countEvents({
          collapseFestivalDays: true,
          fromDate: '2027-07-03',
          ...extra,
        }),
      ).toBe(1);
      expect(
        await repo.countEvents({
          collapseFestivalDays: true,
          fromDate: '2027-07-04',
          ...extra,
        }),
      ).toBe(0);
    }
    // Uncollapsed views (calendar) are unchanged: day 1 is past, days 2-3 are listed.
    const calendar = await repo.listEvents({ fromDate: '2027-07-02' });
    expect(calendar.map((e) => e.id).sort()).toEqual(
      [days[1].id, days[2].id].sort(),
    );
  });
});
