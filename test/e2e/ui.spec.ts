import { test, expect } from '@playwright/test';
import { clickSquare, collectErrors, move, openGame } from './helpers';

test('sidebar lists only real timelines and switches on click', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await expect(page.locator('#timeline-list .tl-item')).toHaveCount(1);

  await move(page, 0, 'g1', 'f3');
  await move(page, 0, 'g8', 'f6');
  await clickSquare(page, 0, 'f3');
  await clickSquare(page, 0, 'f3', 1);
  await expect(page.locator('#timeline-list .tl-item')).toHaveCount(2);
  await expect(page.locator('#timeline-list .tl-item.active')).toContainText('Branch 1');

  await page.locator('#timeline-list .tl-item[data-tl-id="0"]').click();
  await expect(page.locator('#timeline-list .tl-item.active')).toContainText('Main');
  await expect(page.locator('#status')).toContainText('[Main]');
  expect(errors).toEqual([]);
});

test('timeline state badge shows checkmate', async ({ page }) => {
  await openGame(page);
  for (const [a, b] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) await move(page, 0, a, b);
  await expect(page.locator('#timeline-list .tl-state.mate')).toHaveCount(1);
  await expect(page.locator('#status')).toContainText('Checkmate');
});

test('CPU settings are collapsible and the speed label matches the delay', async ({ page }) => {
  await openGame(page);
  const settings = page.locator('#cpu-settings');
  await expect(settings).not.toHaveAttribute('open', '');
  await settings.locator('summary').click();
  await expect(page.locator('#cpu-speed')).toBeVisible();
  await expect(page.locator('#cpu-speed-value')).toHaveText('400ms');
  await page.locator('#cpu-speed').fill('1100');
  await expect(page.locator('#cpu-speed-value')).toHaveText('1000ms');
});

test('promotion picker is shown on screen as a dialog', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => {
    const g = (window as any).Game;
    g.getTimeline(0).chess.load('7k/4P3/8/8/8/8/8/K7 w - - 0 1');
    g.renderTimeline(0);
  });
  await move(page, 0, 'e7', 'e8');
  const picker = page.getByRole('dialog', { name: 'Choose promotion piece' });
  await expect(picker).toBeInViewport();
  await page.screenshot({ path: 'test-results/screens/04-promotion.png' });
  // Switching boards dismisses a stale picker
  await page.evaluate(() => (window as any).Game.clearSelection());
  await expect(picker).toHaveCount(0);
});

test('mobile layout keeps board and controls usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = collectErrors(page);
  await openGame(page);
  await move(page, 0, 'e2', 'e4');
  await expect(page.locator('#button-row')).toBeVisible();
  const canvas = await page.locator('#scene-container canvas').boundingBox();
  expect(canvas!.height).toBeGreaterThan(250);
  await page.screenshot({ path: 'test-results/screens/05-mobile.png' });
  expect(errors).toEqual([]);
});
