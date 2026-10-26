import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { rankEvents } from '@/lib/recommendation/engine';

interface LocalCredentials {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

function resolveSupabaseCredentials(): LocalCredentials | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && anonKey && serviceRoleKey) {
    return {
      url,
      anonKey,
      serviceRoleKey,
    };
  }

  try {
    const rawOutput = execSync('npx supabase status -o json', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(rawOutput) as {
      API_URL?: string;
      ANON_KEY?: string;
      SERVICE_ROLE_KEY?: string;
    };

    if (parsed.API_URL && parsed.ANON_KEY && parsed.SERVICE_ROLE_KEY) {
      return {
        url: url || parsed.API_URL,
        anonKey: anonKey || parsed.ANON_KEY,
        serviceRoleKey: serviceRoleKey || parsed.SERVICE_ROLE_KEY,
      };
    }
  } catch {
    // Supabase CLI status not available
  }

  return null;
}

describe('PostgreSQL Integration: Recommendation Scoring & Profile RLS', () => {
  const credentials = resolveSupabaseCredentials();

  let adminClient: SupabaseClient | null = null;
  let clientA: SupabaseClient | null = null;
  let clientB: SupabaseClient | null = null;
  let anonClient: SupabaseClient | null = null;

  let userAId: string | null = null;
  let userBId: string | null = null;
  let isDbAvailable = false;

  let testArtistId: string | null = null;
  let testVenueId: string | null = null;
  let testEventId: string | null = null;

  beforeAll(async () => {
    if (!credentials) {
      if (process.env.CI) {
        throw new Error(
          '[recommendation-scoring.test] Required Supabase integration test credentials could not be resolved in CI.',
        );
      }
      return;
    }

    assertSafeDatabaseTarget(
      credentials.url,
      false,
      'recommendation-scoring-integration',
    );

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: pingErr } = await adminClient
      .from('profiles')
      .select('id')
      .limit(1);

    if (pingErr) {
      throw new Error(
        `[recommendation-scoring.test] Local Supabase database unreachable at ${credentials.url}: ${pingErr.message}. Integration tests require a running database and applied migrations.`,
      );
    }
    isDbAvailable = true;

    const timestamp = Date.now();
    const emailA = `test_rec_a_${timestamp}@example.com`;
    const emailB = `test_rec_b_${timestamp}@example.com`;
    const password = 'TestSecurePassword123!';

    const { data: authA, error: errA } =
      await adminClient.auth.admin.createUser({
        email: emailA,
        password,
        email_confirm: true,
      });
    if (errA || !authA.user) {
      throw new Error(`Failed to create test user A: ${errA?.message}`);
    }
    userAId = authA.user.id;

    const { data: authB, error: errB } =
      await adminClient.auth.admin.createUser({
        email: emailB,
        password,
        email_confirm: true,
      });
    if (errB || !authB.user) {
      throw new Error(`Failed to create test user B: ${errB?.message}`);
    }
    userBId = authB.user.id;

    clientA = createClient(credentials.url, credentials.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await clientA.auth.signInWithPassword({ email: emailA, password });

    clientB = createClient(credentials.url, credentials.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await clientB.auth.signInWithPassword({ email: emailB, password });

    anonClient = createClient(credentials.url, credentials.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Seed test canonical catalog entities using adminClient
    testArtistId = crypto.randomUUID();
    const { error: artistErr } = await adminClient.from('artists').insert({
      id: testArtistId,
      name: `Postgres Rec Artist ${timestamp}`,
      normalized_name: `postgres rec artist ${timestamp}`,
    });
    if (artistErr) {
      throw new Error(`Failed to insert test artist: ${artistErr.message}`);
    }

    testVenueId = crypto.randomUUID();
    const { error: venueErr } = await adminClient.from('venues').insert({
      id: testVenueId,
      name: `Test Scoring Hall ${timestamp}`,
      normalized_name: `test scoring hall ${timestamp}`,
      city: 'Denver',
      region: 'CO',
      lat: 39.7392,
      lng: -104.9903,
    });
    if (venueErr) {
      throw new Error(`Failed to insert test venue: ${venueErr.message}`);
    }

    testEventId = crypto.randomUUID();
    const { error: eventErr } = await adminClient.from('events').insert({
      id: testEventId,
      name: `Postgres Rec Artist Live ${timestamp}`,
      normalized_name: `postgres rec artist live ${timestamp}`,
      event_kind: 'concert',
      status: 'scheduled',
      venue_id: testVenueId,
      city: 'Denver',
      region: 'CO',
      lat: 39.7392,
      lng: -104.9903,
      timezone: 'America/Denver',
      local_start_date: '2026-11-20',
      starts_at: '2026-11-20T20:00:00-07:00',
      start_time_precision: 'instant',
      is_multi_day: false,
    });
    if (eventErr) {
      throw new Error(`Failed to insert test event: ${eventErr.message}`);
    }

    const { error: eventArtistErr } = await adminClient
      .from('event_artists')
      .insert({
        event_id: testEventId,
        artist_id: testArtistId,
        billing_position: 'headliner',
        sort_order: 1,
      });
    if (eventArtistErr) {
      throw new Error(
        `Failed to insert test event artist: ${eventArtistErr.message}`,
      );
    }

    const { error: ticketLinkErr } = await adminClient
      .from('event_ticket_links')
      .insert({
        event_id: testEventId,
        url: `https://tickets.example.com/${testEventId}`,
        normalized_url: `https://tickets.example.com/${testEventId}`,
        min_price: 45,
        max_price: 65,
        currency: 'USD',
        inventory_status: 'available',
      });
    if (ticketLinkErr) {
      throw new Error(
        `Failed to insert test ticket link: ${ticketLinkErr.message}`,
      );
    }
  });

  afterAll(async () => {
    if (!adminClient || !isDbAvailable) return;

    if (testEventId) {
      await adminClient
        .from('event_ticket_links')
        .delete()
        .eq('event_id', testEventId);
      await adminClient
        .from('event_artists')
        .delete()
        .eq('event_id', testEventId);
      await adminClient.from('events').delete().eq('id', testEventId);
    }
    if (testArtistId) {
      await adminClient.from('artists').delete().eq('id', testArtistId);
    }
    if (testVenueId) {
      await adminClient.from('venues').delete().eq('id', testVenueId);
    }

    if (userAId) {
      await adminClient
        .from('user_artist_preferences')
        .delete()
        .eq('user_id', userAId);
      await adminClient.from('profiles').delete().eq('id', userAId);
      await adminClient.auth.admin.deleteUser(userAId);
    }
    if (userBId) {
      await adminClient
        .from('user_artist_preferences')
        .delete()
        .eq('user_id', userBId);
      await adminClient.from('profiles').delete().eq('id', userBId);
      await adminClient.auth.admin.deleteUser(userBId);
    }
  });

  it('enforces User Profile RLS: User A can manage profile and preset, but User B cannot view it', async () => {
    if (!isDbAvailable || !clientA || !clientB || !userAId) {
      return;
    }

    const profileRepoA = new SupabaseProfileRepository(clientA);

    // User A sets profile with recommendation preset 'nearby'
    const profileA = await profileRepoA.upsertProfile(userAId, {
      homeLatApprox: 39.7392,
      homeLngApprox: -104.9903,
      defaultRadiusMiles: 30,
      maxNormalTicketPrice: 70,
      recommendationPreset: 'nearby',
    });

    expect(profileA.id).toBe(userAId);
    expect(profileA.recommendationPreset).toBe('nearby');
    expect(profileA.defaultRadiusMiles).toBe(30);

    // User B attempts to read User A's profile: RLS blocks and returns null
    const profileRepoB = new SupabaseProfileRepository(clientB);
    const forbiddenRead = await profileRepoB.getProfile(userAId);
    expect(forbiddenRead).toBeNull();

    // Anon client receives 0 rows
    const { data: anonData } = await anonClient!.from('profiles').select('*');
    expect(anonData).toEqual([]);
  });

  it('scores live canonical catalog events using real database preferences and profile', async () => {
    if (
      !isDbAvailable ||
      !clientA ||
      !userAId ||
      !testArtistId ||
      !testEventId
    ) {
      return;
    }

    // 1. User A sets explicit Favorite preference for the seeded canonical artist
    const prefRepo = new SupabaseUserPreferenceRepository(clientA);
    await prefRepo.savePreference({
      userId: userAId,
      artistId: testArtistId,
      artistName: 'Postgres Rec Artist',
      preferenceLevel: 'favorite',
    });

    // 2. Fetch live profile, preferences, and catalog events
    const profileRepo = new SupabaseProfileRepository(clientA);
    const catalogRepo = new SupabaseCatalogRepository(clientA);

    const [profile, preferences, events] = await Promise.all([
      profileRepo.getProfile(userAId),
      prefRepo.getPreferences(userAId),
      catalogRepo.listEvents({ limit: 100, fromDate: '2026-11-01' }),
    ]);

    expect(profile).not.toBeNull();
    expect(preferences.length).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);

    // 3. Rank events with Balanced preset
    const resultBalanced = rankEvents(events, {
      userProfile: profile,
      artistPreferences: preferences,
      referenceDate: '2026-11-01',
      presetOverride: 'balanced',
    });

    const matchedRec = resultBalanced.recommendations.find(
      (r) => r.eventId === testEventId,
    );
    expect(matchedRec).toBeDefined();
    // Artist score is 100 because user marked artist as Favorite
    expect(matchedRec!.factors.artist.score).toBe(100);
    expect(matchedRec!.score).toBeGreaterThan(80);
    expect(matchedRec!.explanation).toContain('Favorite artist');

    // 4. Update preset to 'artist_first' under RLS and confirm ranking updates
    const updatedProfile = await profileRepo.updatePreset(
      userAId,
      'artist_first',
    );
    expect(updatedProfile.recommendationPreset).toBe('artist_first');

    const resultArtistFirst = rankEvents(events, {
      userProfile: updatedProfile,
      artistPreferences: preferences,
      referenceDate: '2026-11-01',
    });

    const matchedRecArtistFirst = resultArtistFirst.recommendations.find(
      (r) => r.eventId === testEventId,
    );
    expect(matchedRecArtistFirst).toBeDefined();
    expect(matchedRecArtistFirst!.weights.artist).toBe(65);
  });

  it('resolves explicit Spotify provider identity through artist_external_ids, disambiguates same-name artists, and isolates preferences across database reload', async () => {
    if (
      !isDbAvailable ||
      !adminClient ||
      !clientA ||
      !clientB ||
      !userAId ||
      !userBId ||
      !testVenueId
    ) {
      return;
    }

    const testNonce = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const artistAName = `SameName Star ${testNonce}`;
    const artistAId = crypto.randomUUID();
    const artistBId = crypto.randomUUID();
    const spotifyExtA = `spotify_star_a_${testNonce}`;
    const spotifyExtB = `spotify_star_b_${testNonce}`;
    const eventAId = crypto.randomUUID();
    const eventBId = crypto.randomUUID();

    try {
      // 1. Seed two distinct canonical artists with identical names but different IDs
      await adminClient.from('artists').insert([
        {
          id: artistAId,
          name: artistAName,
          normalized_name: artistAName.toLowerCase(),
        },
        {
          id: artistBId,
          name: artistAName, // Same display name!
          normalized_name: artistAName.toLowerCase(),
        },
      ]);

      // 2. Map provider external IDs
      await adminClient.from('artist_external_ids').insert([
        {
          artist_id: artistAId,
          provider: 'spotify',
          external_id: spotifyExtA,
        },
        {
          artist_id: artistBId,
          provider: 'spotify',
          external_id: spotifyExtB,
        },
      ]);

      // 3. Seed canonical events for Artist A and Artist B
      await adminClient.from('events').insert([
        {
          id: eventAId,
          name: `${artistAName} Live A`,
          normalized_name: `${artistAName.toLowerCase()} live a`,
          event_kind: 'concert',
          status: 'scheduled',
          venue_id: testVenueId,
          city: 'Denver',
          region: 'CO',
          lat: 39.7392,
          lng: -104.9903,
          timezone: 'America/Denver',
          local_start_date: '2026-11-22',
          starts_at: '2026-11-22T20:00:00-07:00',
          start_time_precision: 'instant',
          is_multi_day: false,
        },
        {
          id: eventBId,
          name: `${artistAName} Live B`,
          normalized_name: `${artistAName.toLowerCase()} live b`,
          event_kind: 'concert',
          status: 'scheduled',
          venue_id: testVenueId,
          city: 'Denver',
          region: 'CO',
          lat: 39.7392,
          lng: -104.9903,
          timezone: 'America/Denver',
          local_start_date: '2026-11-23',
          starts_at: '2026-11-23T20:00:00-07:00',
          start_time_precision: 'instant',
          is_multi_day: false,
        },
      ]);

      await adminClient.from('event_artists').insert([
        {
          event_id: eventAId,
          artist_id: artistAId,
          billing_position: 'headliner',
          sort_order: 1,
        },
        {
          event_id: eventBId,
          artist_id: artistBId,
          billing_position: 'headliner',
          sort_order: 1,
        },
      ]);

      await adminClient.from('event_ticket_links').insert([
        {
          event_id: eventAId,
          url: `https://tickets.example.com/${eventAId}`,
          normalized_url: `https://tickets.example.com/${eventAId}`,
          min_price: 50,
          max_price: 70,
          currency: 'USD',
        },
        {
          event_id: eventBId,
          url: `https://tickets.example.com/${eventBId}`,
          normalized_url: `https://tickets.example.com/${eventBId}`,
          min_price: 50,
          max_price: 70,
          currency: 'USD',
        },
      ]);

      // 4. User A saves preference explicitly targeting Artist A's Spotify ID as Favorite
      const prefRepoA = new SupabaseUserPreferenceRepository(clientA);
      await prefRepoA.savePreference({
        userId: userAId,
        artistName: artistAName,
        spotifyArtistId: spotifyExtA,
        preferenceLevel: 'favorite',
      });

      // 5. Reload preferences directly from database to test persistence
      const reloadedPrefsA = await prefRepoA.getPreferences(userAId);
      const matchedPrefA = reloadedPrefsA.find(
        (p) => p.spotifyArtistId === spotifyExtA,
      );
      expect(matchedPrefA).toBeDefined();
      expect(matchedPrefA!.preferenceLevel).toBe('favorite');

      // 6. User B cannot see User A's preference (RLS)
      const prefRepoB = new SupabaseUserPreferenceRepository(clientB);
      const userBPrefs = await prefRepoB.getPreferences(userBId);
      const leakedPref = userBPrefs.find(
        (p) => p.spotifyArtistId === spotifyExtA,
      );
      expect(leakedPref).toBeUndefined();

      // 7. Catalog lists events and joins artist_external_ids
      const catalogRepoA = new SupabaseCatalogRepository(clientA);
      const events = await catalogRepoA.listEvents({
        limit: 100,
        fromDate: '2026-11-20',
      });

      const profileRepoA = new SupabaseProfileRepository(clientA);
      const profileA = await profileRepoA.getProfile(userAId);

      const rankingResult = rankEvents(events, {
        userProfile: profileA,
        artistPreferences: reloadedPrefsA,
        referenceDate: '2026-11-01',
      });

      // Event A: Features Artist A -> Must match as Favorite (score 100)
      const recA = rankingResult.recommendations.find(
        (r) => r.eventId === eventAId,
      );
      expect(recA).toBeDefined();
      expect(recA!.factors.artist.score).toBe(100);
      expect(recA!.factors.artist.fieldStatus).toBe('verified');
      expect(recA!.explanation).toContain('Favorite artist');

      // Event B: Features Artist B (same name, different Spotify ID)
      // Must NOT inherit Artist A's preference! Must be in exploratory pool (score 40)
      const recBInRecommended = rankingResult.recommendations.find(
        (r) => r.eventId === eventBId,
      );
      expect(recBInRecommended).toBeUndefined();

      const recBInExploratory = rankingResult.exploratory.find(
        (r) => r.eventId === eventBId,
      );
      expect(recBInExploratory).toBeDefined();
      expect(recBInExploratory!.factors.artist.score).toBe(40); // Unmarked exploratory
      expect(recBInExploratory!.isExploratory).toBe(true);
    } finally {
      // Clean up test entities
      await adminClient
        .from('event_ticket_links')
        .delete()
        .in('event_id', [eventAId, eventBId]);
      await adminClient
        .from('event_artists')
        .delete()
        .in('event_id', [eventAId, eventBId]);
      await adminClient.from('events').delete().in('id', [eventAId, eventBId]);
      await adminClient
        .from('artist_external_ids')
        .delete()
        .in('artist_id', [artistAId, artistBId]);
      await adminClient
        .from('artists')
        .delete()
        .in('id', [artistAId, artistBId]);
    }
  });
});
