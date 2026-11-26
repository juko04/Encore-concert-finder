import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseMarketPriceStore } from '@/lib/sources/seatgeek/store';

/**
 * market_price_observations + market_prices_current against real Postgres:
 * append-only guard, cascade, RLS, the freshness/latest-row rules of the view, and the
 * Supabase store's catalog read and idempotent insert. Self-seeded synthetic rows (nonce
 * names, far-future dates); removes exactly its own rows.
 */
function credentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    const s = JSON.parse(
      execSync('npx supabase status -o json', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    ) as { API_URL?: string; SERVICE_ROLE_KEY?: string; ANON_KEY?: string };
    if (
      (url || s.API_URL) &&
      (key || s.SERVICE_ROLE_KEY) &&
      (anon || s.ANON_KEY)
    ) {
      return {
        url: (url || s.API_URL)!,
        key: (key || s.SERVICE_ROLE_KEY)!,
        anon: (anon || s.ANON_KEY)!,
      };
    }
  } catch {
    // fall through
  }
  return url && key && anon ? { url, key, anon } : null;
}

const creds = credentials();
const nonce = `mp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!creds)('market price observations (Postgres)', () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  const sourceId = randomUUID();
  const venueId = randomUUID();
  const freshEvent = randomUUID();
  const staleEvent = randomUUID();
  const soldOutEvent = randomUUID();
  const cascadeEvent = randomUUID();
  let rawIngestId = '';

  const hoursAgo = (h: number) =>
    new Date(Date.now() - h * 3_600_000).toISOString();
  const observation = (
    eventId: string,
    over: Record<string, unknown> = {},
  ) => ({
    event_id: eventId,
    source_id: sourceId,
    raw_ingest_id: rawIngestId,
    marketplace_event_id: `sg-${eventId.slice(0, 8)}`,
    marketplace_url: 'https://seatgeek.com/synthetic',
    lowest_price: 48,
    average_price: 72,
    highest_price: 210,
    listing_count: 120,
    currency: 'USD',
    observed_at: hoursAgo(1),
    match_method: 'venue_date_performer',
    match_confidence: 0.95,
    parser_version: 'test',
    ...over,
  });

  beforeAll(async () => {
    if (!creds) return;
    assertSafeDatabaseTarget(creds.url);
    admin = createClient(creds.url, creds.key);
    anon = createClient(creds.url, creds.anon);

    const steps = [
      admin.from('sources').insert({
        id: sourceId,
        slug: `seatgeek-test-${nonce}`,
        name: `SeatGeek ${nonce} (Synthetic Test)`,
        source_type: 'ticketing',
        acquisition_method: 'api',
      }),
      admin.from('venues').insert({
        id: venueId,
        name: `Hall ${nonce} (Synthetic Test)`,
        normalized_name: `hall ${nonce} synthetic test`,
        city: 'Synthetic City',
        region: 'ZZ',
        country_code: 'US',
        lat: 41,
        lng: -95,
        timezone: 'America/Chicago',
      }),
    ];
    for (const step of steps) expect((await step).error).toBeNull();

    const events = [freshEvent, staleEvent, soldOutEvent, cascadeEvent].map(
      (id, i) => ({
        id,
        name: `Show ${i} ${nonce} (Synthetic Test)`,
        normalized_name: `show ${i} ${nonce} synthetic test`,
        event_kind: 'concert',
        status: 'scheduled',
        venue_id: venueId,
        city: 'Synthetic City',
        region: 'ZZ',
        country_code: 'US',
        timezone: 'America/Chicago',
        local_start_date: '2043-03-1' + i,
        start_time_precision: 'date_only',
        is_multi_day: false,
      }),
    );
    expect((await admin.from('events').insert(events)).error).toBeNull();

    const raw = await admin
      .from('raw_ingests')
      .insert({
        source_id: sourceId,
        source_url: `https://api.seatgeek.com/2/events?nonce=${nonce}`,
        acquisition_method: 'api',
        content_hash: nonce,
        raw_content: '{"events":[]}',
      })
      .select('id')
      .single();
    expect(raw.error).toBeNull();
    rawIngestId = raw.data!.id;

    const seed = await admin.from('market_price_observations').insert([
      observation(freshEvent, { observed_at: hoursAgo(30), lowest_price: 60 }),
      observation(freshEvent, { observed_at: hoursAgo(1), lowest_price: 48 }),
      observation(staleEvent, { observed_at: hoursAgo(80) }),
      observation(soldOutEvent, {
        observed_at: hoursAgo(30),
        lowest_price: 30,
      }),
      observation(soldOutEvent, {
        observed_at: hoursAgo(1),
        lowest_price: null,
        average_price: null,
        highest_price: null,
        listing_count: 0,
      }),
      observation(cascadeEvent),
    ]);
    expect(seed.error).toBeNull();
  });

  afterAll(async () => {
    if (!creds) return;
    await admin
      .from('events')
      .delete()
      .in('id', [freshEvent, staleEvent, soldOutEvent, cascadeEvent]);
    await admin.from('venues').delete().eq('id', venueId);
    await admin.from('sources').delete().eq('id', sourceId); // cascades raw_ingests
  });

  it('rejects updates (append-only)', async () => {
    const { error } = await admin
      .from('market_price_observations')
      .update({ lowest_price: 1 })
      .eq('event_id', freshEvent);
    expect(error?.message).toMatch(/append-only/);
  });

  it('rejects direct deletes but follows an event delete', async () => {
    const direct = await admin
      .from('market_price_observations')
      .delete()
      .eq('event_id', cascadeEvent);
    expect(direct.error?.message).toMatch(/append-only/);

    expect(
      (await admin.from('events').delete().eq('id', cascadeEvent)).error,
    ).toBeNull();
    const left = await admin
      .from('market_price_observations')
      .select('id')
      .eq('event_id', cascadeEvent);
    expect(left.data).toEqual([]);
  });

  it('enforces price and currency checks', async () => {
    const bad = [
      observation(freshEvent, { lowest_price: -1, observed_at: hoursAgo(2) }),
      observation(freshEvent, {
        lowest_price: 300,
        highest_price: 100,
        observed_at: hoursAgo(2),
      }),
      observation(freshEvent, { currency: 'usd', observed_at: hoursAgo(2) }),
      observation(freshEvent, {
        match_confidence: 1.5,
        observed_at: hoursAgo(2),
      }),
    ];
    for (const row of bad) {
      const { error } = await admin
        .from('market_price_observations')
        .insert(row);
      expect(error).not.toBeNull();
    }
  });

  it('the view shows only the latest, fresh row with listings', async () => {
    const { data, error } = await admin
      .from('market_prices_current')
      .select('event_id, lowest_price, listing_count, source_slug')
      .in('event_id', [freshEvent, staleEvent, soldOutEvent]);
    expect(error).toBeNull();
    // fresh: the newer $48 row wins; stale (80 h): hidden; sold out now: hidden, no fallback.
    expect(data).toEqual([
      {
        event_id: freshEvent,
        lowest_price: 48,
        listing_count: 120,
        source_slug: `seatgeek-test-${nonce}`,
      },
    ]);
  });

  it('anon reads the view but not the table', async () => {
    const view = await anon
      .from('market_prices_current')
      .select('event_id, lowest_price')
      .eq('event_id', freshEvent);
    expect(view.error).toBeNull();
    expect(view.data).toEqual([{ event_id: freshEvent, lowest_price: 48 }]);

    const table = await anon
      .from('market_price_observations')
      .select('id')
      .eq('event_id', freshEvent);
    expect(table.data ?? []).toEqual([]);

    const write = await anon
      .from('market_price_observations')
      .insert(observation(freshEvent));
    expect(write.error).not.toBeNull();
  });

  it('store reads the catalog and inserts idempotently', async () => {
    const store = new SupabaseMarketPriceStore(admin);
    const catalog = await store.loadCatalogEvents('2043-03-10', '2043-03-12');
    const mine = catalog.filter(
      (e) => e.venue.name === `Hall ${nonce} (Synthetic Test)`,
    );
    expect(mine.map((e) => e.id).sort()).toEqual(
      [freshEvent, staleEvent, soldOutEvent].sort(),
    );
    expect(mine[0]).toMatchObject({
      hasListedPrice: false,
      venue: { region: 'ZZ', lat: 41, lng: -95 },
    });

    const row = {
      eventId: staleEvent,
      sourceId,
      rawIngestId,
      marketplaceEventId: 'sg-idempotent',
      marketplaceUrl: null,
      lowestPrice: 20,
      averagePrice: null,
      highestPrice: null,
      listingCount: 2,
      currency: 'USD',
      observedAt: hoursAgo(0.5),
      matchMethod: 'venue_date_performer' as const,
      matchConfidence: 0.95,
      parserVersion: 'test',
    };
    expect(await store.insertObservations([row])).toBe(1);
    expect(await store.insertObservations([row])).toBe(0);
    const later = await store.insertObservations([
      { ...row, observedAt: hoursAgo(0.1) },
    ]);
    expect(later).toBe(1);
  });
});
