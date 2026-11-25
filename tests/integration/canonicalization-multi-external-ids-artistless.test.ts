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

interface TmEventOptions {
  attractions?: unknown[];
  venue?: string;
  genre?: string | null;
  price?: boolean;
  image?: boolean;
}

function tmEvent(
  id: string,
  name: string,
  localDate: string,
  opts: TmEventOptions = {},
) {
  const genre = opts.genre === undefined ? 'Rock' : opts.genre;
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
    ...(genre
      ? {
          classifications: [
            {
              primary: true,
              segment: { name: 'Music' },
              genre: { name: genre },
            },
          ],
        }
      : {}),
    ...(opts.price
      ? { priceRanges: [{ type: 'standard', currency: 'USD', min: 5, max: 5 }] }
      : {}),
    ...(opts.image
      ? {
          images: [
            {
              url: `https://img.example.test/${id}-${nonce}.jpg`,
              ratio: '16_9',
              width: 1024,
              height: 576,
            },
          ],
        }
      : {}),
    _embedded: {
      venues: [
        {
          id: `ven_${nonce}`,
          name: `${opts.venue ?? 'Multi Id Test Hall (Synthetic Test)'} [${nonce}]`,
          timezone: 'America/Denver',
          city: { name: 'Testville' },
          state: { name: 'Colorado', stateCode: 'CO' },
          country: { name: 'United States Of America', countryCode: 'US' },
        },
      ],
      ...(opts.attractions ? { attractions: opts.attractions } : {}),
    },
  };
}

const wrap = (events: unknown[]) =>
  JSON.stringify({
    _embedded: { events },
    page: {
      size: 20,
      totalElements: events.length,
      totalPages: 1,
      number: 0,
    },
  });

describe('Supabase Integration: several external ids per provider and artist-less events', () => {
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
      'multi external-id / artist-less integration suite',
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

  // Cleanup removes exactly the rows this run created (all carry "[nonce]" in their names/titles).
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

  async function seedArtist(name: string) {
    const full = `${name} [${nonce}]`;
    const { data, error } = await admin!
      .from('artists')
      .insert({ name: full, normalized_name: full.toLowerCase() })
      .select('id')
      .single();
    if (error) throw new Error(`seed artist: ${error.message}`);
    return data!.id as string;
  }

  async function extIds(artistId: string, provider: string) {
    const { data } = await admin!
      .from('artist_external_ids')
      .select('external_id')
      .eq('artist_id', artistId)
      .eq('provider', provider);
    return (data ?? [])
      .map((r: { external_id: string }) => r.external_id)
      .sort();
  }

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

  it('the database lets one artist hold two ids of one provider but never one id for two artists', async () => {
    if (!db()) return;
    const a = await seedArtist('Two Ids Artist (Synthetic Test)');
    const b = await seedArtist('Other Owner Artist (Synthetic Test)');
    const idOne = `multiOne${nonce}`;
    const idTwo = `multiTwo${nonce}`;
    for (const id of [idOne, idTwo]) {
      const { error } = await admin!
        .from('artist_external_ids')
        .insert({ artist_id: a, provider: 'ticketmaster', external_id: id });
      expect(error).toBeNull();
    }
    expect(await extIds(a, 'ticketmaster')).toEqual([idOne, idTwo].sort());

    const { error: dup } = await admin!
      .from('artist_external_ids')
      .insert({ artist_id: b, provider: 'ticketmaster', external_id: idOne });
    expect(dup?.code).toBe('23505');
    expect(dup?.message).toMatch(/uq_artist_provider_external_id/);
    expect(await extIds(b, 'ticketmaster')).toEqual([]);
  });

  it('apply_canonicalization gives an artist an additional id; an id owned by a DIFFERENT artist is a persisted needs_review', async () => {
    if (!db()) return;
    const owner = await seedArtist('Payload Owner (Synthetic Test)');
    const other = await seedArtist('Payload Other (Synthetic Test)');
    const otherId = `othersId${nonce}`;
    await admin!.from('artist_external_ids').insert({
      artist_id: other,
      provider: 'ticketmaster',
      external_id: otherId,
    });
    const firstId = `payloadA${nonce}`;
    const secondId = `payloadB${nonce}`;

    const mk = (candId: string, ext: string, name: string, day: number) => ({
      event: {
        name: `${name} [${nonce}]`,
        normalized_name: `${name} [${nonce}]`.toLowerCase(),
        timezone: 'America/Denver',
        local_start_date: futureDate(day),
      },
      artists: [
        {
          artist_id: owner,
          external_ids: [{ provider: 'ticketmaster', external_id: ext }],
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
    });

    for (const [ext, day] of [
      [firstId, 80],
      [secondId, 81],
    ] as const) {
      const candId = await insertCandidate(`Payload ${ext}`);
      const r = await admin!.rpc('apply_canonicalization', {
        payload: mk(candId, ext, `Payload Event ${ext}`, day),
      });
      expect(r.error).toBeNull();
      expect((r.data as { status: string }).status).toBe('created');
    }
    expect(await extIds(owner, 'ticketmaster')).toEqual(
      [firstId, secondId].sort(),
    );

    // An id that belongs to another artist is never reassigned
    const conflictCand = await insertCandidate('Payload Conflict');
    const conflict = await admin!.rpc('apply_canonicalization', {
      payload: mk(conflictCand, otherId, 'Payload Conflict Event', 82),
    });
    expect(conflict.error).toBeNull();
    expect((conflict.data as { status: string }).status).toBe('needs_review');
    const { data: res } = await admin!
      .from('candidate_resolutions')
      .select('status, event_id, reasons')
      .eq('event_candidate_id', conflictCand);
    expect(res).toHaveLength(1);
    expect(res![0].status).toBe('needs_review');
    expect(res![0].event_id).toBeNull();
    expect(res![0].reasons).toContain('duplicate_external_id_conflict');
    expect(res![0].reasons).toContain('external_id_owned_by_different_artist');
    expect(await extIds(other, 'ticketmaster')).toEqual([otherId]);
    expect(await extIds(owner, 'ticketmaster')).toEqual(
      [firstId, secondId].sort(),
    );
    expect(
      await count('events', 'name', `Payload Conflict Event%[${nonce}]`),
    ).toBe(0);
  });

  it('Day Out With Thomas style listing (two attractions, one shared Spotify id, one existing artist) creates its event, completes the batch and replays idempotently', async () => {
    if (!db()) return;
    const thomasSpotify = `thomasSp${nonce}`;
    const owner = await seedArtist('Thomas The Tank Engine (Synthetic Test)');
    await admin!.from('artist_external_ids').insert({
      artist_id: owner,
      provider: 'spotify',
      external_id: thomasSpotify,
    });

    const fixtureJson = wrap([
      tmEvent(
        'thomas',
        'Day Out With Thomas (Synthetic Test)',
        futureDate(10),
        {
          attractions: [
            attraction(
              'Day Out With Thomas (Synthetic Test)',
              'thA',
              thomasSpotify,
            ),
            attraction(
              'Thomas And Friends (Synthetic Test)',
              'thB',
              thomasSpotify,
            ),
          ],
        },
      ),
      tmEvent(
        'normalAfter',
        'Normal Show After (Synthetic Test)',
        futureDate(11),
        {
          attractions: [
            attraction(
              'Normal Act (Synthetic Test)',
              'nrm',
              `normalSp${nonce}`,
            ),
          ],
        },
      ),
    ]);

    const run1 = await ingest(fixtureJson);
    expect(run1.candidatesNeedsReview).toBe(0);
    expect(run1.canonicalEventsCreated).toBe(2);
    expect(
      await count('events', 'name', `Day Out With Thomas%[${nonce}]`),
    ).toBe(1);
    expect(await count('events', 'name', `Normal Show After%[${nonce}]`)).toBe(
      1,
    );

    // One artist on the event, carrying both Ticketmaster ids and its single Spotify id
    const { data: ev } = await admin!
      .from('events')
      .select('id')
      .ilike('name', `Day Out With Thomas%[${nonce}]`)
      .single();
    const { data: links } = await admin!
      .from('event_artists')
      .select('artist_id')
      .eq('event_id', ev!.id);
    expect(links).toEqual([{ artist_id: owner }]);
    expect(await extIds(owner, 'ticketmaster')).toEqual(
      [`thA_${nonce}`, `thB_${nonce}`].sort(),
    );
    expect(await extIds(owner, 'spotify')).toEqual([thomasSpotify]);
    expect(
      await count('artists', 'name', `Day Out With Thomas%[${nonce}]`),
    ).toBe(0);

    const run2 = await ingest(fixtureJson);
    expect(run2.canonicalEventsCreated).toBe(0);
    expect(
      await count('events', 'name', `Day Out With Thomas%[${nonce}]`),
    ).toBe(1);
    expect(await count('events', 'name', `Normal Show After%[${nonce}]`)).toBe(
      1,
    );
    expect(await extIds(owner, 'ticketmaster')).toHaveLength(2);
  });

  it('a shared id whose attraction ids belong to unrelated existing artists stays a persisted needs_review; different Spotify ids stay two artists', async () => {
    if (!db()) return;
    const x = await seedArtist('Unrelated X (Synthetic Test)');
    const y = await seedArtist('Unrelated Y (Synthetic Test)');
    const sp = `unrelSp${nonce}`;
    await admin!.from('artist_external_ids').insert([
      { artist_id: x, provider: 'ticketmaster', external_id: `unA_${nonce}` },
      { artist_id: y, provider: 'spotify', external_id: sp },
    ]);
    const bad = wrap([
      tmEvent(
        'unrel',
        'Unrelated Shared Listing (Synthetic Test)',
        futureDate(30),
        {
          attractions: [
            attraction('Unrelated Attraction A (Synthetic Test)', 'unA', sp),
            attraction('Unrelated Attraction B (Synthetic Test)', 'unB', sp),
          ],
        },
      ),
    ]);
    for (let i = 0; i < 2; i++) {
      const r = await ingest(bad);
      expect(r.canonicalEventsCreated).toBe(0);
      expect(r.candidatesNeedsReview).toBe(1);
    }
    expect(
      await count('events', 'name', `Unrelated Shared Listing%[${nonce}]`),
    ).toBe(0);
    const { data: cand } = await admin!
      .from('event_candidates')
      .select('id')
      .ilike('title', `Unrelated Shared Listing%[${nonce}]`);
    expect(cand).toHaveLength(1);
    const { data: res } = await admin!
      .from('candidate_resolutions')
      .select('status, event_id')
      .eq('event_candidate_id', cand![0].id);
    expect(res).toEqual([{ status: 'needs_review', event_id: null }]);
    expect(await extIds(x, 'ticketmaster')).toEqual([`unA_${nonce}`]);
    expect(await extIds(y, 'spotify')).toEqual([sp]);
    expect(await extIds(y, 'ticketmaster')).toEqual([]);

    // Different Spotify ids: two separate artists, no collapse
    const ok = wrap([
      tmEvent(
        'diffsp',
        'Different Spotify Listing (Synthetic Test)',
        futureDate(31),
        {
          attractions: [
            attraction(
              'Diff Attraction A (Synthetic Test)',
              'dfA',
              `dfSpA${nonce}`,
            ),
            attraction(
              'Diff Attraction B (Synthetic Test)',
              'dfB',
              `dfSpB${nonce}`,
            ),
          ],
        },
      ),
    ]);
    const run = await ingest(ok);
    expect(run.canonicalEventsCreated).toBe(1);
    expect(await count('artists', 'name', `Diff Attraction%[${nonce}]`)).toBe(
      2,
    );
    const { data: ev } = await admin!
      .from('events')
      .select('id')
      .ilike('name', `Different Spotify Listing%[${nonce}]`)
      .single();
    const { data: links } = await admin!
      .from('event_artists')
      .select('artist_id')
      .eq('event_id', ev!.id);
    expect(links).toHaveLength(2);
    const { data: evid } = await admin!
      .from('event_field_evidence')
      .select('id')
      .eq('event_id', ev!.id)
      .eq('field_name', 'shared_external_id_in_candidate_collapsed');
    expect(evid).toHaveLength(0);
  });

  it('artist-less listings: genre creates the event (price/image/genres carried), no genre is needs_review, two club nights stay separate, replay is idempotent', async () => {
    if (!db()) return;
    const night = futureDate(20);
    const fixtureJson = wrap([
      tmEvent('ladies', 'Ladies Night (Synthetic Test)', night, {
        venue: 'Stampede Test Club (Synthetic Test)',
        genre: 'Dance/Electronic',
        price: true,
        image: true,
      }),
      tmEvent('thursday', '$5 Thursdays! (Synthetic Test)', night, {
        venue: 'Stampede Test Club (Synthetic Test)',
        genre: 'Dance/Electronic',
        price: true,
      }),
      tmEvent('nogenre', 'Mystery Night (Synthetic Test)', futureDate(21), {
        venue: 'Stampede Test Club (Synthetic Test)',
        genre: null,
      }),
    ]);

    const run1 = await ingest(fixtureJson);
    expect(run1.canonicalEventsCreated).toBe(2);
    expect(run1.candidatesNeedsReview).toBe(1);
    expect(run1.reviewReasons['missing_artist_identity']).toBe(1);

    const { data: events } = await admin!
      .from('events')
      .select(
        'id, name, genre, genres, min_price, max_price, currency, image_url',
      )
      .ilike('name', `%(Synthetic Test) [${nonce}]`)
      .in('name', [
        `Ladies Night (Synthetic Test) [${nonce}]`,
        `$5 Thursdays! (Synthetic Test) [${nonce}]`,
      ]);
    expect(events).toHaveLength(2);
    const ladies = events!.find((e) => e.name.startsWith('Ladies'))!;
    expect(ladies.genre).toBe('Dance/Electronic');
    expect(ladies.genres).toEqual(['Dance/Electronic']);
    expect(Number(ladies.min_price)).toBe(5);
    expect(ladies.currency).toBe('USD');
    expect(ladies.image_url).toContain(`ladies-${nonce}`);
    const { data: artistLinks } = await admin!
      .from('event_artists')
      .select('artist_id')
      .in(
        'event_id',
        events!.map((e) => e.id),
      );
    expect(artistLinks).toEqual([]);
    expect(await count('events', 'name', `Mystery Night%[${nonce}]`)).toBe(0);

    const { data: mystery } = await admin!
      .from('event_candidates')
      .select('id')
      .ilike('title', `Mystery Night%[${nonce}]`);
    expect(mystery).toHaveLength(1);
    const { data: mysteryRes } = await admin!
      .from('candidate_resolutions')
      .select('status, event_id, reasons')
      .eq('event_candidate_id', mystery![0].id);
    expect(mysteryRes).toHaveLength(1);
    expect(mysteryRes![0].status).toBe('needs_review');
    expect(mysteryRes![0].event_id).toBeNull();
    expect(mysteryRes![0].reasons).toContain('missing_artist_identity');

    const run2 = await ingest(fixtureJson);
    const run3 = await ingest(fixtureJson);
    for (const r of [run2, run3]) {
      expect(r.canonicalEventsCreated).toBe(0);
      expect(r.candidatesNeedsReview).toBe(1);
    }
    expect(await count('events', 'name', `Ladies Night%[${nonce}]`)).toBe(1);
    expect(await count('events', 'name', `$5 Thursdays!%[${nonce}]`)).toBe(1);
    const { data: resRows } = await admin!
      .from('candidate_resolutions')
      .select('id')
      .in(
        'event_candidate_id',
        (
          (
            await admin!
              .from('event_candidates')
              .select('id')
              .ilike('title', `%(Synthetic Test) [${nonce}]`)
              .in('source_event_id', [
                `ladies_${nonce}`,
                `thursday_${nonce}`,
                `nogenre_${nonce}`,
              ])
          ).data ?? []
        ).map((r: { id: string }) => r.id),
      );
    expect(resRows).toHaveLength(3);
  });
});
