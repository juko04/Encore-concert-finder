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

const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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

describe('Supabase Integration: external-ID conflicts route to needs_review', () => {
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

  it('Ticketmaster listing whose two attractions share one Spotify id -> needs_review persisted, other events complete, no orphans', async () => {
    if (!db()) return;

    const fixtureJson = JSON.stringify({
      _embedded: {
        events: [
          tmEvent('thomas', 'Day Out With Thomas', futureDate(1), [
            attraction('Thomas The Tank Engine', 'attA', sharedSpotify),
            attraction('Thomas And Friends', 'attB', sharedSpotify),
          ]),
          tmEvent('normal', 'Normal Rock Night', futureDate(2), [
            attraction('Normal Headliner', 'attC', `normalSp${nonce}`),
          ]),
        ],
      },
      page: { size: 20, totalElements: 2, totalPages: 1, number: 0 },
    });

    const result = await runTicketmasterIngestion({
      useFixture: true,
      fixtureJson,
      persist: true,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
    });
    for (const cand of result.candidates)
      if (cand.id) candidateIds.push(cand.id);

    expect(result.candidatesNeedsReview).toBe(1);
    expect(result.reviewReasons['duplicate_external_id_conflict']).toBe(1);
    expect(result.canonicalEventsCreated).toBe(1);

    // needs_review persisted (look the persisted candidate up by title; the
    // pipeline's returned candidates are parse-time objects)
    const { data: thomasRows } = await admin!
      .from('event_candidates')
      .select('id, title')
      .ilike('title', `Day Out With Thomas%[${nonce}]`);
    expect(thomasRows).toHaveLength(1);
    const thomasCand = { id: thomasRows![0].id as string };
    candidateIds.push(thomasCand.id);
    const { data: res } = await admin!
      .from('candidate_resolutions')
      .select('status, event_id, reasons')
      .eq('event_candidate_id', thomasCand.id);
    expect(res).toHaveLength(1);
    expect(res![0].status).toBe('needs_review');
    expect(res![0].event_id).toBeNull();
    expect(res![0].reasons).toContain('duplicate_external_id_conflict');

    // The candidate observation row itself is untouched
    const { data: candRow } = await admin!
      .from('event_candidates')
      .select('id, title')
      .eq('id', thomasCand.id)
      .single();
    expect(candRow?.title).toContain('Day Out With Thomas');

    // No Thomas event, artists, or external ids were written (no orphans)
    const { data: thomasEvents } = await admin!
      .from('events')
      .select('id')
      .ilike('name', `Day Out With Thomas%[${nonce}]`);
    expect(thomasEvents).toHaveLength(0);
    const { data: thomasArtists } = await admin!
      .from('artists')
      .select('id')
      .ilike('name', `Thomas%[${nonce}]`);
    expect(thomasArtists).toHaveLength(0);
    const { data: sharedExt } = await admin!
      .from('artist_external_ids')
      .select('id')
      .eq('provider', 'spotify')
      .eq('external_id', sharedSpotify);
    expect(sharedExt).toHaveLength(0);

    // The unrelated event completed
    const { data: normalEvents } = await admin!
      .from('events')
      .select('id')
      .ilike('name', `Normal Rock Night%[${nonce}]`);
    expect(normalEvents).toHaveLength(1);

    // Replay skips the persisted needs_review instead of re-processing/raising
    const replay = await runTicketmasterIngestion({
      useFixture: true,
      fixtureJson,
      persist: true,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
    });
    expect(replay.canonicalEventsCreated).toBe(0);
    expect(replay.candidatesNeedsReview).toBe(1);
    const { data: resAfter } = await admin!
      .from('candidate_resolutions')
      .select('id')
      .eq('event_candidate_id', thomasCand.id);
    expect(resAfter).toHaveLength(1);
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

  it('apply_canonicalization direct call: shared id in payload and id owned by another artist persist needs_review, write nothing else; no-resolution call still raises', async () => {
    if (!db()) return;

    // Existing owner of an external id
    const ownerName = `Owner Artist [${nonce}]`;
    const { data: owner } = await admin!
      .from('artists')
      .insert({ name: ownerName, normalized_name: ownerName.toLowerCase() })
      .select('id')
      .single();
    const ownedId = `owned${nonce}`;
    await admin!.from('artist_external_ids').insert({
      artist_id: owner!.id,
      provider: 'spotify',
      external_id: ownedId,
    });

    const eventName = `Direct Conflict Event [${nonce}]`;
    const mkPayload = (candId: string | null, ext: string) => ({
      event: {
        name: eventName,
        normalized_name: eventName.toLowerCase(),
        timezone: 'America/Denver',
        local_start_date: futureDate(40),
      },
      artists: [
        {
          artist_id: crypto.randomUUID(),
          name: `Impostor One [${nonce}]`,
          external_ids: [{ provider: 'spotify', external_id: ext }],
          billing_position: 'headliner',
          sort_order: 0,
        },
        {
          artist_id: crypto.randomUUID(),
          name: `Impostor Two [${nonce}]`,
          external_ids: [{ provider: 'spotify', external_id: ext }],
          billing_position: 'support',
          sort_order: 1,
        },
      ],
      resolution: candId
        ? {
            event_candidate_id: candId,
            status: 'created',
            confidence: 0.9,
            reasons: [],
          }
        : null,
    });

    // (a) two artists in payload share an id
    const candA = await insertCandidate('Direct A');
    const a = await admin!.rpc('apply_canonicalization', {
      payload: mkPayload(candA, `fresh${nonce}`),
    });
    expect(a.error).toBeNull();
    expect((a.data as { status: string }).status).toBe('needs_review');

    // (b) both artists claim an id owned by a different existing artist
    const candB = await insertCandidate('Direct B');
    const b = await admin!.rpc('apply_canonicalization', {
      payload: mkPayload(candB, ownedId),
    });
    expect(b.error).toBeNull();
    expect((b.data as { status: string }).status).toBe('needs_review');

    for (const [candId, reason] of [
      [candA, 'external_id_shared_by_multiple_artists_in_candidate'],
      [candB, 'external_id_shared_by_multiple_artists_in_candidate'],
    ] as const) {
      const { data } = await admin!
        .from('candidate_resolutions')
        .select('status, event_id, reasons')
        .eq('event_candidate_id', candId);
      expect(data).toHaveLength(1);
      expect(data![0].status).toBe('needs_review');
      expect(data![0].event_id).toBeNull();
      expect(data![0].reasons).toContain('duplicate_external_id_conflict');
      expect(data![0].reasons).toContain(reason);
    }

    // Single impostor against the owned id -> owned-by-different-artist reason
    const candC = await insertCandidate('Direct C');
    const single = mkPayload(candC, ownedId);
    single.artists = [single.artists[0]];
    const c = await admin!.rpc('apply_canonicalization', { payload: single });
    expect(c.error).toBeNull();
    const { data: cRes } = await admin!
      .from('candidate_resolutions')
      .select('reasons')
      .eq('event_candidate_id', candC);
    expect(cRes![0].reasons).toContain('external_id_owned_by_different_artist');

    // Nothing written: no event, no impostor artists, owner untouched
    const { data: ev } = await admin!
      .from('events')
      .select('id')
      .eq('name', eventName);
    expect(ev).toHaveLength(0);
    const { data: imp } = await admin!
      .from('artists')
      .select('id')
      .ilike('name', `Impostor%[${nonce}]`);
    expect(imp).toHaveLength(0);
    const { data: ownerExt } = await admin!
      .from('artist_external_ids')
      .select('artist_id')
      .eq('provider', 'spotify')
      .eq('external_id', ownedId);
    expect(ownerExt).toEqual([{ artist_id: owner!.id }]);

    // Without a resolution the original hard failure is preserved
    const d = await admin!.rpc('apply_canonicalization', {
      payload: mkPayload(null, ownedId),
    });
    expect(d.error?.message).toMatch(/already assigned|duplicate/i);
  });

  it('apply_canonicalization persists event-less needs_review resolutions', async () => {
    if (!db()) return;
    const candId = await insertCandidate('Eventless');
    const r = await admin!.rpc('apply_canonicalization', {
      payload: {
        resolution: {
          event_candidate_id: candId,
          status: 'needs_review',
          confidence: 0.4,
          reasons: ['missing_venue_identity'],
        },
      },
    });
    expect(r.error).toBeNull();
    expect((r.data as { status: string }).status).toBe('needs_review');
    const { data } = await admin!
      .from('candidate_resolutions')
      .select('status, event_id, reasons')
      .eq('event_candidate_id', candId);
    expect(data).toHaveLength(1);
    expect(data![0].status).toBe('needs_review');
    expect(data![0].reasons).toEqual(['missing_venue_identity']);
  });
});
