import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';

/**
 * Regression: re-processing a source whose listings have NO source-side event id (e.g. Velvet
 * Elk Lounge) used to violate uq_event_sources_without_ext_id and abort the venue batch.
 * Self-seeded with reserved ids/nonce; cleans up exactly its own rows.
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
const nonce = `nsid${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!creds)('event_sources without a source event id', () => {
  let admin: SupabaseClient;
  const sourceId = randomUUID();
  const eventId = randomUUID();
  const venueId = randomUUID();
  const sourceUrl = `https://venue.example.invalid/event/${nonce}/`;

  const payload = (candidateConfidence: number) => ({
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
      local_start_date: '2041-03-03',
      start_time_precision: 'date_only',
      is_multi_day: false,
    },
    artists: [],
    source: {
      source_id: sourceId,
      candidate_id: null,
      raw_ingest_id: null,
      source_event_id: null,
      source_url: sourceUrl,
      confidence: candidateConfidence,
    },
  });

  beforeAll(async () => {
    if (!creds) return;
    assertSafeDatabaseTarget(creds.url);
    admin = createClient(creds.url, creds.key);
    const { error } = await admin.from('sources').insert({
      id: sourceId,
      slug: `synthetic-${nonce}`,
      name: `Synthetic ${nonce}`,
      source_type: 'venue',
      acquisition_method: 'html_http',
      base_url: 'https://venue.example.invalid',
      reliability_score: 0.5,
      active: false,
      parser_version: '1.0.0',
    });
    if (error) throw new Error(`seed source failed: ${error.message}`);
  });

  afterAll(async () => {
    if (!creds || !admin) return;
    await admin.from('events').delete().eq('id', eventId);
    await admin.from('venues').delete().eq('id', venueId);
    await admin.from('sources').delete().eq('id', sourceId);
  });

  it('applying the same event + null-id source twice succeeds and keeps one source row', async () => {
    const first = await admin.rpc('apply_canonicalization', {
      payload: payload(0.7),
    });
    expect(first.error).toBeNull();

    // Second pass: matched event, same (event, source, url), still no source event id.
    const second = await admin.rpc('apply_canonicalization', {
      payload: payload(0.9),
    });
    expect(second.error).toBeNull();

    const { data, error } = await admin
      .from('event_sources')
      .select('id, confidence, is_current, last_seen_at, first_seen_at')
      .eq('event_id', eventId)
      .eq('source_id', sourceId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(Number(data?.[0].confidence)).toBeCloseTo(0.9, 5);
    expect(data?.[0].is_current).toBe(true);
  });

  it('a different url for the same event is a second distinct source row', async () => {
    const p = payload(0.8);
    p.source.source_url = `${sourceUrl}other`;
    const res = await admin.rpc('apply_canonicalization', { payload: p });
    expect(res.error).toBeNull();
    const { data } = await admin
      .from('event_sources')
      .select('id')
      .eq('event_id', eventId)
      .eq('source_id', sourceId);
    expect(data).toHaveLength(2);
  });
});
