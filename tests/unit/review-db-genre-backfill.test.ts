import { describe, expect, it } from 'vitest';
import { SpotifyCatalogEnricher } from '@/lib/entity-resolution/spotify-catalog-enricher';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Mapping {
  artist_id: string;
  external_id: string;
  genres: string[];
}

function fakeSupabase(
  mappings: Mapping[],
  opts?: { rowsMissingAtWrite?: Set<string> },
) {
  const writes: Array<{ id: string; patch: any; onlyIfMissing: boolean }> = [];
  const client = {
    from(table: string) {
      const state: any = { table, filters: [] as Array<[string, unknown]> };
      const builder: any = {
        select() {
          state.selected = true;
          return builder;
        },
        update(patch: any) {
          state.patch = patch;
          return builder;
        },
        eq(col: string, val: unknown) {
          state.filters.push([col, val]);
          return builder;
        },
        order() {
          return builder;
        },
        range(from: number, to: number) {
          state.range = [from, to];
          return builder;
        },
        then(resolve: any) {
          if (state.table === 'artist_external_ids') {
            const [from, to] = state.range ?? [0, mappings.length - 1];
            const slice = mappings.slice(from, to + 1).map((m) => ({
              artist_id: m.artist_id,
              external_id: m.external_id,
              artists: [{ id: m.artist_id, genres: m.genres }],
            }));
            return resolve({ data: slice, error: null });
          }
          if (state.table === 'artists' && state.patch) {
            const id = state.filters.find(
              ([c]: any) => c === 'id',
            )?.[1] as string;
            const onlyIfMissing = state.filters.some(
              ([c, v]: any) => c === 'genres' && v === '{}',
            );
            const stillMissing = !opts?.rowsMissingAtWrite
              ? true
              : opts.rowsMissingAtWrite.has(id);
            if (onlyIfMissing && !stillMissing) {
              return resolve({ data: [], error: null });
            }
            writes.push({ id, patch: state.patch, onlyIfMissing });
            return resolve({ data: [{ id }], error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as any, writes };
}

function spotifyFetch(genresById: Record<string, string[] | null>) {
  const calls: string[] = [];
  const fetchFn = (async (url: string) => {
    calls.push(String(url));
    if (String(url).includes('/api/token')) {
      return new Response(
        JSON.stringify({ access_token: 't', expires_in: 3600 }),
        { status: 200 },
      );
    }
    const ids = new URL(String(url)).searchParams.get('ids')!.split(',');
    return new Response(
      JSON.stringify({
        artists: ids.map((id) =>
          genresById[id] === undefined
            ? null
            : { id, name: id, genres: genresById[id] ?? [] },
        ),
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const mk = (
  supabase: any,
  fetchFn: typeof fetch,
  extra: Record<string, unknown> = {},
) =>
  new SpotifyCatalogEnricher({
    supabase,
    supabaseUrl: 'http://127.0.0.1:54321',
    clientId: 'id',
    clientSecret: 'secret',
    rateLimitDelayMs: 0,
    fetchFn,
    ...extra,
  });

describe('enricher.backfillGenres (fake Supabase + fake Spotify, no network)', () => {
  it('only fills artists with missing genres and records provenance', async () => {
    const { client, writes } = fakeSupabase([
      { artist_id: 'a1', external_id: 's1', genres: [] },
      { artist_id: 'a2', external_id: 's2', genres: ['house'] },
      { artist_id: 'a3', external_id: 's3', genres: [] },
    ]);
    const { fetchFn, calls } = spotifyFetch({
      s1: ['Tech House', ' house '],
      s2: ['should not be used'],
      s3: [],
    });
    const r = await mk(client, fetchFn).backfillGenres();
    expect(r).toMatchObject({ candidates: 2, updated: 1, skippedNoGenres: 1 });
    expect(writes).toHaveLength(1);
    expect(writes[0].id).toBe('a1');
    expect(writes[0].onlyIfMissing).toBe(true);
    expect(writes[0].patch.genres).toEqual(['tech house', 'house']);
    expect(writes[0].patch.genres_source).toBe('spotify');
    expect(typeof writes[0].patch.genres_updated_at).toBe('string');
    // The artist that already had genres was never even sent to Spotify
    expect(calls.join(' ')).not.toContain('s2');
  });

  it('never writes an empty genre list over existing data', async () => {
    const { client, writes } = fakeSupabase([
      { artist_id: 'a1', external_id: 's1', genres: [] },
    ]);
    const { fetchFn } = spotifyFetch({ s1: [] });
    const r = await mk(client, fetchFn).backfillGenres();
    expect(r.updated).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it('does not overwrite genres that appeared after the candidate list was read (race)', async () => {
    const { client, writes } = fakeSupabase(
      [{ artist_id: 'a1', external_id: 's1', genres: [] }],
      { rowsMissingAtWrite: new Set() }, // a1 got genres in the meantime
    );
    const { fetchFn } = spotifyFetch({ s1: ['house'] });
    const r = await mk(client, fetchFn).backfillGenres();
    expect(r.updated).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it('dry-run reads Spotify but writes nothing and reports wouldUpdate', async () => {
    const { client, writes } = fakeSupabase([
      { artist_id: 'a1', external_id: 's1', genres: [] },
    ]);
    const { fetchFn } = spotifyFetch({ s1: ['house'] });
    const r = await mk(client, fetchFn, { dryRun: true }).backfillGenres();
    expect(r).toMatchObject({ updated: 0, wouldUpdate: 1, candidates: 1 });
    expect(writes).toHaveLength(0);
  });

  it('is idempotent: a second run after the first finds nothing to fill', async () => {
    const mappings: Mapping[] = [
      { artist_id: 'a1', external_id: 's1', genres: [] },
    ];
    const { client } = fakeSupabase(mappings);
    const { fetchFn } = spotifyFetch({ s1: ['house'] });
    const first = await mk(client, fetchFn).backfillGenres();
    expect(first.updated).toBe(1);
    mappings[0].genres = ['house']; // what the DB now holds
    const second = await mk(client, fetchFn).backfillGenres();
    expect(second).toMatchObject({ candidates: 0, updated: 0 });
  });

  it('is not starved by many already-genred artists ahead of the missing ones', async () => {
    const mappings: Mapping[] = Array.from({ length: 2500 }, (_, i) => ({
      artist_id: `a${String(i).padStart(5, '0')}`,
      external_id: `s${i}`,
      genres: i < 2400 ? ['house'] : [],
    }));
    const { client, writes } = fakeSupabase(mappings);
    const genresById: Record<string, string[]> = {};
    for (let i = 2400; i < 2500; i++) genresById[`s${i}`] = ['techno'];
    const { fetchFn } = spotifyFetch(genresById);
    const r = await mk(client, fetchFn).backfillGenres({ limit: 50 });
    expect(r.candidates).toBe(50);
    expect(r.updated).toBe(50);
    expect(writes.every((w) => Number(w.id.slice(1)) >= 2400)).toBe(true);
  });
});

describe('remote-write guard', () => {
  it('refuses a remote database without the explicit production-write flag', () => {
    const { client } = fakeSupabase([]);
    const { fetchFn } = spotifyFetch({});
    expect(() =>
      mk(client, fetchFn, { supabaseUrl: 'https://abcd.supabase.co' }),
    ).toThrow();
  });
  it('allows a local database by default', () => {
    const { client } = fakeSupabase([]);
    const { fetchFn } = spotifyFetch({});
    expect(() => mk(client, fetchFn)).not.toThrow();
  });
});
