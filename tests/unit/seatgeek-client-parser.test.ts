import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  SeatGeekAuthError,
  SeatGeekBudgetExceededError,
  SeatGeekClient,
  buildEventsQuery,
  redactSeatGeekSecrets,
} from '@/lib/sources/seatgeek/client';
import {
  parseSeatGeekEvent,
  parseSeatGeekEventsPage,
} from '@/lib/sources/seatgeek/parser';

const FIXTURE = fs.readFileSync(
  path.resolve(__dirname, '../fixtures/seatgeek/events-page.json'),
  'utf-8',
);

function response(status: number, body = '{"events":[]}'): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const query = {
  stateCode: 'ZZ',
  fromDate: '2031-01-01',
  toDate: '2031-03-31',
  page: 1,
};
const noSleep = () => Promise.resolve();

describe('SeatGeek client', () => {
  it('builds a state, date and taxonomy filtered query with listings only', () => {
    const params = buildEventsQuery(query);
    expect(params.get('venue.state')).toBe('ZZ');
    expect(params.getAll('taxonomies.name')).toEqual([
      'concert',
      'music_festival',
    ]);
    expect(params.get('listing_count.gt')).toBe('0');
    expect(params.get('datetime_utc.gte')).toBe('2031-01-01');
    expect(params.get('per_page')).toBe('100');
    expect(params.has('client_id')).toBe(false);
  });

  it('rejects anything but a two-letter state code', () => {
    expect(() =>
      buildEventsQuery({ ...query, stateCode: 'Colorado' }),
    ).toThrow();
  });

  it('sends the client id but never returns it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200));
    const client = new SeatGeekClient({
      clientId: 'secret-id-123',
      fetchImpl,
      sleep: noSleep,
    });
    const page = await client.fetchEventsPage(query);
    expect(String(fetchImpl.mock.calls[0][0])).toContain(
      'client_id=secret-id-123',
    );
    expect(page.sourceUrl).not.toContain('secret-id-123');
    expect(page.sourceUrl).not.toContain('client_id');
  });

  it('stops on 401/403 without retrying', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(403));
    const client = new SeatGeekClient({
      clientId: 'k',
      fetchImpl,
      sleep: noSleep,
    });
    await expect(client.fetchEventsPage(query)).rejects.toBeInstanceOf(
      SeatGeekAuthError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries 429 and 5xx with backoff, then succeeds', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    const client = new SeatGeekClient({
      clientId: 'k',
      fetchImpl,
      sleep,
      minIntervalMs: 0,
    });
    await expect(client.fetchEventsPage(query)).resolves.toMatchObject({
      status: 200,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(sleep).toHaveBeenCalledWith(4000);
  });

  it('enforces the per-run request budget', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => response(200));
    const client = new SeatGeekClient({
      clientId: 'k',
      fetchImpl,
      sleep: noSleep,
      maxRequests: 2,
      minIntervalMs: 0,
    });
    await client.fetchEventsPage(query);
    await client.fetchEventsPage({ ...query, page: 2 });
    await expect(
      client.fetchEventsPage({ ...query, page: 3 }),
    ).rejects.toBeInstanceOf(SeatGeekBudgetExceededError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('redacts client ids from messages', () => {
    expect(redactSeatGeekSecrets('GET /2/events?a=1&client_id=abc&b=2')).toBe(
      'GET /2/events?a=1&client_id=REDACTED&b=2',
    );
  });
});

describe('SeatGeek parser', () => {
  const page = parseSeatGeekEventsPage(FIXTURE);
  const byId = new Map(page.listings.map((l) => [l.marketplaceEventId, l]));

  it('parses the recorded page and keeps the total', () => {
    expect(page.listings).toHaveLength(6);
    expect(page.invalid).toBe(0);
    expect(page.total).toBe(6);
  });

  it('reads the venue-local date, UTC start, performers and stats', () => {
    const alpha = byId.get('7000001')!;
    expect(alpha.localDate).toBe('2031-03-14');
    expect(alpha.startsAtUtc).toBe('2031-03-15T01:00:00.000Z');
    expect(alpha.performers).toEqual([
      'Fixture Artist Alpha',
      'Fixture Opener',
    ]);
    expect(alpha).toMatchObject({
      lowestPrice: 48,
      averagePrice: 72,
      highestPrice: 210,
      listingCount: 120,
      currency: 'USD',
      isFestival: false,
    });
  });

  it('flags festivals, keeps TBD dates null, and never assumes a non-US currency', () => {
    expect(byId.get('7000003')!.isFestival).toBe(true);
    expect(byId.get('7000005')!.localDate).toBeNull();
    expect(byId.get('7000005')!.startsAtUtc).toBeNull();
    expect(byId.get('7000006')!.currency).toBeNull();
  });

  it('keeps missing prices null, never zero', () => {
    const beta = byId.get('7000004')!;
    expect(beta.lowestPrice).toBeNull();
    expect(beta.listingCount).toBe(0);
  });

  it('drops a reversed range ceiling and rejects rows without id or venue', () => {
    const reversed = parseSeatGeekEvent({
      id: 1,
      title: 'X',
      venue: { name: 'V' },
      stats: { lowest_price: 90, highest_price: 40, listing_count: 3 },
    });
    expect(reversed?.lowestPrice).toBe(90);
    expect(reversed?.highestPrice).toBeNull();
    expect(
      parseSeatGeekEvent({ title: 'No id', venue: { name: 'V' } }),
    ).toBeNull();
    expect(parseSeatGeekEvent({ id: 2, title: 'No venue' })).toBeNull();
  });
});
