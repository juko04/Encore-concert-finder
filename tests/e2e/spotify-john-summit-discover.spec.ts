import { expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import {
  seedJohnSummitFixture,
  SYNTHETIC_EVENT_TITLE,
  JOHN_SUMMIT_ARTIST_NAME,
} from '@/scripts/seed-john-summit-fixture';
import { cleanupJohnSummitFixture } from '@/scripts/cleanup-john-summit-fixture';

interface LocalCredentials {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

const TARGET_USER_ID = '7e0a5bed-fe7f-40cf-814d-72a944df7965';
const TEST_AUTH_PASSWORD = 'Password123!JohnSummitDiscover';

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

test.describe('Spotify Personalized Discover E2E — John Summit Fixture', () => {
  const credentials = resolveSupabaseCredentials();
  let adminClient: SupabaseClient | null = null;
  let isDbAvailable = false;
  let originalPreset: string | null = null;
  let targetUserEmail = process.env.SPOTIFY_TEST_USER_EMAIL || '';

  test.beforeAll(async () => {
    if (!credentials) {
      if (process.env.CI) {
        throw new Error(
          'Supabase credentials could not be resolved from environment or CLI in CI.',
        );
      }
      return;
    }

    // Invariant 6: Strict destination guard against accidental non-local writes
    assertSafeDatabaseTarget(
      credentials.url,
      false,
      'Spotify John Summit Discover E2E Test',
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
        throw new Error('Local Supabase Auth is not responding in CI.');
      }
      return;
    }

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // 1. Verify user's live Spotify connection exists in database
    const { data: connection, error: connErr } = await adminClient
      .from('user_spotify_connections')
      .select('user_id, status, spotify_account_id')
      .eq('user_id', TARGET_USER_ID)
      .maybeSingle();

    if (connErr || !connection || connection.status !== 'connected') {
      console.warn(
        `Target user ${TARGET_USER_ID} does not have an active Spotify connection in user_spotify_connections. Skipping fixture test.`,
      );
      isDbAvailable = false;
      return;
    }

    // 2. Save original profile preset and update to 'balanced' to verify standard 50/20/20/10 scoring
    const { data: profile } = await adminClient
      .from('profiles')
      .select('recommendation_preset')
      .eq('id', TARGET_USER_ID)
      .maybeSingle();

    originalPreset = profile?.recommendation_preset ?? null;

    await adminClient
      .from('profiles')
      .update({ recommendation_preset: 'balanced' })
      .eq('id', TARGET_USER_ID);

    // 3. Set known test password for authentication through Next.js /login
    const { data: userData, error: pwdErr } =
      await adminClient.auth.admin.updateUserById(TARGET_USER_ID, {
        password: TEST_AUTH_PASSWORD,
      });
    if (pwdErr) {
      throw new Error(
        `Failed to set test password for target user: ${pwdErr.message}`,
      );
    }
    if (userData?.user?.email) {
      targetUserEmail = userData.user.email;
    }

    // 4. Clear any manual preferences to test pure Spotify algorithmic attribution
    await adminClient
      .from('user_artist_preferences')
      .delete()
      .eq('user_id', TARGET_USER_ID);

    // 5. Seed John Summit synthetic fixture idempotently
    await seedJohnSummitFixture(adminClient);

    // 6. Ensure screenshots output directory exists
    const screenshotDir = path.resolve(process.cwd(), 'docs/screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test.afterAll(async () => {
    if (adminClient) {
      // 1. Restore original profile preset
      if (originalPreset) {
        await adminClient
          .from('profiles')
          .update({ recommendation_preset: originalPreset })
          .eq('id', TARGET_USER_ID);
      }

      // 2. Clean up test preferences
      await adminClient
        .from('user_artist_preferences')
        .delete()
        .eq('user_id', TARGET_USER_ID);

      // 3. Remove synthetic fixture (preserves canonical artists and venues)
      await cleanupJohnSummitFixture(adminClient);
    }
  });

  test('authenticates target user, validates personalized John Summit recommendation, verifies 60.0 score badge, asserts Spotify attribution, and captures screenshot', async ({
    page,
  }) => {
    if (!credentials || !isDbAvailable) {
      test.skip(
        true,
        'Local Supabase is offline. Skipping authenticated Spotify discover browser test.',
      );
      return;
    }

    // 1. Authenticate target user via Next.js login form
    await page.goto('/login?redirectTo=/discover');
    await expect(page.getByTestId('login-container')).toBeVisible();

    await page.getByTestId('email-input').fill(targetUserEmail);
    await page.getByTestId('password-input').fill(TEST_AUTH_PASSWORD);
    await page.getByTestId('auth-submit-btn').click();

    // 2. Wait for navigation away from /login to /discover
    await page.waitForURL((url) => url.pathname === '/discover', {
      timeout: 20000,
    });
    await expect(page).toHaveURL(/\/discover/);

    // 3. Confirm authenticated view (guest banner must NOT be present)
    await expect(
      page.getByRole('heading', { name: 'Discover Live Music' }),
    ).toBeVisible();
    await expect(page.getByTestId('guest-personalization-banner')).toHaveCount(
      0,
    );

    // 4. Assert John Summit concert card is visible in recommendations pool
    const recommendationsGrid = page.getByTestId('recommendations-grid');
    await expect(recommendationsGrid).toBeVisible({ timeout: 15000 });

    const summitCard = recommendationsGrid
      .locator('[data-testid="personalized-event-card"]')
      .filter({ hasText: SYNTHETIC_EVENT_TITLE });
    await expect(summitCard).toBeVisible();

    // 5. Assert headliner artist name rendered
    await expect(
      summitCard.getByText(JOHN_SUMMIT_ARTIST_NAME, { exact: true }),
    ).toBeVisible();

    // 6. Assert recommendation score badge (composite 60 / 100)
    const scoreBadge = summitCard.getByTestId('event-score');
    await expect(scoreBadge).toBeVisible();
    await expect(scoreBadge).toContainText('60/100');

    // 7. Assert Spotify attribution badge / headline
    const explanationBanner = summitCard.getByTestId('event-explanation');
    await expect(explanationBanner).toBeVisible();
    await expect(explanationBanner).toContainText('🎧 Spotify top artist (#1)');
    await expect(explanationBanner).toContainText(JOHN_SUMMIT_ARTIST_NAME);

    // 8. Expand "Why this show?" explanation drawer and verify factor breakdown
    const whyButton = summitCard.getByTestId('why-this-show-button');
    await expect(whyButton).toBeVisible();
    await whyButton.click();

    // Verify factor details inside drawer
    const factorBreakdown = summitCard.getByTestId('factor-breakdown');
    await expect(factorBreakdown).toBeVisible();
    await expect(factorBreakdown).toContainText(
      'Spotify top artist (#1 in your listening history)',
    );
    await expect(factorBreakdown).toContainText('+35 pts');

    // 9. Capture screenshot to docs/screenshots/john-summit-discover-personalized.png
    const screenshotPath = path.resolve(
      process.cwd(),
      'docs/screenshots/john-summit-discover-personalized.png',
    );
    await page.screenshot({
      path: screenshotPath,
      fullPage: false,
    });
    expect(fs.existsSync(screenshotPath)).toBe(true);

    // Also capture focused component card screenshot
    const cardScreenshotPath = path.resolve(
      process.cwd(),
      'docs/screenshots/john-summit-card-detail.png',
    );
    await summitCard.screenshot({
      path: cardScreenshotPath,
    });
    expect(fs.existsSync(cardScreenshotPath)).toBe(true);

    // 10. Test reload to verify state persistence across page reloads
    await page.reload();
    await page.waitForURL((url) => url.pathname === '/discover', {
      timeout: 20000,
    });
    await expect(page).toHaveURL(/\/discover/);

    // Confirm authenticated session preserved after reload
    await expect(page.getByTestId('guest-personalization-banner')).toHaveCount(
      0,
    );

    // Confirm John Summit event card persists with matching score and attribution
    const reloadedGrid = page.getByTestId('recommendations-grid');
    await expect(reloadedGrid).toBeVisible();

    const reloadedSummitCard = reloadedGrid
      .locator('[data-testid="personalized-event-card"]')
      .filter({ hasText: SYNTHETIC_EVENT_TITLE });
    await expect(reloadedSummitCard).toBeVisible();

    const reloadedScoreBadge = reloadedSummitCard.getByTestId('event-score');
    await expect(reloadedScoreBadge).toContainText('60/100');

    const reloadedExplanation =
      reloadedSummitCard.getByTestId('event-explanation');
    await expect(reloadedExplanation).toContainText(
      '🎧 Spotify top artist (#1)',
    );
  });
});
