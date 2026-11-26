import { describe, expect, it } from 'vitest';
import {
  isEventNameArtist,
  withoutEventNameArtists,
} from '@/lib/events/lineup';
import { displayGenreLabel } from '@/lib/genres/catalog-genres';
import { parseTicketmasterEvent } from '@/lib/sources/ticketmaster/parser';
import type { TicketmasterEvent } from '@/lib/sources/ticketmaster/types';

describe('event-name artists are not performers', () => {
  it('matches the event name and its festival base name', () => {
    expect(
      isEventNameArtist('Ultra Music Festival', 'Ultra Music Festival'),
    ).toBe(true);
    expect(
      isEventNameArtist('Ultra Music Festival', 'Ultra Music Festival - Day 2'),
    ).toBe(true);
    expect(isEventNameArtist('Afrojack', 'Ultra Music Festival')).toBe(false);
  });

  it('drops the festival from festival-sized bills only', () => {
    const acts = ['Afrojack', 'Armin', 'Boris', 'Calvin', 'Dom'].map(
      (name) => ({
        name,
      }),
    );
    const bill = [{ name: 'Ultra Music Festival' }, ...acts];
    expect(
      withoutEventNameArtists(bill, 'Ultra Music Festival').map((a) => a.name),
    ).toEqual(acts.map((a) => a.name));
    // A concert named after its headliner keeps the headliner, with openers or alone.
    const tour = [
      { name: 'Nickelback' },
      { name: 'Opener A' },
      { name: 'Opener B' },
    ];
    expect(withoutEventNameArtists(tour, 'Nickelback')).toEqual(tour);
    expect(
      withoutEventNameArtists([{ name: 'Nickelback' }], 'Nickelback'),
    ).toHaveLength(1);
  });

  it('the Ticketmaster parser skips a festival listed as its own attraction', () => {
    const ev = {
      id: 'e1',
      name: 'Ultra Music Festival',
      dates: {
        start: { localDate: '2027-03-26', localTime: '16:00:00' },
        timezone: 'America/New_York',
        status: { code: 'onsale' },
      },
      _embedded: {
        venues: [
          {
            id: 'v',
            name: 'FPL Solar Amphitheater',
            city: { name: 'Miami' },
            state: { stateCode: 'FL' },
          },
        ],
        attractions: [
          { id: 'a0', name: 'Ultra Music Festival' },
          ...['Afrojack', 'Armin', 'Boris', 'Calvin', 'Dom'].map((name, i) => ({
            id: `a${i + 1}`,
            name,
          })),
        ],
      },
    } as unknown as TicketmasterEvent;
    const c = parseTicketmasterEvent(ev, {
      sourceId: 'b0000000-0000-0000-0000-000000000003',
      rawIngestId: 'c0000000-0000-0000-0000-000000000001',
      sourceUrl: 'https://example.test',
      fetchedAt: '2026-11-25T12:00:00Z',
      contentHash: 'h',
      parserVersion: '1.0.0',
    });
    expect(c.artistNames).not.toContain('Ultra Music Festival');
    expect(c.artistNames).toHaveLength(5);
  });
});

describe('large bills show their dominant genre instead of "Mixed"', () => {
  const edm = Array.from({ length: 9 }, () => 'Dance/Electronic');
  it('one stray pop act on an electronic festival stays Electronic', () => {
    expect(displayGenreLabel([...edm, 'Pop'])).toBe('Electronic');
  });
  it('a genuinely mixed large bill and any small bill remain Mixed', () => {
    expect(
      displayGenreLabel([
        'Rock',
        'Pop',
        'Jazz',
        'Dance/Electronic',
        'Country',
        'Rock',
        'Pop',
        'Jazz',
      ]),
    ).toBe('Mixed');
    expect(displayGenreLabel(['Dance/Electronic', 'Pop'])).toBe('Mixed');
  });
});
