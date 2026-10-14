import { expect, test } from '@playwright/test';

test.describe('Application Smoke Tests', () => {
  test('successfully loads the landing page and displays title and status', async ({
    page,
  }) => {
    const response = await page.goto('/');

    // Check HTTP status
    expect(response?.status()).toBe(200);

    // Verify main landing title
    const heading = page.getByTestId('landing-title');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('Encore');
    await expect(heading).toContainText('Concert Finder');

    // Verify PWA Shell and Foundations badge
    await expect(page.getByText('Phase 0: Foundations')).toBeVisible();
    await expect(page.getByText('PWA Shell')).toBeVisible();

    // Verify system foundation section
    await expect(page.getByText('System Foundation Status')).toBeVisible();
  });

  test('successfully loads the discover catalog page', async ({ page }) => {
    const response = await page.goto('/discover');

    expect(response?.status()).toBe(200);
    await expect(page.getByText('Discover Live Music')).toBeVisible();
    await expect(
      page.getByText('Explore upcoming concerts and events'),
    ).toBeVisible();

    // Verify presence of either event cards or clean empty state
    const emptyState = page.getByText('No upcoming events found');
    const eventCards = page.getByTestId('event-card');
    const hasEmptyState = await emptyState.isVisible();
    const cardCount = await eventCards.count();
    expect(hasEmptyState || cardCount > 0).toBe(true);
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
});
