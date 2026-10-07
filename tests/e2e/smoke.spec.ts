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
  });

  test('successfully loads the project hub page', async ({ page }) => {
    const response = await page.goto('/hub');

    expect(response?.status()).toBe(200);
    await expect(page.getByText('Encore Project Hub')).toBeVisible();
    await expect(
      page.getByText(
        'Interactive System Architecture & Operational Observatory',
      ),
    ).toBeVisible();
  });
});
