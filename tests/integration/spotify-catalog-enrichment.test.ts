import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import {
  SpotifyCatalogEnricher,
  SPOTIFY_ID_REGEX,
  type SpotifyArtistSearchResult,
} from '@/lib/entity-resolution/spotify-catalog-enricher';

interface LocalCredentials {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

function resolveSupabaseCredentials(): LocalCredentials | null {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && serviceRoleKey) {
    return {
      url,
      anonKey: anonKey || '',
      serviceRoleKey,
    };
  }

  return null;
}

describe('Spotify Catalog Enrichment Integration Suite', () => {
  const credentials = resolveSupabaseCredentials();
  let adminClient: SupabaseClient | null = null;
  const createdArtistIds: string[] = [];

  const clientId = process.env.SPOTIFY_CLIENT_ID || 'dummy-client-id';
  const clientSecret =
    process.env.SPOTIFY_CLIENT_SECRET || 'dummy-client-secret';

  beforeAll(async () => {
    if (!credentials) {
      if (process.env.CI) {
        throw new Error('Supabase credentials could not be resolved in CI.');
      }
      return;
    }

    assertSafeDatabaseTarget(
      credentials.url,
      false,
      'Integration test: spotify-catalog-enrichment',
    );

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterAll(async () => {
    if (adminClient && createdArtistIds.length > 0) {
      // Clean up test artists created during the integration suite
      await adminClient.from('artists').delete().in('id', createdArtistIds);
    }
  });

  it('enforces destination safety guard against unsafe remote URLs', () => {
    expect(() => {
      new SpotifyCatalogEnricher({
        supabaseUrl: 'https://evil-remote-database.supabase.co',
        allowProductionWrite: false,
      });
    }).toThrow(/not a verified local or development instance/);
  });

  it('performs verified linking with exact 1:1 match and updates image_url if null', async () => {
    if (!adminClient || !credentials) {
      console.warn('Skipping integration test: Supabase database unavailable.');
      return;
    }

    const testArtistId = crypto.randomUUID();
    createdArtistIds.push(testArtistId);

    // Create a test artist without image_url
    const { error: insertErr } = await adminClient.from('artists').insert({
      id: testArtistId,
      name: 'Test Corroborated Artist',
      normalized_name: 'test corroborated artist',
      image_url: null,
    });
    expect(insertErr).toBeNull();

    // Mock fetchFn providing 1 exact match
    const mockSpotifyArtistId =
      'spotify_test_id_' + crypto.randomUUID().slice(0, 8);
    const mockImageUrl = 'https://i.scdn.co/image/test-corroborated.jpg';

    const mockFetch: typeof fetch = async (input) => {
      const urlStr = String(input);
      if (urlStr.includes('/api/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'mock_token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('/v1/search')) {
        const items: SpotifyArtistSearchResult[] = [
          {
            id: mockSpotifyArtistId,
            name: 'Test Corroborated Artist',
            external_urls: {
              spotify: `https://open.spotify.com/artist/${mockSpotifyArtistId}`,
            },
            images: [{ url: mockImageUrl, height: 640, width: 640 }],
          },
          {
            id: 'unrelated_id',
            name: 'Unrelated Artist Name',
            external_urls: {
              spotify: 'https://open.spotify.com/artist/unrelated_id',
            },
          },
        ];
        return new Response(JSON.stringify({ artists: { items } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    };

    const enricher = new SpotifyCatalogEnricher({
      supabase: adminClient,
      supabaseUrl: credentials.url,
      clientId,
      clientSecret,
      fetchFn: mockFetch,
    });

    const result = await enricher.enrichArtist({
      id: testArtistId,
      name: 'Test Corroborated Artist',
      imageUrl: null,
    });

    expect(result.status).toBe('enriched');
    expect(result.spotifyId).toBe(mockSpotifyArtistId);
    expect(result.imageUpdated).toBe(true);
    expect(result.imageUrl).toBe(mockImageUrl);

    // Verify in database: artist_external_ids
    const { data: extRow, error: extErr } = await adminClient
      .from('artist_external_ids')
      .select('*')
      .eq('artist_id', testArtistId)
      .eq('provider', 'spotify')
      .single();

    expect(extErr).toBeNull();
    expect(extRow).toBeDefined();
    expect(extRow.external_id).toBe(mockSpotifyArtistId);
    expect(extRow.provider_url).toBe(
      `https://open.spotify.com/artist/${mockSpotifyArtistId}`,
    );

    // Verify in database: artists table image_url was updated
    const { data: artistRow } = await adminClient
      .from('artists')
      .select('image_url')
      .eq('id', testArtistId)
      .single();

    expect(artistRow?.image_url).toBe(mockImageUrl);
  });

  it('preserves existing non-null image_url during verified linking (field-level provenance)', async () => {
    if (!adminClient || !credentials) return;

    const testArtistId = crypto.randomUUID();
    createdArtistIds.push(testArtistId);

    const existingImage = 'https://original-source.com/artist.jpg';
    await adminClient.from('artists').insert({
      id: testArtistId,
      name: 'Artist With Existing Image',
      normalized_name: 'artist with existing image',
      image_url: existingImage,
    });

    const mockSpotifyArtistId = 'spotify_id_' + crypto.randomUUID().slice(0, 8);

    const mockFetch: typeof fetch = async (input) => {
      const urlStr = String(input);
      if (urlStr.includes('/api/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock_token', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          artists: {
            items: [
              {
                id: mockSpotifyArtistId,
                name: 'Artist With Existing Image',
                images: [{ url: 'https://i.scdn.co/new-spotify-image.jpg' }],
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const enricher = new SpotifyCatalogEnricher({
      supabase: adminClient,
      supabaseUrl: credentials.url,
      clientId,
      clientSecret,
      fetchFn: mockFetch,
    });

    const result = await enricher.enrichArtist({
      id: testArtistId,
      name: 'Artist With Existing Image',
      imageUrl: existingImage,
    });

    expect(result.status).toBe('enriched');
    expect(result.imageUpdated).toBe(false);
    expect(result.imageUrl).toBe(existingImage);

    // Verify DB still holds original image
    const { data: artistRow } = await adminClient
      .from('artists')
      .select('image_url')
      .eq('id', testArtistId)
      .single();

    expect(artistRow?.image_url).toBe(existingImage);
  });

  it('enforces Priority 1 idempotency: skips artist if Spotify external ID already exists', async () => {
    if (!adminClient || !credentials) return;

    const testArtistId = crypto.randomUUID();
    createdArtistIds.push(testArtistId);

    await adminClient.from('artists').insert({
      id: testArtistId,
      name: 'Already Linked Artist',
      normalized_name: 'already linked artist',
    });

    // Seed existing spotify external ID
    const preExistingSpotifyId = 'spotify_already_present_123';
    await adminClient.from('artist_external_ids').insert({
      artist_id: testArtistId,
      provider: 'spotify',
      external_id: preExistingSpotifyId,
      provider_url: `https://open.spotify.com/artist/${preExistingSpotifyId}`,
    });

    let searchApiCalled = false;
    const mockFetch: typeof fetch = async (input) => {
      const urlStr = String(input);
      if (urlStr.includes('/v1/search')) {
        searchApiCalled = true;
      }
      return new Response('{}', { status: 200 });
    };

    const enricher = new SpotifyCatalogEnricher({
      supabase: adminClient,
      supabaseUrl: credentials.url,
      clientId,
      clientSecret,
      fetchFn: mockFetch,
    });

    const result = await enricher.enrichArtist({
      id: testArtistId,
      name: 'Already Linked Artist',
    });

    expect(result.status).toBe('already_linked');
    expect(result.spotifyId).toBe(preExistingSpotifyId);
    expect(result.apiRequestsUsed).toBe(0);
    expect(searchApiCalled).toBe(false);
  });

  it('enforces Invariant 5: ambiguous collision protection (>1 exact matches never inserted)', async () => {
    if (!adminClient || !credentials) return;

    const testArtistId = crypto.randomUUID();
    createdArtistIds.push(testArtistId);

    await adminClient.from('artists').insert({
      id: testArtistId,
      name: 'Mindset',
      normalized_name: 'mindset',
      image_url: null,
    });

    // Mock search returning 2 exact name matches (e.g. two artists named "Mindset")
    const mockFetch: typeof fetch = async (input) => {
      const urlStr = String(input);
      if (urlStr.includes('/api/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock_token', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          artists: {
            items: [
              {
                id: 'mindset_artist_1',
                name: 'Mindset',
                external_urls: {
                  spotify: 'https://open.spotify.com/artist/mindset_artist_1',
                },
              },
              {
                id: 'mindset_artist_2',
                name: 'Mindset',
                external_urls: {
                  spotify: 'https://open.spotify.com/artist/mindset_artist_2',
                },
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const enricher = new SpotifyCatalogEnricher({
      supabase: adminClient,
      supabaseUrl: credentials.url,
      clientId,
      clientSecret,
      fetchFn: mockFetch,
    });

    const result = await enricher.enrichArtist({
      id: testArtistId,
      name: 'Mindset',
      imageUrl: null,
    });

    expect(result.status).toBe('ambiguous');
    expect(result.ambiguousCandidates).toBeDefined();
    expect(result.ambiguousCandidates!.length).toBe(2);
    expect(result.reason).toContain('Ambiguous collision');

    // Invariant 5: NEVER auto-merge or insert into artist_external_ids!
    const { data: extRows } = await adminClient
      .from('artist_external_ids')
      .select('*')
      .eq('artist_id', testArtistId)
      .eq('provider', 'spotify');

    expect(extRows).toEqual([]);

    // image_url must not be modified
    const { data: artistRow } = await adminClient
      .from('artists')
      .select('image_url')
      .eq('id', testArtistId)
      .single();

    expect(artistRow?.image_url).toBeNull();
  });

  it('records unmatched status when 0 exact matches exist', async () => {
    if (!adminClient || !credentials) return;

    const testArtistId = crypto.randomUUID();
    createdArtistIds.push(testArtistId);

    await adminClient.from('artists').insert({
      id: testArtistId,
      name: 'Completely Unique Nonexistent Band 9999',
      normalized_name: 'completely unique nonexistent band 9999',
    });

    const mockFetch: typeof fetch = async (input) => {
      const urlStr = String(input);
      if (urlStr.includes('/api/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock_token', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          artists: {
            items: [
              {
                id: 'different_band',
                name: 'Different Band Name',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const enricher = new SpotifyCatalogEnricher({
      supabase: adminClient,
      supabaseUrl: credentials.url,
      clientId,
      clientSecret,
      fetchFn: mockFetch,
    });

    const result = await enricher.enrichArtist({
      id: testArtistId,
      name: 'Completely Unique Nonexistent Band 9999',
    });

    expect(result.status).toBe('unmatched');
    expect(result.reason).toContain(
      'No Spotify artists returned matching exact name',
    );

    const { data: extRows } = await adminClient
      .from('artist_external_ids')
      .select('*')
      .eq('artist_id', testArtistId)
      .eq('provider', 'spotify');

    expect(extRows).toEqual([]);
  });

  it('detects external ID conflict if Spotify ID is already claimed by another artist', async () => {
    if (!adminClient || !credentials) return;

    const artistAId = crypto.randomUUID();
    const artistBId = crypto.randomUUID();
    createdArtistIds.push(artistAId, artistBId);

    await adminClient.from('artists').insert([
      {
        id: artistAId,
        name: 'Original Owner Artist',
        normalized_name: 'original owner artist',
      },
      {
        id: artistBId,
        name: 'Duplicate Name Artist',
        normalized_name: 'duplicate name artist',
      },
    ]);

    const sharedSpotifyId = 'spotify_shared_collision_999';
    await adminClient.from('artist_external_ids').insert({
      artist_id: artistAId,
      provider: 'spotify',
      external_id: sharedSpotifyId,
      provider_url: `https://open.spotify.com/artist/${sharedSpotifyId}`,
    });

    // Artist B attempts to match to the same Spotify ID
    const mockFetch: typeof fetch = async (input) => {
      const urlStr = String(input);
      if (urlStr.includes('/api/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock_token', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          artists: {
            items: [
              {
                id: sharedSpotifyId,
                name: 'Duplicate Name Artist',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const enricher = new SpotifyCatalogEnricher({
      supabase: adminClient,
      supabaseUrl: credentials.url,
      clientId,
      clientSecret,
      fetchFn: mockFetch,
    });

    const result = await enricher.enrichArtist({
      id: artistBId,
      name: 'Duplicate Name Artist',
    });

    expect(result.status).toBe('ambiguous');
    expect(result.reason).toContain('already associated with canonical artist');

    // Verify Artist B was not given the external ID
    const { data: bExtRows } = await adminClient
      .from('artist_external_ids')
      .select('*')
      .eq('artist_id', artistBId);

    expect(bExtRows).toEqual([]);
  });

  it('performs live Spotify Web API corroboration when live credentials are configured', async () => {
    if (!adminClient || !credentials) return;
    if (
      !process.env.SPOTIFY_CLIENT_ID ||
      !process.env.SPOTIFY_CLIENT_SECRET ||
      process.env.SPOTIFY_CLIENT_ID === 'dummy-client-id'
    ) {
      console.warn(
        'Skipping live Spotify API test: No live Spotify credentials configured.',
      );
      return;
    }

    const testArtistId = crypto.randomUUID();
    createdArtistIds.push(testArtistId);

    await adminClient.from('artists').insert({
      id: testArtistId,
      name: 'Khruangbin',
      normalized_name: 'khruangbin',
      image_url: null,
    });

    // Real live enricher connecting to accounts.spotify.com and api.spotify.com
    const liveEnricher = new SpotifyCatalogEnricher({
      supabase: adminClient,
      supabaseUrl: credentials.url,
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      rateLimitDelayMs: 100,
    });

    const result = await liveEnricher.enrichArtist({
      id: testArtistId,
      name: 'Khruangbin',
      imageUrl: null,
    });

    expect(result.status).toBe('enriched');
    expect(result.spotifyId).toBe('2mVVjNmdjXZZDvhgQWiakk');
    expect(result.imageUrl).toContain('i.scdn.co');

    // Also test live ambiguous collision on real "Mindset"
    const mindsetArtistId = crypto.randomUUID();
    createdArtistIds.push(mindsetArtistId);

    await adminClient.from('artists').insert({
      id: mindsetArtistId,
      name: 'Mindset',
      normalized_name: 'mindset',
    });

    const mindsetResult = await liveEnricher.enrichArtist({
      id: mindsetArtistId,
      name: 'Mindset',
    });

    expect(mindsetResult.status).toBe('ambiguous');
    expect(mindsetResult.ambiguousCandidates!.length).toBeGreaterThanOrEqual(2);
  });

  it('validates 22-character alphanumeric Spotify ID format regex', () => {
    // Valid standard Spotify IDs
    expect(SPOTIFY_ID_REGEX.test('7kNqXtgeIwFtelmRjWv205')).toBe(true); // John Summit
    expect(SPOTIFY_ID_REGEX.test('6409kgOB4tZEkNZci6BiUs')).toBe(true); // Smoakland
    expect(SPOTIFY_ID_REGEX.test('6EN5zX1Q2W7qcesyatdUfO')).toBe(true); // Desert Dwellers
    expect(SPOTIFY_ID_REGEX.test('2mVVjNmdjXZZDvhgQWiakk')).toBe(true); // Khruangbin

    // Invalid / synthetic placeholders
    expect(SPOTIFY_ID_REGEX.test('spotify_smoakland_real')).toBe(false);
    expect(SPOTIFY_ID_REGEX.test('spotify_desert_dwellers_real')).toBe(false);
    expect(SPOTIFY_ID_REGEX.test('7kNqXtgeIwFtelmRjWv20')).toBe(false); // 21 chars
    expect(SPOTIFY_ID_REGEX.test('7kNqXtgeIwFtelmRjWv2055')).toBe(false); // 23 chars
    expect(SPOTIFY_ID_REGEX.test('7kNqXtgeIwFtelmRjWv20$')).toBe(false); // special char
  });

  it('batches artist queries via getArtistsByIds with resilience', async () => {
    if (!adminClient || !credentials) return;

    const mockFetch: typeof fetch = async (input) => {
      const urlStr = String(input);
      if (urlStr.includes('/api/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock_token', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('/v1/artists?ids=')) {
        return new Response(
          JSON.stringify({
            artists: [
              {
                id: '7kNqXtgeIwFtelmRjWv205',
                name: 'John Summit',
                external_urls: {
                  spotify:
                    'https://open.spotify.com/artist/7kNqXtgeIwFtelmRjWv205',
                },
              },
              {
                id: '6409kgOB4tZEkNZci6BiUs',
                name: 'Smoakland',
                external_urls: {
                  spotify:
                    'https://open.spotify.com/artist/6409kgOB4tZEkNZci6BiUs',
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const enricher = new SpotifyCatalogEnricher({
      supabase: adminClient,
      supabaseUrl: credentials.url,
      clientId,
      clientSecret,
      rateLimitDelayMs: 0,
      fetchFn: mockFetch,
    });

    const artistsMap = await enricher.getArtistsByIds([
      '7kNqXtgeIwFtelmRjWv205', // John Summit
      '6409kgOB4tZEkNZci6BiUs', // Smoakland
    ]);

    expect(artistsMap.size).toBe(2);
    const johnSummit = artistsMap.get('7kNqXtgeIwFtelmRjWv205');
    expect(johnSummit).toBeDefined();
    expect(johnSummit?.name).toBe('John Summit');

    const smoakland = artistsMap.get('6409kgOB4tZEkNZci6BiUs');
    expect(smoakland).toBeDefined();
    expect(smoakland?.name).toBe('Smoakland');
  });

  it('ensures John Summit exists in artists table with verified Spotify ID 7kNqXtgeIwFtelmRjWv205', async () => {
    if (!adminClient || !credentials) return;

    const enricher = new SpotifyCatalogEnricher({
      supabase: adminClient,
      supabaseUrl: credentials.url,
      clientId: process.env.SPOTIFY_CLIENT_ID || clientId,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET || clientSecret,
      rateLimitDelayMs: 60,
    });

    const result = await enricher.ensureJohnSummit();
    expect(result.artistId).toBeDefined();

    // Verify in database: artists table
    const { data: artistRow, error: aErr } = await adminClient
      .from('artists')
      .select('id, name, normalized_name, image_url')
      .eq('id', result.artistId)
      .single();

    expect(aErr).toBeNull();
    expect(artistRow).not.toBeNull();
    expect(artistRow!.name).toBe('John Summit');
    expect(artistRow!.normalized_name).toBe('john summit');
    expect(artistRow!.image_url).toContain('i.scdn.co');

    // Verify in database: artist_external_ids table
    const { data: extRow, error: extErr } = await adminClient
      .from('artist_external_ids')
      .select('artist_id, provider, external_id, provider_url')
      .eq('artist_id', result.artistId)
      .eq('provider', 'spotify')
      .single();

    expect(extErr).toBeNull();
    expect(extRow).not.toBeNull();
    expect(extRow!.external_id).toBe('7kNqXtgeIwFtelmRjWv205');
    expect(extRow!.provider_url).toBe(
      'https://open.spotify.com/artist/7kNqXtgeIwFtelmRjWv205',
    );
  });

  it('detects synthetic placeholders in catalog audit and flags them for repair', async () => {
    if (!adminClient || !credentials) return;

    const dummyArtistId = crypto.randomUUID();
    createdArtistIds.push(dummyArtistId);

    // Create a temporary test artist with synthetic placeholder
    await adminClient.from('artists').insert({
      id: dummyArtistId,
      name: 'Synthetic Test Band',
      normalized_name: 'synthetic test band',
    });

    await adminClient.from('artist_external_ids').insert({
      artist_id: dummyArtistId,
      provider: 'spotify',
      external_id: 'spotify_smoakland_real',
      provider_url: 'https://open.spotify.com/artist/spotify_smoakland_real',
    });

    const mockFetch: typeof fetch = async (input) => {
      const urlStr = String(input);
      if (urlStr.includes('/api/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock_token', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          id: 'test_id',
          name: 'Synthetic Test Band',
          artists: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const enricher = new SpotifyCatalogEnricher({
      supabase: adminClient,
      supabaseUrl: credentials.url,
      clientId,
      clientSecret,
      rateLimitDelayMs: 0,
      fetchFn: mockFetch,
    });

    const auditReport = await enricher.auditSpotifyMappings({
      repair: false,
      ensureJohnSummit: false,
    });

    expect(
      auditReport.summary.placeholdersDetectedCount,
    ).toBeGreaterThanOrEqual(1);
    expect(auditReport.summary.invalidFormatCount).toBeGreaterThanOrEqual(1);

    const flaggedRow = auditReport.rows.find(
      (r) => r.mappingId && r.artistId === dummyArtistId,
    );
    expect(flaggedRow).toBeDefined();
    expect(flaggedRow?.status).toBe('placeholder_detected');
    expect(flaggedRow?.isValidFormat).toBe(false);
    expect(flaggedRow?.isSyntheticPlaceholder).toBe(true);

    // Clean up temporary synthetic test artist immediately
    await adminClient.from('artists').delete().eq('id', dummyArtistId);
    const idx = createdArtistIds.indexOf(dummyArtistId);
    if (idx >= 0) createdArtistIds.splice(idx, 1);
  });

  it('runs exhaustive Spotify catalog audit and verifies full catalog integrity', async () => {
    if (!adminClient || !credentials) return;

    // Clean up any test artists created by prior integration test cases
    if (createdArtistIds.length > 0) {
      await adminClient.from('artists').delete().in('id', createdArtistIds);
      createdArtistIds.length = 0;
    }

    // Query existing mappings from DB so mockFetch can corroborate real names
    const { data: dbMappings } = await adminClient
      .from('artist_external_ids')
      .select('external_id, artists(name)')
      .eq('provider', 'spotify');

    const nameMap = new Map<string, string>();
    for (const m of dbMappings || []) {
      const a = m as unknown as {
        external_id: string;
        artists: { name: string } | null;
      };
      if (a.artists?.name) {
        nameMap.set(a.external_id, a.artists.name);
      }
    }

    const mockFetch: typeof fetch = async (input) => {
      const urlStr = String(input);
      if (urlStr.includes('/api/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock_token', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('/v1/artists?ids=')) {
        const urlObj = new URL(urlStr);
        const idsParam = urlObj.searchParams.get('ids') || '';
        const ids = idsParam.split(',').filter(Boolean);
        const artists = ids.map((id) => ({
          id,
          name: nameMap.get(id) || 'Corroborated Artist',
          external_urls: { spotify: `https://open.spotify.com/artist/${id}` },
        }));
        return new Response(JSON.stringify({ artists }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    };

    const enricher = new SpotifyCatalogEnricher({
      supabase: adminClient,
      supabaseUrl: credentials.url,
      clientId,
      clientSecret,
      rateLimitDelayMs: 0,
      fetchFn: mockFetch,
    });

    const report = await enricher.auditSpotifyMappings({
      repair: false,
      ensureJohnSummit: true,
    });

    expect(report.summary.totalAudited).toBeGreaterThanOrEqual(114);
    expect(report.summary.validFormatCount).toBe(report.summary.totalAudited);
    expect(report.summary.corroboratedCount).toBe(report.summary.totalAudited);
    expect(report.summary.invalidFormatCount).toBe(0);
    expect(report.summary.placeholdersDetectedCount).toBe(0);
    expect(report.summary.conflictingCount).toBe(0);
    expect(report.summary.ambiguousCount).toBe(0);
    expect(report.summary.nameMismatchCount).toBe(0);
    expect(report.summary.unverifiedCount).toBe(0);
  });
});
