import { expect, test } from '@playwright/test';

test.describe('Landing Page Smoke Test', () => {
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

  test('successfully loads the discover page and displays header', async ({
    page,
  }) => {
    const response = await page.goto('/discover');
    expect(response?.status()).toBe(200);

    const heading = page.getByRole('heading', { name: 'Discover Live Music' });
    await expect(heading).toBeVisible();
  });
});
