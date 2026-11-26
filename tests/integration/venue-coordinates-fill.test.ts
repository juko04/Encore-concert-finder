import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';

/**
 * CatalogRepository.fillVenueCoordinatesForEvent against real Postgres: fill-if-empty, never
 * overwrites coordinates a venue already has. Self-seeded with a nonce
 * and "(Synthetic Test)" names; cleans up exactly its own rows.
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
const nonce = `vc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!creds)('venue coordinates fill-if-empty', () => {
  let admin: SupabaseClient;
  let repo: SupabaseCatalogRepository;
  const venueId = randomUUID();
  const eventId = randomUUID();

  beforeAll(async () => {
    if (!creds) return;
    assertSafeDatabaseTarget(creds.url);
    admin = createClient(creds.url, creds.key);
    repo = new SupabaseCatalogRepository(admin as never);
    const r = await admin.rpc('apply_canonicalization', {
      payload: {
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
          id: eventId,
          name: `Show ${nonce} (Synthetic Test)`,
          normalized_name: `show ${nonce} synthetic test`,
          event_kind: 'concert',
          status: 'scheduled',
          venue_id: venueId,
          city: 'Synthetic City',
          region: 'ZZ',
          country_code: 'US',
          timezone: 'America/Chicago',
          local_start_date: '2041-06-06',
          start_time_precision: 'date_only',
          is_multi_day: false,
        },
        artists: [],
      },
    });
    expect(r.error).toBeNull();
  });

  afterAll(async () => {
    if (!creds || !admin) return;
    await admin.from('events').delete().eq('id', eventId);
    await admin.from('venues').delete().eq('id', venueId);
  });

  it('fills a venue with no coordinates, then never overwrites them', async () => {
    expect(
      await repo.fillVenueCoordinatesForEvent(eventId, 32.723757, -117.22761),
    ).toBe(true);
    expect(await repo.fillVenueCoordinatesForEvent(eventId, 10, 10)).toBe(
      false,
    );
    const { data } = await admin
      .from('venues')
      .select('lat, lng')
      .eq('id', venueId)
      .single();
    expect(data).toEqual({ lat: 32.723757, lng: -117.22761 });
  });

  it('rejects out-of-range coordinates and unknown events', async () => {
    expect(await repo.fillVenueCoordinatesForEvent(eventId, 95, 10)).toBe(
      false,
    );
    expect(await repo.fillVenueCoordinatesForEvent(randomUUID(), 1, 1)).toBe(
      false,
    );
  });
});
