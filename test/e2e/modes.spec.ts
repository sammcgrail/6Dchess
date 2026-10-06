import { test, expect } from '@playwright/test';
import { boards, clickSquare, collectErrors, expectLegalBoards, move, openGame } from './helpers';

const totalMoves = async (page: import('@playwright/test').Page) =>
  (await boards(page)).reduce((n, b) => n + b.moveCount, 0);

test('vs CPU: the CPU answers as Black and undo takes back both moves', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await page.evaluate(() => (window as any).Game.cpuSetDelay(100));
  await page.getByRole('radio', { name: 'vs CPU' }).click();
  await expect(page.getByRole('radio', { name: 'vs CPU' })).toHaveAttribute('aria-checked', 'true');

  // The CPU never moves White's pieces
  await page.waitForTimeout(1500);
  expect(await totalMoves(page)).toBe(0);

  await move(page, 0, 'e2', 'e4');
  await expect.poll(() => totalMoves(page), { timeout: 20_000 }).toBe(2);
  const [b] = await boards(page);
  expect(b.turn).toBe('w');

  // Undo reverts the human move and the CPU reply; the CPU keeps playing Black
  await page.locator('#undo').click();
  expect(await totalMoves(page)).toBe(0);
  await expect(page.getByRole('radio', { name: 'vs CPU' })).toHaveAttribute('aria-checked', 'true');
  await expectLegalBoards(page);
  expect(errors).toEqual([]);
});

test('Watch plays both sides and 2 Players stops it', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await page.evaluate(() => (window as any).Game.cpuSetDelay(100));
  await page.getByRole('radio', { name: 'Watch' }).click();
  await expect.poll(() => totalMoves(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(4);
  await page.getByRole('radio', { name: '2 Players' }).click();
  await page.waitForTimeout(2500); // let any in-flight engine search settle
  const stopped = await totalMoves(page);
  await page.waitForTimeout(2000);
  expect(await totalMoves(page)).toBe(stopped);
  await expectLegalBoards(page);
  expect(errors).toEqual([]);
});

test('help dialog opens from the toolbar and closes', async ({ page }) => {
  await openGame(page);
  const dialog = page.getByRole('dialog', { name: 'How to play 6D Chess' });
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'How to play' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Time travel');
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(dialog).toBeHidden();
});

test('hovering a square highlights it and shows a pointer', async ({ page }) => {
  await openGame(page);
  await page.waitForTimeout(500);
  const pt = await page.evaluate(() => (window as any).ChessApp.Board3D.squareToScreen(0, 'e2'));
  await page.mouse.move(pt.x, pt.y);
  await expect.poll(() => page.evaluate(() => (document.querySelector('#scene-container canvas') as HTMLElement).style.cursor)).toBe('pointer');
  await page.mouse.move(5, 880);
  await expect.poll(() => page.evaluate(() => (document.querySelector('#scene-container canvas') as HTMLElement).style.cursor)).toBe('');
});

test('vs CPU: CPU replies do not steal the active board or the human selection', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  // Build two boards with White to move: Black's knight time-travels from f6
  await move(page, 0, 'e2', 'e4');
  await move(page, 0, 'g8', 'f6');
  await move(page, 0, 'd2', 'd4');
  await clickSquare(page, 0, 'f6');
  await clickSquare(page, 0, 'f6', 1);
  expect((await boards(page)).map((b) => b.turn)).toEqual(['w', 'w']);

  await page.evaluate(() => (window as any).Game.cpuSetDelay(300));
  await page.getByRole('radio', { name: 'vs CPU' }).click();
  // Human moves on Main, then looks at Branch 1 and picks up a pawn while the CPU answers on Main
  await move(page, 0, 'e4', 'e5');
  await page.evaluate(() => (window as any).Game.setActiveTimeline(1, false));
  await clickSquare(page, 1, 'd2');
  await expect.poll(() => page.evaluate(() => (window as any).Game.getGameDebugState().boards[0].turn), { timeout: 20_000 }).toBe('w');
  const state = await page.evaluate(() => ({ active: (window as any).Game.activeTimelineId, selected: (window as any).Game.selected }));
  expect(state).toEqual({ active: 1, selected: 'd2' });
  // ...and the human can still complete the move
  await clickSquare(page, 1, 'd4');
  expect((await boards(page)).find((b) => b.timelineId === 1)!.turn).toBe('b');
  expect(errors).toEqual([]);
});
