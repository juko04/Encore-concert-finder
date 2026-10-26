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
  let testArtistId: string | null = null;
  let testVenueId: string | null = null;
  let testEventId: string | null = null;

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

    // Create isolated test user
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

    // Seed test artist
    const { data: artistRow, error: artistErr } = await adminClient
      .from('artists')
      .insert({
        name: `E2E Headliner ${timestamp}`,
        normalized_name: `e2e headliner ${timestamp}`,
      })
      .select('id')
      .single();
    if (artistErr || !artistRow) {
      throw new Error(`Failed to seed artist: ${artistErr?.message}`);
    }
    testArtistId = artistRow.id;

    // Seed test venue
    const { data: venueRow, error: venueErr } = await adminClient
      .from('venues')
      .insert({
        name: `E2E Ballroom ${timestamp}`,
        normalized_name: `e2e ballroom ${timestamp}`,
        city: 'Denver',
        region: 'CO',
        country_code: 'US',
        lat: 39.75,
        lng: -104.99,
        timezone: 'America/Denver',
      })
      .select('id')
      .single();
    if (venueErr || !venueRow) {
      throw new Error(`Failed to seed venue: ${venueErr?.message}`);
    }
    testVenueId = venueRow.id;

    // Seed test event (in the future relative to execution date)
    const futureDate = new Date(Date.now() + 30 * 86400 * 1000)
      .toISOString()
      .split('T')[0];

    const { data: eventRow, error: eventErr } = await adminClient
      .from('events')
      .insert({
        name: `E2E Headliner Live at E2E Ballroom`,
        normalized_name: `e2e headliner live at e2e ballroom`,
        event_kind: 'concert',
        status: 'scheduled',
        venue_id: testVenueId,
        city: 'Denver',
        region: 'CO',
        country_code: 'US',
        lat: 39.75,
        lng: -104.99,
        timezone: 'America/Denver',
        local_start_date: futureDate,
        starts_at: `${futureDate}T20:00:00-07:00`,
        start_time_precision: 'instant',
        is_multi_day: false,
      })
      .select('id')
      .single();
    if (eventErr || !eventRow) {
      throw new Error(`Failed to seed event: ${eventErr?.message}`);
    }
    testEventId = eventRow.id;

    // Link event to artist
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

    // Add ticket link
    const { error: ticketLinkErr } = await adminClient
      .from('event_ticket_links')
      .insert({
        event_id: testEventId,
        url: 'https://tickets.example.com/e2e-show',
        normalized_url: 'https://tickets.example.com/e2e-show',
        min_price: 50,
        max_price: 75,
        currency: 'USD',
        inventory_status: 'available',
      });
    if (ticketLinkErr) {
      throw new Error(`Failed to seed ticket link: ${ticketLinkErr?.message}`);
    }

    // Seed user preference for testUserId so recommendation cards are rendered
    const { error: prefErr } = await adminClient
      .from('user_artist_preferences')
      .insert({
        user_id: testUserId,
        artist_id: testArtistId,
        artist_name: `E2E Headliner ${timestamp}`,
        normalized_artist_name: `e2e headliner ${timestamp}`,
        preference_level: 'favorite',
      });
    if (prefErr) {
      throw new Error(`Failed to seed user preference: ${prefErr?.message}`);
    }
  });

  test.afterAll(async () => {
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

    // Confirm the public event itself appears under real guest session
    await expect(
      page.getByText('E2E Headliner Live at E2E Ballroom'),
    ).toBeVisible();
    await expect(page.getByText('E2E Ballroom')).toBeVisible();

    // Verify absence of personal score badge on public cards
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
      !testArtistId ||
      !testEventId
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

    // 4. Confirm default active preset has aria-pressed="true"
    const balancedBtn = page.getByTestId('preset-balanced');
    const artistPresetBtn = page.getByTestId('preset-artist-first');
    await expect(balancedBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(artistPresetBtn).toHaveAttribute('aria-pressed', 'false');

    // 5. Mandatory assertion: Seeded favorite artist event MUST appear in recommendations
    await expect(
      page.getByText('E2E Headliner Live at E2E Ballroom'),
    ).toBeVisible();
    await expect(page.getByText('E2E Ballroom')).toBeVisible();

    // Capture initial score under Balanced preset
    const scoreBadge = page.getByTestId('event-score').first();
    await expect(scoreBadge).toBeVisible();
    const initialScoreText = await scoreBadge.innerText();
    expect(initialScoreText).toMatch(/\d+\/100/);
    expect(initialScoreText).not.toContain('%');

    // 6. Mandatory assertion: "Why this show?" drawer opens with complete factor breakdown
    const whyBtn = page.getByTestId('why-this-show-button').first();
    await expect(whyBtn).toBeVisible();
    await whyBtn.click();

    const factorBreakdown = page.getByTestId('factor-breakdown').first();
    await expect(factorBreakdown).toBeVisible();
    await expect(factorBreakdown).toContainText('Artist Interest');
    await expect(factorBreakdown).toContainText('Travel Practicality');
    await expect(factorBreakdown).toContainText('Ticket Affordability');
    await expect(factorBreakdown).toContainText('Timing Suitability');

    // Close drawer
    await whyBtn.click();
    await expect(factorBreakdown).not.toBeVisible();

    // 7. Click "Artists" preset and verify active state updates
    await artistPresetBtn.click();
    await expect(artistPresetBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(balancedBtn).toHaveAttribute('aria-pressed', 'false');

    // 8. Update travel radius and typical budget
    const radiusSelector = page.getByTestId('radius-selector');
    const radius50Btn = radiusSelector.getByRole('button', { name: '50 mi' });
    await radius50Btn.click();
    await expect(radius50Btn).toHaveAttribute('aria-pressed', 'true');

    const budgetSelector = page.getByTestId('budget-selector');
    const budget75Btn = budgetSelector.getByRole('button', { name: '$75' });
    await budget75Btn.click();
    await expect(budget75Btn).toHaveAttribute('aria-pressed', 'true');

    // 9. Reload page to verify persistence across page reload
    await page.reload();
    await expect(page.getByTestId('discover-controls')).toBeVisible();

    const reloadedArtistBtn = page.getByTestId('preset-artist-first');
    await expect(reloadedArtistBtn).toHaveAttribute('aria-pressed', 'true');

    const reloadedRadius50Btn = page
      .getByTestId('radius-selector')
      .getByRole('button', { name: '50 mi' });
    await expect(reloadedRadius50Btn).toHaveAttribute('aria-pressed', 'true');

    const reloadedBudget75Btn = page
      .getByTestId('budget-selector')
      .getByRole('button', { name: '$75' });
    await expect(reloadedBudget75Btn).toHaveAttribute('aria-pressed', 'true');

    // 10. Test search filter and clearing search after settings change
    const searchInput = page.getByTestId('search-input');
    await searchInput.fill('E2E Headliner');
    await expect(
      page.getByText('E2E Headliner Live at E2E Ballroom'),
    ).toBeVisible();

    // Search for nonexistent string: shows empty-filtered-banner
    await searchInput.fill('NonexistentQuery999');
    await expect(page.getByTestId('empty-filtered-banner')).toBeVisible();

    // Clear search filter: seeded event is restored
    await searchInput.fill('');
    await expect(
      page.getByText('E2E Headliner Live at E2E Ballroom'),
    ).toBeVisible();
  });
});
