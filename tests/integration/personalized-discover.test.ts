import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import { SupabaseUserPreferenceRepository } from '@/lib/repositories/user-preference-repository';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import {
  getPersonalizedDiscoverData,
  getPublicDiscoverData,
} from '@/lib/recommendation/service';

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

describe('PostgreSQL Integration: Personalized Discover Experience', () => {
  const credentials = resolveSupabaseCredentials();

  let adminClient: SupabaseClient | null = null;
  let clientA: SupabaseClient | null = null;
  let clientB: SupabaseClient | null = null;

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
          '[personalized-discover.test] Required Supabase integration test credentials could not be resolved in CI.',
        );
      }
      return;
    }

    assertSafeDatabaseTarget(
      credentials.url,
      false,
      'personalized-discover-integration',
    );

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: pingErr } = await adminClient
      .from('profiles')
      .select('count', { count: 'exact', head: true });

    if (pingErr) {
      if (process.env.CI) {
        throw new Error(`Local database ping failed in CI: ${pingErr.message}`);
      }
      return;
    }

    isDbAvailable = true;

    // Create test users A & B
    const emailA = `discover-a-${Date.now()}@encore.test`;
    const emailB = `discover-b-${Date.now()}@encore.test`;

    const { data: authA, error: authErrA } =
      await adminClient.auth.admin.createUser({
        email: emailA,
        password: 'Password123!',
        email_confirm: true,
      });
    if (authErrA || !authA.user) {
      throw new Error(`Failed to create Test User A: ${authErrA?.message}`);
    }
    userAId = authA.user.id;

    const { data: authB, error: authErrB } =
      await adminClient.auth.admin.createUser({
        email: emailB,
        password: 'Password123!',
        email_confirm: true,
      });
    if (authErrB || !authB.user) {
      throw new Error(`Failed to create Test User B: ${authErrB?.message}`);
    }
    userBId = authB.user.id;

    // Create user scoped clients
    const { data: signA, error: signErrA } =
      await adminClient.auth.signInWithPassword({
        email: emailA,
        password: 'Password123!',
      });
    if (signErrA || !signA.session) {
      throw new Error(`Failed to sign in User A: ${signErrA?.message}`);
    }

    clientA = createClient(credentials.url, credentials.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: { Authorization: `Bearer ${signA.session.access_token}` },
      },
    });

    const { data: signB, error: signErrB } =
      await adminClient.auth.signInWithPassword({
        email: emailB,
        password: 'Password123!',
      });
    if (signErrB || !signB.session) {
      throw new Error(`Failed to sign in User B: ${signErrB?.message}`);
    }

    clientB = createClient(credentials.url, credentials.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: { Authorization: `Bearer ${signB.session.access_token}` },
      },
    });

    // Seed canonical test artist, venue, and event
    const { data: artistRow, error: artistErr } = await adminClient
      .from('artists')
      .insert({
        name: 'The National',
        normalized_name: 'the national',
      })
      .select('id')
      .single();
    if (artistErr || !artistRow) {
      throw new Error(`Failed to seed artist: ${artistErr?.message}`);
    }
    testArtistId = artistRow.id;

    const { data: venueRow, error: venueErr } = await adminClient
      .from('venues')
      .insert({
        name: 'Mission Ballroom',
        normalized_name: 'mission ballroom',
        city: 'Denver',
        region: 'CO',
        country_code: 'US',
        lat: 39.7738,
        lng: -104.9789,
        timezone: 'America/Denver',
      })
      .select('id')
      .single();
    if (venueErr || !venueRow) {
      throw new Error(`Failed to seed venue: ${venueErr?.message}`);
    }
    testVenueId = venueRow.id;

    const { data: eventRow, error: eventErr } = await adminClient
      .from('events')
      .insert({
        name: 'The National Live at Mission Ballroom',
        normalized_name: 'the national live at mission ballroom',
        event_kind: 'concert',
        status: 'scheduled',
        venue_id: testVenueId,
        city: 'Denver',
        region: 'CO',
        country_code: 'US',
        lat: 39.7738,
        lng: -104.9789,
        timezone: 'America/Denver',
        local_start_date: '2026-11-20',
        starts_at: '2026-11-21T03:00:00Z',
        start_time_precision: 'instant',
        is_multi_day: false,
      })
      .select('id')
      .single();
    if (eventErr || !eventRow) {
      throw new Error(`Failed to seed event: ${eventErr?.message}`);
    }
    testEventId = eventRow.id;

    // Link artist to event
    const { error: artistLinkErr } = await adminClient
      .from('event_artists')
      .insert({
        event_id: testEventId,
        artist_id: testArtistId,
        billing_position: 'headliner',
        sort_order: 1,
      });
    if (artistLinkErr) {
      throw new Error(`Failed to seed event artist: ${artistLinkErr?.message}`);
    }

    // Insert ticket price link
    const { error: ticketLinkErr } = await adminClient
      .from('event_ticket_links')
      .insert({
        event_id: testEventId,
        url: 'https://tickets.example.com/the-national',
        normalized_url: 'https://tickets.example.com/the-national',
        min_price: 65,
        max_price: 95,
        currency: 'USD',
        inventory_status: 'available',
      });
    if (ticketLinkErr) {
      throw new Error(`Failed to seed ticket link: ${ticketLinkErr?.message}`);
    }
  });

  afterAll(async () => {
    if (adminClient) {
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
      if (testVenueId) {
        await adminClient.from('venues').delete().eq('id', testVenueId);
      }
      if (testArtistId) {
        await adminClient.from('artists').delete().eq('id', testArtistId);
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
    }
  });

  it('Scenario A: User A receives personalized recommendations while User B taste remains isolated', async () => {
    if (
      !isDbAvailable ||
      !clientA ||
      !clientB ||
      !userAId ||
      !userBId ||
      !testArtistId
    ) {
      return;
    }

    const prefRepoA = new SupabaseUserPreferenceRepository(clientA);
    const profileRepoA = new SupabaseProfileRepository(clientA);

    // User A sets profile: Denver location, 25mi radius, $80 budget, artist_first preset
    await profileRepoA.upsertProfile(userAId, {
      homeLatApprox: 39.7392,
      homeLngApprox: -104.9903,
      defaultRadiusMiles: 25,
      maxNormalTicketPrice: 80,
      recommendationPreset: 'artist_first',
    });

    // User A adds The National as Favorite
    await prefRepoA.savePreference({
      userId: userAId,
      artistId: testArtistId,
      artistName: 'The National',
      preferenceLevel: 'favorite',
    });

    // Fetch personalized discover data for User A
    const dataA = await getPersonalizedDiscoverData({
      userId: userAId,
      client: clientA,
      referenceDate: '2026-11-01',
      referenceInstant: '2026-11-01T00:00:00Z',
    });

    expect(dataA.activePreset).toBe('artist_first');
    expect(dataA.recommendations.length).toBeGreaterThan(0);

    const nationalRec = dataA.recommendations.find(
      (r) => r.eventId === testEventId,
    );
    expect(nationalRec).toBeDefined();
    expect(nationalRec?.score).toBeGreaterThan(80);
    expect(nationalRec?.factors.artist.score).toBe(100);
    expect(nationalRec?.explanation).toContain('Favorite artist');

    // Fetch personalized discover data for User B (has no preferences)
    const dataB = await getPersonalizedDiscoverData({
      userId: userBId,
      client: clientB,
      referenceDate: '2026-11-01',
      referenceInstant: '2026-11-01T00:00:00Z',
    });

    // Invariant: User B does NOT have The National in recommendations partition
    const nationalInB = dataB.recommendations.find(
      (r) => r.eventId === testEventId,
    );
    expect(nationalInB).toBeUndefined();

    // The National should be in User B's exploratory partition with neutral score
    const nationalExploratory = dataB.exploratory.find(
      (r) => r.eventId === testEventId,
    );
    if (nationalExploratory) {
      expect(nationalExploratory.factors.artist.score).toBe(40); // neutral exploratory
    }
  });

  it('Scenario B: Public Discover retrieves upcoming canonical events without personal scoring', async () => {
    if (!isDbAvailable || !adminClient) {
      return;
    }

    const publicData = await getPublicDiscoverData({
      client: adminClient,
      city: 'Denver',
    });

    expect(publicData.events.length).toBeGreaterThan(0);
    const found = publicData.events.find((e) => e.id === testEventId);
    expect(found).toBeDefined();
    expect(found?.title).toContain('The National');
  });

  it('Scenario C: Profile updates preserve other budget thresholds', async () => {
    if (!isDbAvailable || !clientA || !userAId) {
      return;
    }

    const profileRepoA = new SupabaseProfileRepository(clientA);

    // Initial setup with distinct prices
    await profileRepoA.upsertProfile(userAId, {
      maxSpontaneousPrice: 35,
      maxNormalTicketPrice: 75,
      maxFavoriteArtistPrice: 150,
    });

    // Update only maxNormalTicketPrice
    await profileRepoA.upsertProfile(userAId, {
      maxNormalTicketPrice: 90,
    });

    const updatedProfile = await profileRepoA.getProfile(userAId);
    expect(updatedProfile?.maxNormalTicketPrice).toBe(90);
    // Preserves other thresholds unchanged
    expect(updatedProfile?.maxSpontaneousPrice).toBe(35);
    expect(updatedProfile?.maxFavoriteArtistPrice).toBe(150);
  });
});
