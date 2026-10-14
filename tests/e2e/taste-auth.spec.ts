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
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
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
        url: parsed.API_URL,
        anonKey: parsed.ANON_KEY,
        serviceRoleKey: parsed.SERVICE_ROLE_KEY,
      };
    }
  } catch {
    // Supabase CLI status not available
  }

  const defaultUrl = 'http://127.0.0.1:54321';
  const defaultAnonKey =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE2MTQ1NTIwMDAsImV4cCI6MTk3MDEwODAwMH0.09X-XbQhJ191y_bS09YmKjX8X8x8_bS09YmKjX8X8x8';
  const defaultServiceRoleKey =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTYxNDU1MjAwMCwiZXhwIjoxOTcwMTA4MDAwfQ.09X-XbQhJ191y_bS09YmKjX8X8x8_bS09YmKjX8X8x8';

  return {
    url: defaultUrl,
    anonKey: defaultAnonKey,
    serviceRoleKey: defaultServiceRoleKey,
  };
}

test.describe('Authenticated Music Taste Profile Browser E2E Flow', () => {
  const credentials = resolveSupabaseCredentials();
  let adminClient: SupabaseClient | null = null;
  let isDbAvailable = false;

  let testUserId: string | null = null;
  const timestamp = Date.now();
  const testEmail = `e2e_taste_${timestamp}@encore.test`;
  const testPassword = 'Password123!SecureE2E';

  test.beforeAll(async () => {
    if (!credentials) {
      if (process.env.CI) {
        throw new Error('Supabase credentials could not be resolved in CI.');
      }
      return;
    }

    assertSafeDatabaseTarget(
      credentials.url,
      false,
      'Authenticated Taste Profile E2E test',
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
      console.warn(
        `Local Supabase stack is not responding at ${credentials.url}. Skipping authenticated taste profile E2E browser test.`,
      );
      return;
    }

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

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
  });

  test.afterAll(async () => {
    if (adminClient && testUserId) {
      await adminClient
        .from('user_artist_preferences')
        .delete()
        .eq('user_id', testUserId);
      await adminClient.auth.admin.deleteUser(testUserId);
    }
  });

  test('executes complete taste profile lifecycle: sign in, save preference, reload verify, update level, delete, sign out, and verify guest isolation', async ({
    page,
  }) => {
    test.skip(
      !isDbAvailable,
      'Local Supabase is offline. Skipping authenticated taste profile E2E browser test.',
    );

    // 1. Visit login page with redirectTo=/profile/taste
    await page.goto('/login?redirectTo=/profile/taste');
    await expect(page.getByTestId('login-container')).toBeVisible();

    // 2. Perform sign in with isolated test user credentials
    await page.getByTestId('email-input').fill(testEmail);
    await page.getByTestId('password-input').fill(testPassword);
    await page.getByTestId('auth-submit-btn').click();

    // 3. Confirm redirected to /profile/taste and authenticated UI loaded
    await expect(page).toHaveURL(/\/profile\/taste/);
    await expect(page.getByTestId('taste-profile-manager')).toBeVisible();
    await expect(page.getByText(testEmail)).toBeVisible();

    // 4. Search and add a custom uncataloged artist
    const customArtistName = `E2E Wave Band ${timestamp}`;
    const searchInput = page.getByTestId('artist-search-input');
    await searchInput.fill(customArtistName);

    // Wait for dropdown and click add custom artist button
    const addCustomBtn = page.getByTestId('add-custom-artist-btn');
    await expect(addCustomBtn).toBeVisible();
    await addCustomBtn.click();

    // Modal/confirmation panel appears
    await expect(page.getByTestId('add-artist-dialog')).toBeVisible();
    const modalSelect = page.getByTestId('modal-pref-level-select');
    await modalSelect.selectOption('interested');
    await page.getByTestId('confirm-add-btn').click();

    // 5. Verify preference card is rendered in list with "Interested"
    await expect(page.getByText(customArtistName)).toBeVisible();
    await expect(page.getByText('Interested')).toBeVisible();

    // 6. Reload page and verify persistence across browser reloads
    await page.reload();
    await expect(page.getByTestId('taste-profile-manager')).toBeVisible();
    await expect(page.getByText(customArtistName)).toBeVisible();
    await expect(page.getByText('Interested')).toBeVisible();

    // 7. Update preference level to "favorite"
    const levelSelect = page.getByRole('combobox', {
      name: new RegExp(`Change preference level for ${customArtistName}`, 'i'),
    });
    await expect(levelSelect).toBeVisible();
    await levelSelect.selectOption('favorite');

    // Verify UI reflects update
    await expect(page.getByText('Favorite')).toBeVisible();

    // Reload again to prove level update persisted in PostgreSQL
    await page.reload();
    await expect(page.getByTestId('taste-profile-manager')).toBeVisible();
    await expect(page.getByText(customArtistName)).toBeVisible();
    await expect(page.getByText('Favorite')).toBeVisible();

    // 8. Delete preference from profile
    const deleteBtn = page.getByRole('button', {
      name: new RegExp(`Remove ${customArtistName} from preferences`, 'i'),
    });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Verify empty state is displayed
    await expect(page.getByTestId('empty-preferences-view')).toBeVisible();
    await expect(page.getByText(customArtistName)).not.toBeVisible();

    // Reload to verify deletion persistence
    await page.reload();
    await expect(page.getByTestId('empty-preferences-view')).toBeVisible();
    await expect(page.getByText(customArtistName)).not.toBeVisible();

    // 9. Sign out
    const signOutBtn = page.getByTestId('sign-out-btn');
    await expect(signOutBtn).toBeVisible();
    await signOutBtn.click();

    // Confirm redirected to /login
    await expect(page).toHaveURL(/\/login/);

    // 10. Navigate back to /profile/taste and confirm guest isolation
    await page.goto('/profile/taste');
    await expect(page.getByTestId('guest-taste-prompt')).toBeVisible();
    await expect(page.getByTestId('taste-profile-manager')).not.toBeVisible();
  });
});
