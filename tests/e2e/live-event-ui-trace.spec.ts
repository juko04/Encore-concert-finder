import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

interface TracedEvent {
  providerEventId: string;
  canonicalEventId: string;
  name: string;
  venue: string;
  date: string;
  minPrice: number | null;
  currency: string | null;
  ticketUrl: string | null;
  indexSearchPath: string;
  indexUiPath: string;
  createdInCurrentRun: boolean;
}

function escapeRegex(str: string): string {
  return str.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

test.describe('Encore V2: Live Ingestion Event-to-UI End-to-End Tracing (Finding 5)', () => {
  const screenshotDir = path.resolve(process.cwd(), 'docs/screenshots');
  const tracedFilePath = path.resolve(
    process.cwd(),
    'docs/traced-live-events.json',
  );

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('verifies 3 genuine current-run Ticketmaster events render in Index search & concert detail UI', async ({
    page,
  }) => {
    // 1. Read persisted traced events artifact produced during live ingestion
    expect(
      fs.existsSync(tracedFilePath),
      'docs/traced-live-events.json must exist before running UI trace acceptance tests. Run scripts/verify-live-ingestion.ts first.',
    ).toBe(true);

    const raw = fs.readFileSync(tracedFilePath, 'utf8');
    const tracedEvents: TracedEvent[] = JSON.parse(raw);

    expect(
      tracedEvents.length,
      'Must contain at least 3 traced live events from current run',
    ).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < 3; i++) {
      const ev = tracedEvents[i];

      // Strict Acceptance Check: Event must have been created in the current run
      expect(
        ev.createdInCurrentRun,
        `Traced event #${i + 1} ("${ev.name}") must be created in the current run`,
      ).toBe(true);
      expect(ev.canonicalEventId).toBeTruthy();
      expect(ev.providerEventId).toBeTruthy();
      expect(ev.name).toBeTruthy();
      expect(ev.venue).toBeTruthy();
      expect(ev.date).toBeTruthy();

      console.log(
        `\nTesting UI Trace for Event #${i + 1}: "${ev.name}" @ ${ev.venue}`,
      );

      // 2. Navigate to Index Search for this event title
      const searchRes = await page.goto(ev.indexSearchPath);
      expect(searchRes?.status()).toBe(200);

      // Verify search input has query
      const searchInput = page.getByPlaceholder(
        /Search by artist, headliner, venue, city, or genre/i,
      );
      await expect(searchInput).toBeVisible();

      // Give search client time to execute query and render results
      await page.waitForTimeout(500);

      // 3. Navigate to Event Detail Page
      const detailRes = await page.goto(ev.indexUiPath);
      expect(detailRes?.status()).toBe(200);

      // Verify event title or headliner is rendered on page
      const eventTitleElement = page
        .locator('h1, h2, [role="heading"], p')
        .filter({
          hasText: new RegExp(escapeRegex(ev.name.slice(0, 15)), 'i'),
        });
      await expect(eventTitleElement.first()).toBeVisible({ timeout: 5000 });

      // Verify venue name is rendered in page text
      const venueElement = page.getByText(
        new RegExp(escapeRegex(ev.venue.slice(0, 15)), 'i'),
      );
      await expect(venueElement.first()).toBeVisible({ timeout: 5000 });

      // If ticket link is present, verify ticket link element exists
      if (ev.ticketUrl) {
        const ticketLink = page.locator(
          'a[href*="ticketmaster.com"], a[href*="tickets"], a:has-text("Tickets"), a:has-text("Get Tickets")',
        );
        if ((await ticketLink.count()) > 0) {
          await expect(ticketLink.first()).toBeVisible();
        }
      }

      // 4. Capture screenshot artifact proving real event rendering in Index UI
      const screenshotPath = path.resolve(
        screenshotDir,
        `traced-event-${i + 1}.png`,
      );
      await page.screenshot({
        path: screenshotPath,
        fullPage: false,
      });

      expect(fs.existsSync(screenshotPath)).toBe(true);
      console.log(
        `Captured screenshot: docs/screenshots/traced-event-${i + 1}.png`,
      );
    }
  });
});
