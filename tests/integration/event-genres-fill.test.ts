import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';

/**
 * CatalogRepository.fillEventGenres against real Postgres: fill-if-empty, provenance in
 * events.genres_source, never overwrites genres supplied by the source. Self-seeded with a nonce
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
const nonce = `gen${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!creds)('events.genres fill-if-empty with provenance', () => {
  let admin: SupabaseClient;
  let repo: SupabaseCatalogRepository;
  const venueId = randomUUID();
  const emptyEventId = randomUUID();
  const sourcedEventId = randomUUID();

  const eventPayload = (
    id: string,
    name: string,
    date: string,
    genres?: string[],
  ) => ({
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
      name: `${name} ${nonce} (Synthetic Test)`,
      normalized_name: `${name} ${nonce} synthetic test`.toLowerCase(),
      event_kind: 'concert',
      status: 'scheduled',
      venue_id: venueId,
      city: 'Synthetic City',
      region: 'ZZ',
      country_code: 'US',
      timezone: 'America/Chicago',
      local_start_date: date,
      start_time_precision: 'date_only',
      is_multi_day: false,
      ...(genres ? { genre: genres[0], genres } : {}),
    },
    artists: [],
  });

  beforeAll(async () => {
    if (!creds) return;
    assertSafeDatabaseTarget(creds.url);
    admin = createClient(creds.url, creds.key);
    repo = new SupabaseCatalogRepository(admin as never);
    const a = await admin.rpc('apply_canonicalization', {
      payload: eventPayload(emptyEventId, 'Jazz Night', '2041-04-04'),
    });
    expect(a.error).toBeNull();
    const b = await admin.rpc('apply_canonicalization', {
      payload: eventPayload(sourcedEventId, 'Funk Friday', '2041-04-05', [
        'Rock',
      ]),
    });
    expect(b.error).toBeNull();
  });

  afterAll(async () => {
    if (!creds || !admin) return;
    await admin
      .from('events')
      .delete()
      .in('id', [emptyEventId, sourcedEventId]);
    await admin.from('venues').delete().eq('id', venueId);
  });

  it('fills an event with no genre and records the source', async () => {
    expect(
      await repo.fillEventGenres(emptyEventId, ['Jazz'], 'inferred_title'),
    ).toBe(true);
    const { data } = await admin
      .from('events')
      .select('genre, genres, genres_source')
      .eq('id', emptyEventId)
      .single();
    expect(data).toEqual({
      genre: 'Jazz',
      genres: ['Jazz'],
      genres_source: 'inferred_title',
    });
  });

  it('is idempotent: a second write (even from another source) changes nothing', async () => {
    expect(
      await repo.fillEventGenres(
        emptyEventId,
        ['Blues'],
        'ticketmaster_attraction',
      ),
    ).toBe(false);
    const { data } = await admin
      .from('events')
      .select('genres, genres_source')
      .eq('id', emptyEventId)
      .single();
    expect(data).toEqual({ genres: ['Jazz'], genres_source: 'inferred_title' });
  });

  it('never overwrites genres supplied by the source, and leaves genres_source empty', async () => {
    expect(
      await repo.fillEventGenres(sourcedEventId, ['Funk'], 'inferred_title'),
    ).toBe(false);
    const { data } = await admin
      .from('events')
      .select('genre, genres, genres_source')
      .eq('id', sourcedEventId)
      .single();
    expect(data).toEqual({
      genre: 'Rock',
      genres: ['Rock'],
      genres_source: null,
    });
  });

  it('ignores empty input and unknown events', async () => {
    expect(await repo.fillEventGenres(emptyEventId, [], 'inferred_title')).toBe(
      false,
    );
    expect(
      await repo.fillEventGenres(emptyEventId, ['  '], 'inferred_title'),
    ).toBe(false);
    expect(
      await repo.fillEventGenres(randomUUID(), ['Jazz'], 'inferred_title'),
    ).toBe(false);
  });
});
