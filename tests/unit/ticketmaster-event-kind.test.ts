import { describe, expect, it } from 'vitest';
import {
  classifyTicketmasterEventKind,
  isSingleActShowName,
  parseTicketmasterEvent,
} from '@/lib/sources/ticketmaster/parser';
import type { TicketmasterEvent } from '@/lib/sources/ticketmaster/types';

const CONTEXT = {
  sourceId: 'b0000000-0000-0000-0000-000000000003',
  rawIngestId: 'c0000000-0000-0000-0000-000000000001',
  sourceUrl: 'https://app.ticketmaster.com/discovery/v2/events.json',
  fetchedAt: '2026-11-24T12:00:00Z',
  contentHash: 'hash',
  parserVersion: '1.0.0',
};

function tmEvent(
  name: string,
  opts: { endDate?: string; genre?: string } = {},
): TicketmasterEvent {
  return {
    id: 'evt-kind',
    name,
    dates: {
      start: { localDate: '2027-04-24', localTime: '19:00:00' },
      ...(opts.endDate ? { end: { localDate: opts.endDate } } : {}),
      timezone: 'America/New_York',
      status: { code: 'onsale' },
    },
    classifications: [
      {
        primary: true,
        segment: { name: 'Music' },
        genre: { name: opts.genre ?? 'Rock' },
      },
    ],
    _embedded: {
      venues: [
        {
          id: 'v1',
          name: 'Some Hall',
          city: { name: 'Springfield' },
          timezone: 'America/New_York',
        },
      ],
    },
  } as unknown as TicketmasterEvent;
}

const kind = (name: string, opts?: Parameters<typeof tmEvent>[1]) =>
  parseTicketmasterEvent(tmEvent(name, opts), CONTEXT);

describe('Ticketmaster event kind classification', () => {
  it('treats "Classic Albums Live" as a single-night concert', () => {
    const c = kind('Classic Albums Live: Van Halen - 1984');
    expect(c.isFestival).toBe(false);
  });

  it('treats a laser spectacular as a concert, not a festival', () => {
    expect(kind('Pink Floyd Laser Spectacular').isFestival).toBe(false);
  });

  it('treats tribute shows as concerts even with a festival genre/end date', () => {
    expect(
      classifyTicketmasterEventKind({
        name: 'Zeppelin Tribute Night',
        isMultiDay: true,
        hasFestivalClassification: true,
      }),
    ).toBe('concert');
  });

  it('does not tag "House Party" as a festival', () => {
    expect(kind('House Party').isFestival).toBe(false);
  });

  it('keeps a real multi-day Festival as a festival', () => {
    const c = kind('Summer Jam Festival', { endDate: '2027-04-26' });
    expect(c.isFestival).toBe(true);
  });

  it('keeps single-day festival names and festival classifications', () => {
    expect(
      classifyTicketmasterEventKind({
        name: 'Riverside Music Festival',
        isMultiDay: false,
        hasFestivalClassification: false,
      }),
    ).toBe('festival');
    expect(
      classifyTicketmasterEventKind({
        name: 'Big Weekend',
        isMultiDay: false,
        hasFestivalClassification: true,
      }),
    ).toBe('festival');
  });

  it('lets an explicit "Festival" name beat tribute wording', () => {
    expect(
      classifyTicketmasterEventKind({
        name: 'Laser Light Tribute Festival',
        isMultiDay: true,
        hasFestivalClassification: false,
      }),
    ).toBe('multi_day_festival');
  });

  it('does not match on bare words like "live" or "party"', () => {
    expect(isSingleActShowName('Live at the Hall')).toBe(false);
    expect(isSingleActShowName('House Party')).toBe(false);
    expect(isSingleActShowName('Beatles Tribute')).toBe(true);
    expect(isSingleActShowName('Laser Light Show')).toBe(true);
  });
});
