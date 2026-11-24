import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test.describe('Encore V2 Index E2E Flow', () => {
  test.beforeAll(() => {
    const screenshotDir = path.resolve(process.cwd(), 'docs/screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('Index Home: loads Discover hero and rows, search form routes to /search', async ({
    page,
  }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);

    // Verify header branding
    await expect(page.getByRole('link', { name: /ENCORE/ })).toBeVisible();
    await expect(page.getByText('// INDEX')).toBeVisible();

    // Discover hero with prominent search
    await expect(
      page.getByRole('heading', { level: 1, name: /live music worth/i }),
    ).toBeVisible();
    const searchInput = page.getByPlaceholder(
      /Search by artist, headliner, venue, city, or genre/i,
    );
    await expect(searchInput).toBeVisible();

    // Capture screenshot
    await page.screenshot({
      path: 'docs/screenshots/encore-v2-index-home.png',
      fullPage: false,
    });

    // Submitting the hero search lands on /search with the query applied
    await searchInput.fill('Denver');
    await searchInput.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=Denver/);
  });

  test('Index Search: navigates to /search, inputs keyword, applies filters', async ({
    page,
  }) => {
    const response = await page.goto('/search');
    expect(response?.status()).toBe(200);

    // Verify search page elements
    const searchInput = page.getByPlaceholder(
      /Search by artist, headliner, venue, city, or genre/i,
    );
    await expect(searchInput).toBeVisible();

    // Verify grid / list layout toggle buttons live on the search page
    const gridBtn = page.getByRole('button', { name: 'Grid layout' });
    const listBtn = page.getByRole('button', { name: 'List layout' });
    await expect(gridBtn).toBeVisible();
    await expect(listBtn).toBeVisible();
    await listBtn.click();
    await page.waitForTimeout(300);

    await searchInput.fill('Denver');
    await page.waitForTimeout(400);

    // Capture screenshot
    await page.screenshot({
      path: 'docs/screenshots/encore-v2-index-search.png',
      fullPage: false,
    });
  });

  test('Index Saved: navigates to /saved, verifies watchlist and alert tabs', async ({
    page,
  }) => {
    const response = await page.goto('/saved');
    expect(response?.status()).toBe(200);

    await expect(
      page.getByRole('heading', { name: /Saved Shows & Alert Bookmarks/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Saved Shows/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Alert Bookmarks/i }),
    ).toBeVisible();

    // Capture screenshot
    await page.screenshot({
      path: 'docs/screenshots/encore-v2-index-saved.png',
      fullPage: false,
    });
  });

  test('Index Preferences: navigates to /preferences, verifies taste and Spotify card', async ({
    page,
  }) => {
    const response = await page.goto('/preferences');
    expect(response?.status()).toBe(200);

    await expect(
      page.getByRole('heading', { name: /Music Taste Profile/i }),
    ).toBeVisible();
    await expect(page.getByText('Connect Spotify')).toBeVisible();

    // Capture screenshot
    await page.screenshot({
      path: 'docs/screenshots/encore-v2-index-preferences.png',
      fullPage: false,
    });
  });
});
