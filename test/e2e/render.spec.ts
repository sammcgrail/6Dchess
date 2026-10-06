import { test, expect, type Page } from '@playwright/test';
import { clickSquare, collectErrors, move, openGame } from './helpers';

// With prefers-reduced-motion the ambient animation is off, so nothing redraws the scene on a
// timer: every board change must request a frame itself or it stays invisible.
test.use({ reducedMotion: 'reduce' });

const frames = (page: Page) =>
  page.evaluate(() => (window as any).ChessApp.Board3D.renderer.info.render.frame as number);

/** Wait until the scene is idle (no frames rendered for a while), then run `action` and
 * require a new frame. The idle check proves the counter would stay flat without a redraw. */
async function expectRedraw(page: Page, action: () => Promise<void>): Promise<void> {
  await expect
    .poll(async () => {
      const start = await frames(page);
      await page.waitForTimeout(400);
      return (await frames(page)) - start;
    }, { timeout: 10_000 })
    .toBe(0);
  const before = await frames(page);
  await action();
  await expect.poll(() => frames(page), { timeout: 2_000 }).toBeGreaterThan(before);
}

test('reduced motion: the board redraws after New Game, Undo, review and a 2D selection', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

  await move(page, 0, 'e2', 'e4');
  await expectRedraw(page, () => page.locator('#reset').click());

  await move(page, 0, 'e2', 'e4');
  await move(page, 0, 'e7', 'e5');
  await expectRedraw(page, () => page.locator('#undo').click());

  await move(page, 0, 'e7', 'e5');
  await expectRedraw(page, () => page.locator('#moves .move[data-ply="1"]').click());
  await expectRedraw(page, () => page.locator('#moves .move[data-ply="2"]').click());

  await page.locator('#2d-mode-toggle').click();
  await expectRedraw(page, () => clickSquare(page, 0, 'g1'));
  await expectRedraw(page, () => clickSquare(page, 0, 'g1'));
  expect(errors).toEqual([]);
});
