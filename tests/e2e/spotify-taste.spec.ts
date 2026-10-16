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

test.describe('Spotify Taste Explorer & Preview E2E Flow', () => {
  const credentials = resolveSupabaseCredentials();
  let adminClient: SupabaseClient | null = null;
  let isDbAvailable = false;

  let testUserId: string | null = null;
  const timestamp = Date.now();
  const testEmail = `e2e_spotify_${timestamp}@encore.test`;
  const testPassword = 'Password123!SecureSpotify';

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
      'Authenticated Spotify Taste E2E test',
    );

    try {
      const response = await fetch(`${credentials.url}/auth/v1/health`, {
        headers: { apikey: credentials.anonKey },
      });
      if (!response.ok) {
        if (process.env.CI) {
          throw new Error('Local Supabase Auth is not responding in CI.');
        }
        return;
      }
    } catch (err) {
      if (process.env.CI) {
        throw new Error(
          `Local Supabase health check failed in CI: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: createdUser, error: createError } =
      await adminClient.auth.admin.createUser({
        email: testEmail,
        password: testPassword,
        email_confirm: true,
      });

    if (createError || !createdUser.user) {
      throw new Error(`Failed to create test user: ${createError?.message}`);
    }

    testUserId = createdUser.user.id;
    isDbAvailable = true;
  });

  test.afterAll(async () => {
    if (adminClient && testUserId) {
      try {
        await adminClient
          .from('user_spotify_connections')
          .delete()
          .eq('user_id', testUserId);
        await adminClient
          .from('user_artist_preferences')
          .delete()
          .eq('user_id', testUserId);
        await adminClient.auth.admin.deleteUser(testUserId);
      } catch (err) {
        console.warn('Failed to clean up test user in afterAll:', err);
      }
    }
  });

  test('signs in, explores Spotify preview mode, and intentionally imports top artist into preferences', async ({
    page,
  }) => {
    if (!credentials || !isDbAvailable) {
      if (process.env.CI) {
        throw new Error(
          `Local Supabase is not available at ${credentials?.url ?? 'unknown'} in CI. Authenticated browser tests must execute against live local database.`,
        );
      }
      test.skip(
        true,
        'Local Supabase is offline. Skipping authenticated Spotify taste profile E2E browser test locally.',
      );
    }

    // 1. Sign in
    await page.goto('/login?redirectTo=/profile/taste');
    await expect(page.getByTestId('login-container')).toBeVisible();

    await page.getByTestId('email-input').fill(testEmail);
    await page.getByTestId('password-input').fill(testPassword);
    await page.getByTestId('auth-submit-btn').click();

    await expect(page).toHaveURL(/\/profile\/taste/);
    await expect(page.getByTestId('taste-profile-manager')).toBeVisible();

    // 2. Verify Spotify connection card
    const spotifyCard = page.locator('[data-testid="spotify-connection-card"]');
    await expect(spotifyCard).toBeVisible();
    await expect(
      page.locator('[data-testid="connect-spotify-btn"]'),
    ).toBeVisible();

    // 3. Open Interactive Preview mode
    const previewToggleBtn = page.locator(
      '[data-testid="toggle-preview-mode-btn"]',
    );
    await expect(previewToggleBtn).toBeVisible();
    await previewToggleBtn.click();

    // 4. Verify preview mode elements
    const previewContainer = page.locator(
      '[data-testid="spotify-taste-preview"]',
    );
    await expect(previewContainer).toBeVisible();

    const recencyBanner = page.locator(
      '[data-testid="recency-hypothesis-banner"]',
    );
    await expect(recencyBanner).toBeVisible();
    await expect(recencyBanner).toContainText(
      'Recency-Weighted Taste Hypothesis',
    );

    // 5. Test time horizon tabs
    const mediumTab = page.locator('[data-testid="tab-medium-term"]');
    await mediumTab.click();
    await expect(mediumTab).toHaveClass(/bg-zinc-800/);

    const shortTab = page.locator('[data-testid="tab-short-term"]');
    await shortTab.click();
    await expect(shortTab).toHaveClass(/bg-zinc-800/);

    // 6. Locate rising artist (Chappell Roan) and import to concert preferences
    const artistRow = page.locator(
      '[data-testid="spotify-artist-row-synth-chappell-roan"]',
    );
    await expect(artistRow).toBeVisible();
    await expect(artistRow).toContainText('Chappell Roan');
    await expect(
      artistRow.locator('[data-testid="trend-badge-rising"]'),
    ).toBeVisible();

    const importBtn = page.locator(
      '[data-testid="import-artist-btn-synth-chappell-roan"]',
    );
    await importBtn.click();

    const confirmImportBtn = page.locator(
      '[data-testid="confirm-import-btn-synth-chappell-roan"]',
    );
    await confirmImportBtn.click();

    // 7. Verify artist now shows as Favorite badge in Spotify preview list
    await expect(
      page.locator('[data-testid="already-saved-badge-synth-chappell-roan"]'),
    ).toContainText('★ Favorite');

    // 8. Verify artist is also displayed in user's manual concert preferences during demo session
    const prefCard = page.locator('[data-testid^="preference-card-"]').first();
    await expect(prefCard).toBeVisible();
    await expect(prefCard).toContainText('Chappell Roan');

    // 9. Reload page and confirm synthetic demo was strictly isolated (NOT persisted to PostgreSQL database)
    await page.reload();
    await expect(page).toHaveURL(/\/profile\/taste/);
    await expect(page.getByTestId('taste-profile-manager')).toBeVisible();
    await expect(page.getByTestId('empty-preferences-view')).toBeVisible();
    await expect(page.locator('[data-testid^="preference-card-"]')).toHaveCount(
      0,
    );

    // 10. Verify OAuth banner handling (e.g. account_conflict error banner)
    await page.goto('/profile/taste?spotify_error=account_conflict');
    await expect(page.getByTestId('spotify-status-banner')).toBeVisible();
    await expect(page.getByTestId('spotify-status-banner')).toContainText(
      'already linked to another Encore account',
    );
  });
});
