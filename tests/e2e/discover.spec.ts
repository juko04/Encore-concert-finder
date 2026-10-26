import { expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';

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

test.describe('Discover Page E2E Suite', () => {
  const credentials = resolveSupabaseCredentials();
  let adminClient: SupabaseClient | null = null;
  let isDbAvailable = false;

  let testUserId: string | null = null;
  let testArtistIdA: string | null = null;
  let testArtistIdB: string | null = null;
  let testVenueIdFar: string | null = null;
  let testVenueIdNear: string | null = null;
  let testEventIdA: string | null = null;
  let testEventIdB: string | null = null;

  const timestamp = Date.now();
  const testEmail = `e2e_discover_${timestamp}@encore.test`;
  const testPassword = 'Password123!SecureDiscover';

  test.beforeAll(async () => {
    if (!credentials) {
      if (process.env.CI) {
        throw new Error(
          'Supabase credentials could not be resolved from environment or CLI in CI.',
        );
      }
      return;
    }

    assertSafeDatabaseTarget(
      credentials.url,
      false,
      'Discover Page E2E Browser Test',
    );

    try {
      const response = await fetch(`${credentials.url}/auth/v1/health`, {
        headers: { apikey: credentials.anonKey },
      });
      if (response.ok) {
        isDbAvailable = true;
      }
    } catch {
      isDbAvailable = false;
    }

    if (!isDbAvailable) {
      if (process.env.CI) {
        throw new Error(
          `Local Supabase stack is not responding at ${credentials.url} in CI. Database validation is required for E2E tests on pull requests.`,
        );
      }
      console.warn(
        `Local Supabase stack is not responding at ${credentials.url}. Skipping authenticated discover E2E browser tests locally.`,
      );
      return;
    }

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create isolated test user with configured Denver location and artist_first preset
    const { data: created, error: createErr } =
      await adminClient.auth.admin.createUser({
        email: testEmail,
        password: testPassword,
        email_confirm: true,
      });

    if (createErr || !created.user) {
      throw new Error(`Failed to create E2E test user: ${createErr?.message}`);
    }
    testUserId = created.user.id;

    const { error: profileErr } = await adminClient.from('profiles').upsert({
      id: testUserId,
      home_lat_approx: 39.75,
      home_lng_approx: -104.99,
      default_radius_miles: 50,
      max_normal_ticket_price: 60,
      recommendation_preset: 'artist_first',
    });
    if (profileErr) {
      throw new Error(
        `Failed to configure user profile: ${profileErr.message}`,
      );
    }

    // 2. Seed Artist A (Favorite) and Artist B (Interested)
    const { data: artistRowA, error: artistErrA } = await adminClient
      .from('artists')
      .insert({
        name: `E2E Favorite Star ${timestamp}`,
        normalized_name: `e2e favorite star ${timestamp}`,
      })
      .select('id')
      .single();
    if (artistErrA || !artistRowA) {
      throw new Error(`Failed to seed Artist A: ${artistErrA?.message}`);
    }
    testArtistIdA = artistRowA.id;

    const { data: artistRowB, error: artistErrB } = await adminClient
      .from('artists')
      .insert({
        name: `E2E Local Opener ${timestamp}`,
        normalized_name: `e2e local opener ${timestamp}`,
      })
      .select('id')
      .single();
    if (artistErrB || !artistRowB) {
      throw new Error(`Failed to seed Artist B: ${artistErrB?.message}`);
    }
    testArtistIdB = artistRowB.id;

    // 3. Seed Venue Far (Colorado Springs, ~65 mi from Denver) and Venue Near (Denver downtown, 0 mi)
    const { data: venueRowFar, error: venueErrFar } = await adminClient
      .from('venues')
      .insert({
        name: `E2E Springs Amphitheater ${timestamp}`,
        normalized_name: `e2e springs amphitheater ${timestamp}`,
        city: 'Colorado Springs',
        region: 'CO',
        country_code: 'US',
        lat: 38.83,
        lng: -104.82,
        timezone: 'America/Denver',
      })
      .select('id')
      .single();
    if (venueErrFar || !venueRowFar) {
      throw new Error(`Failed to seed Venue Far: ${venueErrFar?.message}`);
    }
    testVenueIdFar = venueRowFar.id;

    const { data: venueRowNear, error: venueErrNear } = await adminClient
      .from('venues')
      .insert({
        name: `E2E Downtown Ballroom ${timestamp}`,
        normalized_name: `e2e downtown ballroom ${timestamp}`,
        city: 'Denver',
        region: 'CO',
        country_code: 'US',
        lat: 39.75,
        lng: -104.99,
        timezone: 'America/Denver',
      })
      .select('id')
      .single();
    if (venueErrNear || !venueRowNear) {
      throw new Error(`Failed to seed Venue Near: ${venueErrNear?.message}`);
    }
    testVenueIdNear = venueRowNear.id;

    // 4. Seed Event A: Favorite Artist, Farther away, Expensive ($120)
    const futureDateA = new Date(Date.now() + 20 * 86400 * 1000)
      .toISOString()
      .split('T')[0];

    const { data: eventRowA, error: eventErrA } = await adminClient
      .from('events')
      .insert({
        name: `E2E Concert A: Favorite in Springs ${timestamp}`,
        normalized_name: `e2e concert a: favorite in springs ${timestamp}`,
        event_kind: 'concert',
        status: 'scheduled',
        venue_id: testVenueIdFar,
        city: 'Colorado Springs',
        region: 'CO',
        country_code: 'US',
        lat: 38.83,
        lng: -104.82,
        timezone: 'America/Denver',
        local_start_date: futureDateA,
        starts_at: `${futureDateA}T20:00:00-07:00`,
        start_time_precision: 'instant',
        is_multi_day: false,
      })
      .select('id')
      .single();
    if (eventErrA || !eventRowA) {
      throw new Error(`Failed to seed Event A: ${eventErrA?.message}`);
    }
    testEventIdA = eventRowA.id;

    await adminClient.from('event_artists').insert({
      event_id: testEventIdA,
      artist_id: testArtistIdA,
      billing_position: 'headliner',
      sort_order: 1,
    });

    await adminClient.from('event_ticket_links').insert({
      event_id: testEventIdA,
      url: 'https://tickets.example.com/e2e-show-a',
      normalized_url: 'https://tickets.example.com/e2e-show-a',
      min_price: 120,
      max_price: 150,
      currency: 'USD',
      inventory_status: 'available',
    });

    // 5. Seed Event B: Interested Artist, Nearby (0 mi), Affordable ($25)
    const futureDateB = new Date(Date.now() + 21 * 86400 * 1000)
      .toISOString()
      .split('T')[0];

    const { data: eventRowB, error: eventErrB } = await adminClient
      .from('events')
      .insert({
        name: `E2E Concert B: Local in Denver ${timestamp}`,
        normalized_name: `e2e concert b: local in denver ${timestamp}`,
        event_kind: 'concert',
        status: 'scheduled',
        venue_id: testVenueIdNear,
        city: 'Denver',
        region: 'CO',
        country_code: 'US',
        lat: 39.75,
        lng: -104.99,
        timezone: 'America/Denver',
        local_start_date: futureDateB,
        starts_at: `${futureDateB}T20:00:00-07:00`,
        start_time_precision: 'instant',
        is_multi_day: false,
      })
      .select('id')
      .single();
    if (eventErrB || !eventRowB) {
      throw new Error(`Failed to seed Event B: ${eventErrB?.message}`);
    }
    testEventIdB = eventRowB.id;

    await adminClient.from('event_artists').insert({
      event_id: testEventIdB,
      artist_id: testArtistIdB,
      billing_position: 'headliner',
      sort_order: 1,
    });

    await adminClient.from('event_ticket_links').insert({
      event_id: testEventIdB,
      url: 'https://tickets.example.com/e2e-show-b',
      normalized_url: 'https://tickets.example.com/e2e-show-b',
      min_price: 25,
      max_price: 35,
      currency: 'USD',
      inventory_status: 'available',
    });

    // 6. Seed preferences: Artist A = Favorite, Artist B = Interested
    await adminClient.from('user_artist_preferences').insert([
      {
        user_id: testUserId,
        artist_id: testArtistIdA,
        artist_name: `E2E Favorite Star ${timestamp}`,
        normalized_artist_name: `e2e favorite star ${timestamp}`,
        preference_level: 'favorite',
      },
      {
        user_id: testUserId,
        artist_id: testArtistIdB,
        artist_name: `E2E Local Opener ${timestamp}`,
        normalized_artist_name: `e2e local opener ${timestamp}`,
        preference_level: 'interested',
      },
    ]);
  });

  test.afterAll(async () => {
    if (adminClient) {
      const eventIds = [testEventIdA, testEventIdB].filter(Boolean) as string[];
      if (eventIds.length > 0) {
        await adminClient
          .from('event_ticket_links')
          .delete()
          .in('event_id', eventIds);
        await adminClient
          .from('event_artists')
          .delete()
          .in('event_id', eventIds);
        await adminClient.from('events').delete().in('id', eventIds);
      }
      const venueIds = [testVenueIdFar, testVenueIdNear].filter(
        Boolean,
      ) as string[];
      if (venueIds.length > 0) {
        await adminClient.from('venues').delete().in('id', venueIds);
      }
      const artistIds = [testArtistIdA, testArtistIdB].filter(
        Boolean,
      ) as string[];
      if (artistIds.length > 0) {
        await adminClient.from('artists').delete().in('id', artistIds);
      }
      if (testUserId) {
        await adminClient
          .from('user_artist_preferences')
          .delete()
          .eq('user_id', testUserId);
        await adminClient.from('profiles').delete().eq('id', testUserId);
        await adminClient.auth.admin.deleteUser(testUserId);
      }
    }
  });

  test('Guest Flow: unauthenticated visitor views public discover with personalization callout', async ({
    page,
  }) => {
    if (!credentials || !isDbAvailable) {
      if (process.env.CI) {
        throw new Error(
          `Local Supabase is not available at ${credentials?.url ?? 'unknown'} in CI. Guest browser tests must execute against live local database.`,
        );
      }
      test.skip(
        true,
        'Local Supabase is offline. Skipping guest discover E2E browser test locally.',
      );
      return;
    }

    await page.goto('/discover');

    // Verify main header
    await expect(
      page.getByRole('heading', { name: 'Discover Live Music' }),
    ).toBeVisible();

    // Verify guest personalization banner is present
    const banner = page.getByTestId('guest-personalization-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Make These Recommendations Yours');

    // Verify sign in CTA links to login
    const signInCta = banner.getByRole('link', { name: /sign in/i });
    await expect(signInCta).toBeVisible();
    await expect(signInCta).toHaveAttribute('href', '/login');

    // Confirm public events appear under real guest session
    await expect(
      page.getByText(`E2E Concert A: Favorite in Springs ${timestamp}`),
    ).toBeVisible();
    await expect(
      page.getByText(`E2E Concert B: Local in Denver ${timestamp}`),
    ).toBeVisible();

    // Verify absence of personal score badges on public cards
    await expect(page.getByTestId('event-score')).toHaveCount(0);
    await expect(page.getByTestId('why-this-show-button')).toHaveCount(0);
  });

  test('Authenticated Flow: user customizes preset, views why drawer, and settings persist across reload', async ({
    page,
  }) => {
    if (
      !credentials ||
      !isDbAvailable ||
      !testUserId ||
      !testArtistIdA ||
      !testArtistIdB ||
      !testEventIdA ||
      !testEventIdB
    ) {
      if (process.env.CI) {
        throw new Error(
          `Local Supabase is not available at ${credentials?.url ?? 'unknown'} in CI. Authenticated browser tests must execute against live local database.`,
        );
      }
      test.skip(
        true,
        'Local Supabase is offline. Skipping authenticated discover E2E browser test locally.',
      );
      return;
    }

    // 1. Sign in via /login
    await page.goto('/login?redirectTo=/discover');
    await expect(page.getByTestId('login-container')).toBeVisible();

    await page.getByTestId('email-input').fill(testEmail);
    await page.getByTestId('password-input').fill(testPassword);
    await page.getByTestId('auth-submit-btn').click();

    // 2. Wait for navigation to /discover
    await expect(page).toHaveURL(/\/discover/);

    // 3. Confirm discover controls toolbar is visible
    await expect(page.getByTestId('discover-controls')).toBeVisible();

    // 4. Confirm initial active preset is 'artist_first' as configured in user profile
    const artistPresetBtn = page.getByTestId('preset-artist-first');
    const nearbyPresetBtn = page.getByTestId('preset-nearby');
    await expect(artistPresetBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(nearbyPresetBtn).toHaveAttribute('aria-pressed', 'false');

    // 5. Mathematical Proof of Preset Impact — Step 1: Under Artist-First Preset
    // Event A (Favorite artist: 100 * 0.65 = 65) mathematically outscores
    // Event B (Interested artist: 55 * 0.65 = 35.75) despite Event B being closer and cheaper.
    const allCards = page.getByTestId('personalized-event-card');
    await expect(allCards).toHaveCount(2);

    // Event A MUST be ranked #1
    await expect(allCards.nth(0)).toContainText(
      `E2E Concert A: Favorite in Springs ${timestamp}`,
    );
    // Event B MUST be ranked #2
    await expect(allCards.nth(1)).toContainText(
      `E2E Concert B: Local in Denver ${timestamp}`,
    );

    const scoreBadgeA = allCards.nth(0).getByTestId('event-score');
    const scoreBadgeB = allCards.nth(1).getByTestId('event-score');
    const scoreTextA = await scoreBadgeA.innerText();
    const scoreTextB = await scoreBadgeB.innerText();
    const numScoreA = parseInt(scoreTextA, 10);
    const numScoreB = parseInt(scoreTextB, 10);
    expect(numScoreA).toBeGreaterThan(numScoreB);

    // 6. Factor breakdown drawer on Rank #1 Event A
    const whyBtnA = allCards.nth(0).getByTestId('why-this-show-button');
    await whyBtnA.click();
    const factorBreakdownA = allCards.nth(0).getByTestId('factor-breakdown');
    await expect(factorBreakdownA).toBeVisible();
    await expect(factorBreakdownA).toContainText('Artist Interest');
    await expect(factorBreakdownA).toContainText('Travel Practicality');
    await expect(factorBreakdownA).toContainText('Ticket Affordability');
    await expect(factorBreakdownA).toContainText('Timing Suitability');
    // Close drawer
    await whyBtnA.click();
    await expect(factorBreakdownA).not.toBeVisible();

    // 7. Mathematical Proof of Preset Impact — Step 2: Switch to Nearby Preset
    // Under Nearby preset (Distance 35%, Artist 40%), Event B's 0-mi Denver advantage
    // outscores Event A's 65-mi distance penalty. The ranking MUST invert.
    await nearbyPresetBtn.click();
    await expect(nearbyPresetBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(artistPresetBtn).toHaveAttribute('aria-pressed', 'false');

    // Event B MUST now be ranked #1
    await expect(allCards.nth(0)).toContainText(
      `E2E Concert B: Local in Denver ${timestamp}`,
    );
    // Event A MUST now be ranked #2
    await expect(allCards.nth(1)).toContainText(
      `E2E Concert A: Favorite in Springs ${timestamp}`,
    );

    const newScoreTextB = await allCards
      .nth(0)
      .getByTestId('event-score')
      .innerText();
    const newScoreTextA = await allCards
      .nth(1)
      .getByTestId('event-score')
      .innerText();
    const newNumScoreB = parseInt(newScoreTextB, 10);
    const newNumScoreA = parseInt(newScoreTextA, 10);
    expect(newNumScoreB).toBeGreaterThan(newNumScoreA);

    // Factor breakdown on Rank #1 Event B under Nearby preset
    const whyBtnB = allCards.nth(0).getByTestId('why-this-show-button');
    await whyBtnB.click();
    const factorBreakdownB = allCards.nth(0).getByTestId('factor-breakdown');
    await expect(factorBreakdownB).toBeVisible();
    await expect(factorBreakdownB).toContainText('Travel Practicality');
    await whyBtnB.click();
    await expect(factorBreakdownB).not.toBeVisible();

    // 8. Update travel radius and typical budget
    const radiusSelector = page.getByTestId('radius-selector');
    const radius50Btn = radiusSelector.getByRole('button', { name: '50 mi' });
    await radius50Btn.click();
    await expect(radius50Btn).toHaveAttribute('aria-pressed', 'true');

    const budgetSelector = page.getByTestId('budget-selector');
    const budget80Btn = budgetSelector.getByRole('button', { name: '$80' });
    await budget80Btn.click();
    await expect(budget80Btn).toHaveAttribute('aria-pressed', 'true');

    // 9. Reload page to verify persistence across page reload
    await page.reload();
    await expect(page.getByTestId('discover-controls')).toBeVisible();

    const reloadedNearbyBtn = page.getByTestId('preset-nearby');
    await expect(reloadedNearbyBtn).toHaveAttribute('aria-pressed', 'true');

    // Event B remains #1 after reload
    await expect(allCards.nth(0)).toContainText(
      `E2E Concert B: Local in Denver ${timestamp}`,
    );

    const reloadedRadius50Btn = page
      .getByTestId('radius-selector')
      .getByRole('button', { name: '50 mi' });
    await expect(reloadedRadius50Btn).toHaveAttribute('aria-pressed', 'true');

    const reloadedBudget80Btn = page
      .getByTestId('budget-selector')
      .getByRole('button', { name: '$80' });
    await expect(reloadedBudget80Btn).toHaveAttribute('aria-pressed', 'true');

    // 10. Test search filter and clearing search after settings change
    const searchInput = page.getByTestId('search-input');
    await searchInput.fill('Favorite in Springs');
    await expect(
      page.getByText(`E2E Concert A: Favorite in Springs ${timestamp}`),
    ).toBeVisible();
    await expect(
      page.getByText(`E2E Concert B: Local in Denver ${timestamp}`),
    ).not.toBeVisible();

    // Search for nonexistent string: shows empty-filtered-banner
    await searchInput.fill('NonexistentQuery999');
    await expect(page.getByTestId('empty-filtered-banner')).toBeVisible();

    // Clear search filter: both events restored with Event B remaining #1
    await searchInput.fill('');
    await expect(allCards.nth(0)).toContainText(
      `E2E Concert B: Local in Denver ${timestamp}`,
    );
    await expect(allCards.nth(1)).toContainText(
      `E2E Concert A: Favorite in Springs ${timestamp}`,
    );
  });
});
