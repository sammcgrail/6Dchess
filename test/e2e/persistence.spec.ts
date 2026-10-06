import { test, expect } from '@playwright/test';
import { boards, clickSquare, collectErrors, expectLegalBoards, move, openGame } from './helpers';

test('undo reverts normal and time-travel moves', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await expect(page.locator('#undo')).toBeDisabled();
  await move(page, 0, 'g1', 'f3');
  await move(page, 0, 'g8', 'f6');
  const afterTwo = await boards(page);

  // Time travel creates Branch 1; undo removes it again
  await clickSquare(page, 0, 'f3');
  await clickSquare(page, 0, 'f3', 1);
  expect(await boards(page)).toHaveLength(2);
  await page.locator('#undo').click();
  expect(await boards(page)).toEqual(afterTwo);

  // Ctrl+Z undoes a normal move
  await page.keyboard.press('Control+z');
  const [b] = await boards(page);
  expect(b.moveCount).toBe(1);
  expect(b.turn).toBe('b');
  await expectLegalBoards(page);
  expect(errors).toEqual([]);
});

test('game is autosaved and restored after reload', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await move(page, 0, 'g1', 'f3');
  await move(page, 0, 'g8', 'f6');
  await clickSquare(page, 0, 'f3');
  await clickSquare(page, 0, 'f3', 1);
  const before = await boards(page);
  expect(before).toHaveLength(2);

  await page.reload();
  await page.waitForFunction(() => !!(window as any).Game);
  expect(await boards(page)).toEqual(before);
  await expect(page.locator('#timeline-list .tl-item')).toHaveCount(2);
  // History stack of the new timeline has the most recent position on top
  const topLayerMove = await page.evaluate(() => (window as any).ChessApp.Board3D.getTimeline(1).historyLayers[0].userData.moveFrom);
  expect(topLayerMove).toBe('f3');

  // New Game clears the save
  await page.locator('#reset').click();
  await page.reload();
  await page.waitForFunction(() => !!(window as any).Game);
  expect(await boards(page)).toHaveLength(1);
  expect((await boards(page))[0].moveCount).toBe(0);
  expect(errors).toEqual([]);
});
