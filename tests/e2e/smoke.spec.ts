import { expect, test } from '@playwright/test';

test.describe('Application Smoke Tests', () => {
  test('successfully loads the landing page and displays Encore Index navigation and feed', async ({
    page,
  }) => {
    const response = await page.goto('/');

    // Check HTTP status
    expect(response?.status()).toBe(200);

    // Verify Encore Index branding
    await expect(page.getByRole('link', { name: /ENCORE/ })).toBeVisible();
    await expect(page.getByText('// INDEX')).toBeVisible();
    await expect(
      page.locator('header').getByText('Curated Live Music'),
    ).toBeVisible();

    // Verify navigation tabs
    await expect(page.getByRole('link', { name: 'Shows' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Search' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Saved/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Preferences' })).toBeVisible();

    // Verify mode selector chips
    await expect(page.getByRole('button', { name: 'All Shows' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'This Weekend' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Free ($0)' })).toBeVisible();
  });

  test('successfully loads the discover catalog page', async ({ page }) => {
    const response = await page.goto('/discover');

    expect(response?.status()).toBe(200);
    await expect(page.getByText('Discover Live Music')).toBeVisible();
    const guestContainer = page.getByText(
      'Explore upcoming concerts and events',
    );
    const errorState = page.getByText('Unable to Load Live Music Catalog');
    await expect(guestContainer.or(errorState)).toBeVisible();

    // Verify presence of either event cards or clean empty state or error state
    const emptyState = page.getByText('No upcoming events found');
    const eventCards = page.getByTestId('event-card');
    const hasEmptyState = await emptyState.isVisible();
    const hasErrorState = await errorState.isVisible();
    const cardCount = await eventCards.count();
    expect(hasEmptyState || hasErrorState || cardCount > 0).toBe(true);
  });

  test('successfully loads the project hub page', async ({ page }) => {
    const response = await page.goto('/hub');

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: 'Encore Project Hub' }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Interactive System Architecture & Operational Observatory',
      ),
    ).toBeVisible();
  });

  test('successfully loads the authentication page', async ({ page }) => {
    const response = await page.goto('/login');

    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('login-container')).toBeVisible();
    await expect(page.getByText('Welcome Back')).toBeVisible();
    await expect(page.getByTestId('email-input')).toBeVisible();
    await expect(page.getByTestId('password-input')).toBeVisible();
    await expect(page.getByTestId('auth-submit-btn')).toBeVisible();
  });

  test('successfully loads the music taste profile page as guest', async ({
    page,
  }) => {
    const response = await page.goto('/profile/taste');

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: 'Music Taste Profile' }),
    ).toBeVisible();
    await expect(page.getByTestId('guest-taste-prompt')).toBeVisible();
    await expect(page.getByText('Curate Your Live Music Taste')).toBeVisible();
    await expect(page.getByTestId('guest-signin-btn')).toBeVisible();
  });

  test('successfully follows redirect from /taste to /profile/taste', async ({
    page,
  }) => {
    await page.goto('/taste');
    expect(page.url()).toContain('/profile/taste');
    await expect(
      page.getByRole('heading', { name: 'Music Taste Profile' }),
    ).toBeVisible();
  });

  test('successfully loads the recommendation scoring preview inspector and toggles controls', async ({
    page,
  }) => {
    const response = await page.goto('/discover/scoring-preview');

    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('scoring-inspector')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Recommendation Scoring Inspector' }),
    ).toBeVisible();
    await expect(page.getByTestId('preset-switcher')).toBeVisible();
    await expect(page.getByTestId('toggle-fixtures-checkbox')).toBeVisible();

    // Verify representative fixture labeling
    await expect(page.getByTestId('synthetic-fixtures-badge')).toBeVisible();
    await expect(page.getByTestId('synthetic-fixtures-badge')).toContainText(
      'Authoritative Synthetic Fixtures (Demo)',
    );

    // Verify initial preset is Balanced
    const balancedBtn = page.getByTestId('preset-btn-balanced');
    await expect(balancedBtn).toHaveClass(/bg-indigo-600/);

    // Switch to Nearby preset and confirm active state
    const nearbyBtn = page.getByTestId('preset-btn-nearby');
    await nearbyBtn.click();
    await expect(nearbyBtn).toHaveClass(/bg-indigo-600/);
    await expect(balancedBtn).not.toHaveClass(/bg-indigo-600/);

    // Switch to Artist-First preset and confirm active state
    const artistFirstBtn = page.getByTestId('preset-btn-artist_first');
    await artistFirstBtn.click();
    await expect(artistFirstBtn).toHaveClass(/bg-indigo-600/);
    await expect(nearbyBtn).not.toHaveClass(/bg-indigo-600/);

    // Switch back to Balanced
    await balancedBtn.click();
    await expect(balancedBtn).toHaveClass(/bg-indigo-600/);
  });
});
