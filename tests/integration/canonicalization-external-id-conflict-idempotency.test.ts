import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { SupabaseSourceRepository } from '@/lib/repositories/source-repository';
import { SupabaseRawIngestRepository } from '@/lib/repositories/raw-ingest-repository';
import { SupabaseEventCandidateRepository } from '@/lib/repositories/event-candidate-repository';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { runTicketmasterIngestion } from '@/lib/sources/ticketmaster/ingestion-pipeline';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';

function resolveCredentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceRoleKey) return { url, serviceRoleKey };
  try {
    const parsed = JSON.parse(
      execSync('npx supabase status -o json', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    ) as { API_URL?: string; SERVICE_ROLE_KEY?: string };
    if (parsed.API_URL && parsed.SERVICE_ROLE_KEY) {
      return {
        url: url || parsed.API_URL,
        serviceRoleKey: serviceRoleKey || parsed.SERVICE_ROLE_KEY,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

const nonce = `idem${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const sharedSpotify = `sharedSp${nonce}`;
const futureDate = (offsetDays: number) => {
  const d = new Date(Date.UTC(2040, 0, 1));
  d.setUTCDate(d.getUTCDate() + offsetDays + (Date.now() % 3000));
  return d.toISOString().slice(0, 10);
};

function attraction(name: string, id: string, spotifyId?: string) {
  return {
    id: `${id}_${nonce}`,
    name: `${name} [${nonce}]`,
    type: 'attraction',
    ...(spotifyId
      ? {
          externalLinks: {
            spotify: [{ url: `https://open.spotify.com/artist/${spotifyId}` }],
          },
        }
      : {}),
  };
}

function tmEvent(
  id: string,
  name: string,
  localDate: string,
  attractions: unknown[],
) {
  return {
    id: `${id}_${nonce}`,
    name: `${name} [${nonce}]`,
    type: 'event',
    url: `https://www.ticketmaster.com/${id}-${nonce}/event/${id}`,
    dates: {
      start: {
        localDate,
        localTime: '19:30:00',
        dateTime: `${localDate}T19:30:00Z`,
      },
      timezone: 'America/Denver',
      status: { code: 'onsale' },
    },
    classifications: [
      { primary: true, segment: { name: 'Music' }, genre: { name: 'Rock' } },
    ],
    _embedded: {
      venues: [
        {
          id: `ven_${nonce}`,
          name: `Conflict Test Hall [${nonce}]`,
          timezone: 'America/Denver',
          city: { name: 'Testville' },
          state: { name: 'Colorado', stateCode: 'CO' },
          country: { name: 'United States Of America', countryCode: 'US' },
        },
      ],
      attractions,
    },
  };
}

describe('Supabase Integration: external-ID conflict idempotency and isolation', () => {
  const credentials = resolveCredentials();
  let admin: SupabaseClient | null = null;
  let catalogRepo: SupabaseCatalogRepository;
  let sourceRepo: SupabaseSourceRepository;
  let rawIngestRepo: SupabaseRawIngestRepository;
  let candidateRepo: SupabaseEventCandidateRepository;
  const candidateIds: string[] = [];

  function db(): SupabaseClient | null {
    if (!admin && process.env.CI) {
      throw new Error('Local Supabase unavailable in CI.');
    }
    return admin;
  }

  beforeAll(async () => {
    if (!credentials) return;
    assertSafeDatabaseTarget(
      credentials.url,
      false,
      'external-id conflict integration suite',
    );
    try {
      const c = createClient(credentials.url, credentials.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await c.from('sources').select('id').limit(1);
      if (error) return;
      admin = c;
    } catch {
      return;
    }
    sourceRepo = new SupabaseSourceRepository(admin!);
    rawIngestRepo = new SupabaseRawIngestRepository(admin!);
    candidateRepo = new SupabaseEventCandidateRepository(admin!);
    catalogRepo = new SupabaseCatalogRepository(admin!);
  });

  afterAll(async () => {
    const c = admin;
    if (!c) return;
    const like = `%[${nonce}]%`;
    const ids = async (table: string, col: string) =>
      ((await c.from(table).select('id').ilike(col, like)).data ?? []).map(
        (r: { id: string }) => r.id,
      );
    const eventIds = await ids('events', 'name');
    const artistIds = await ids('artists', 'name');
    const venueIds = await ids('venues', 'name');
    const cands = ((
      await c
        .from('event_candidates')
        .select('id, raw_ingest_id')
        .ilike('title', like)
    ).data ?? []) as Array<{ id: string; raw_ingest_id: string }>;
    const cIds = Array.from(
      new Set([...cands.map((x) => x.id), ...candidateIds]),
    );
    const rawIds = Array.from(new Set(cands.map((x) => x.raw_ingest_id)));
    const del = async (table: string, col: string, vals: string[]) => {
      if (vals.length === 0) return;
      const { error } = await c.from(table).delete().in(col, vals);
      if (error) throw new Error(`cleanup ${table}: ${error.message}`);
    };
    await del('candidate_resolutions', 'event_candidate_id', cIds);
    await del('event_field_evidence', 'event_id', eventIds);
    await del('event_field_evidence', 'candidate_id', cIds);
    await del('event_ticket_links', 'event_id', eventIds);
    await del('event_artists', 'event_id', eventIds);
    await del('event_sources', 'event_id', eventIds);
    await del('event_sources', 'candidate_id', cIds);
    await del('events', 'id', eventIds);
    await del('event_candidates', 'id', cIds);
    await del('raw_ingests', 'id', rawIds);
    await del('artist_external_ids', 'artist_id', artistIds);
    await del('artists', 'id', artistIds);
    await del('venues', 'id', venueIds);
  });

  function ingest(fixtureJson: string) {
    return runTicketmasterIngestion({
      useFixture: true,
      fixtureJson,
      persist: true,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
    });
  }

  async function count(table: string, col: string, pattern: string) {
    const { data, error } = await admin!
      .from(table)
      .select('id')
      .ilike(col, pattern);
    if (error) throw new Error(`${table}: ${error.message}`);
    return data!.length;
  }

  it('repeated processing of a shared-id listing is idempotent (3 runs): collapsed into one artist; unrelated events in the batch complete', async () => {
    if (!db()) return;
    const fixtureJson = JSON.stringify({
      _embedded: {
        events: [
          tmEvent(
            'conf',
            'Conflicting Listing (Synthetic Test)',
            futureDate(5),
            [
              attraction('Twin One (Synthetic Test)', 'twA', sharedSpotify),
              attraction('Twin Two (Synthetic Test)', 'twB', sharedSpotify),
            ],
          ),
          tmEvent('okay1', 'Fine Show One (Synthetic Test)', futureDate(6), [
            attraction('Fine Act One (Synthetic Test)', 'fnA', `fineA${nonce}`),
          ]),
          tmEvent('okay2', 'Fine Show Two (Synthetic Test)', futureDate(7), [
            attraction('Fine Act Two (Synthetic Test)', 'fnB', `fineB${nonce}`),
          ]),
        ],
      },
      page: { size: 20, totalElements: 3, totalPages: 1, number: 0 },
    });
    const like = `%[${nonce}]%`;

    const run1 = await ingest(fixtureJson);
    expect(run1.canonicalEventsCreated).toBe(3);
    expect(run1.candidatesNeedsReview).toBe(0);
    expect(await count('events', 'name', 'Fine Show%' + like)).toBe(2);
    expect(await count('events', 'name', 'Conflicting Listing%' + like)).toBe(
      1,
    );

    const snapshot = async () => ({
      events: await count('events', 'name', like),
      artists: await count('artists', 'name', like),
      candidates: await count('event_candidates', 'title', like),
      confRes: await (async () => {
        const { data } = await admin!
          .from('event_candidates')
          .select('id')
          .ilike('title', 'Conflicting Listing%' + like);
        const { data: res } = await admin!
          .from('candidate_resolutions')
          .select('status, reasons, event_id')
          .in(
            'event_candidate_id',
            (data ?? []).map((r: { id: string }) => r.id),
          );
        return res ?? [];
      })(),
    });
    const s1 = await snapshot();
    expect(s1.events).toBe(3);
    // Twin One + Twin Two collapse into ONE artist, plus the two Fine acts
    expect(s1.artists).toBe(3);
    expect(s1.confRes).toHaveLength(1);
    expect(s1.confRes[0].status).toBe('created');
    expect(s1.confRes[0].event_id).not.toBeNull();

    const run2 = await ingest(fixtureJson);
    const run3 = await ingest(fixtureJson);
    for (const r of [run2, run3]) {
      expect(r.canonicalEventsCreated).toBe(0);
      expect(r.candidatesNeedsReview).toBe(0);
    }
    const s3 = await snapshot();
    expect(s3.events).toBe(s1.events);
    expect(s3.artists).toBe(s1.artists);
    expect(s3.confRes).toEqual(s1.confRes);
    expect(s3.confRes).toHaveLength(1);
  });

  it('an existing artist that already owns the external id is never merged or reassigned (pipeline match + direct conflicting payload, repeated)', async () => {
    if (!db()) return;
    const ownerName = `Established Owner (Synthetic Test) [${nonce}]`;
    const { data: owner } = await admin!
      .from('artists')
      .insert({ name: ownerName, normalized_name: ownerName.toLowerCase() })
      .select('id, name, normalized_name')
      .single();
    const ownedId = `ownedIdem${nonce}`;
    await admin!.from('artist_external_ids').insert({
      artist_id: owner!.id,
      provider: 'spotify',
      external_id: ownedId,
    });
    const ownerExt = async () =>
      (
        await admin!
          .from('artist_external_ids')
          .select('artist_id, provider, external_id')
          .eq('provider', 'spotify')
          .eq('external_id', ownedId)
      ).data;
    expect(await ownerExt()).toEqual([
      { artist_id: owner!.id, provider: 'spotify', external_id: ownedId },
    ]);

    // (1) Pipeline: an attraction carrying the owned id resolves to the owner by
    // external id (never creates a second artist, never reassigns the id).
    const fixtureJson = JSON.stringify({
      _embedded: {
        events: [
          tmEvent('own', 'Owner Match (Synthetic Test)', futureDate(9), [
            attraction(
              'Different Display Name (Synthetic Test)',
              'prA',
              ownedId,
            ),
          ]),
        ],
      },
      page: { size: 20, totalElements: 1, totalPages: 1, number: 0 },
    });
    for (let i = 0; i < 2; i++) await ingest(fixtureJson);
    expect(await ownerExt()).toEqual([
      { artist_id: owner!.id, provider: 'spotify', external_id: ownedId },
    ]);
    expect(
      await count('artists', 'name', `Different Display Name%[${nonce}]`),
    ).toBe(0);
    expect(await count('events', 'name', `Owner Match%[${nonce}]`)).toBe(1);

    // (2) Direct payload: a different artist id claims the owned id -> needs_review,
    // repeated for the same candidate does not duplicate or reassign.
    const candId = await insertCandidate('Owned Direct');
    const eventName = `Owned Direct Event [${nonce}]`;
    const payload = {
      event: {
        name: eventName,
        normalized_name: eventName.toLowerCase(),
        timezone: 'America/Denver',
        local_start_date: futureDate(60),
      },
      artists: [
        {
          artist_id: crypto.randomUUID(),
          name: `Claimant (Synthetic Test) [${nonce}]`,
          external_ids: [{ provider: 'spotify', external_id: ownedId }],
          billing_position: 'headliner',
          sort_order: 0,
        },
      ],
      resolution: {
        event_candidate_id: candId,
        status: 'created',
        confidence: 0.9,
        reasons: [],
      },
    };
    for (let i = 0; i < 2; i++) {
      const r = await admin!.rpc('apply_canonicalization', { payload });
      expect(r.error).toBeNull();
      expect((r.data as { status: string }).status).toBe('needs_review');
    }
    expect(await ownerExt()).toEqual([
      { artist_id: owner!.id, provider: 'spotify', external_id: ownedId },
    ]);
    const { data: ownerAfter } = await admin!
      .from('artists')
      .select('id, name, normalized_name')
      .eq('id', owner!.id)
      .single();
    expect(ownerAfter).toEqual(owner);
    expect(await count('artists', 'name', `Claimant%[${nonce}]`)).toBe(0);
    expect(await count('events', 'name', eventName)).toBe(0);
    const { data: res } = await admin!
      .from('candidate_resolutions')
      .select('status, reasons, event_id')
      .eq('event_candidate_id', candId);
    // The RPC itself is called twice with the same payload; the pipeline/repo
    // layer (not the RPC) is what skips already-persisted resolutions. Every row
    // must be needs_review without an event and never touch the owner.
    expect(res!.length).toBeGreaterThanOrEqual(1);
    for (const row of res!) {
      expect(row.status).toBe('needs_review');
      expect(row.event_id).toBeNull();
      expect(row.reasons).toContain('external_id_owned_by_different_artist');
    }
  });

  async function insertCandidate(title: string): Promise<string> {
    const { data: source } = await admin!
      .from('sources')
      .select('id')
      .limit(1)
      .single();
    const { data: raw, error: rawErr } = await admin!
      .from('raw_ingests')
      .insert({
        source_id: source!.id,
        source_url: `https://example.test/${nonce}/${title}`,
        acquisition_method: 'api',
        content_hash: `h_${nonce}_${title}`,
        payload: {},
      })
      .select('id')
      .single();
    if (rawErr) throw new Error(`raw insert: ${rawErr.message}`);
    const { data: cand, error: candErr } = await admin!
      .from('event_candidates')
      .insert({
        source_id: source!.id,
        raw_ingest_id: raw!.id,
        source_type: 'ticketing',
        acquisition_method: 'api',
        source_url: `https://example.test/${nonce}/${title}`,
        title: `${title} [${nonce}]`,
        venue_name: 'x',
        city: 'x',
      })
      .select('id')
      .single();
    if (candErr) throw new Error(`candidate insert: ${candErr.message}`);
    candidateIds.push(cand!.id);
    return cand!.id;
  }
});
