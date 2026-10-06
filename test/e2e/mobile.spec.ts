import { test, expect, type Page } from '@playwright/test';

// iOS Safari's floating bottom toolbar overlays roughly the bottom 80px of the page
const TOOLBAR_CLEARANCE = 80;

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function scrollSidebarToEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sidebar = document.getElementById('sidebar')!;
    sidebar.scrollTop = sidebar.scrollHeight;
  });
}

test('mobile: CPU SETTINGS scrolls clear of the bottom toolbar and opens', async ({ page }) => {
  await page.goto('./');
  await page.waitForSelector('#sidebar');
  const viewportHeight = page.viewportSize()!.height;

  await scrollSidebarToEnd(page);
  const summary = page.locator('#cpu-settings > summary');
  const box = (await summary.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(viewportHeight - TOOLBAR_CLEARANCE);

  await summary.tap();
  await expect(page.locator('#cpu-settings')).toHaveAttribute('open', '');

  // The expanded controls can also be brought above the toolbar and used
  await scrollSidebarToEnd(page);
  const lastControl = page.locator('#cpu-black-toggle');
  const controlBox = (await lastControl.boundingBox())!;
  expect(controlBox.y + controlBox.height).toBeLessThanOrEqual(viewportHeight - TOOLBAR_CLEARANCE);
  const before = await lastControl.textContent();
  await lastControl.tap();
  await expect(lastControl).not.toHaveText(before!);
});

test('mobile: the app fits the visible viewport', async ({ page }) => {
  await page.goto('./');
  await page.waitForSelector('#sidebar');
  const appHeight = await page.evaluate(() => document.getElementById('app')!.getBoundingClientRect().height);
  expect(appHeight).toBeLessThanOrEqual(page.viewportSize()!.height);
});
