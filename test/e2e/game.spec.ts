import { test, expect } from '@playwright/test';
import { boards, clickSquare, collectErrors, expectLegalBoards, move, openGame } from './helpers';

test('loads cleanly and renders the board', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await page.waitForTimeout(500);
  const b = await boards(page);
  expect(b).toHaveLength(1);
  expect(b[0].currentFen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  await page.screenshot({ path: 'test-results/screens/01-initial.png' });
  expect(errors).toEqual([]);
});

test('works when served without a trailing slash', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/chess');
  await page.waitForFunction(() => !!(window as any).Game && !!document.querySelector('#scene-container canvas'));
  expect(errors).toEqual([]);
});

test('normal moves update board, status and move list', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await move(page, 0, 'e2', 'e4');
  await move(page, 0, 'e7', 'e5');
  await move(page, 0, 'g1', 'f3');
  const [b] = await boards(page);
  expect(b.moveCount).toBe(3);
  expect(b.turn).toBe('b');
  await expect(page.locator('#status')).toContainText('Black');
  await expect(page.locator('#moves')).toContainText('Nf3');
  await expectLegalBoards(page);
  expect(errors).toEqual([]);
});

test('illegal selections are ignored', async ({ page }) => {
  await openGame(page);
  // Black piece on white's turn, then an illegal pawn jump
  await move(page, 0, 'e7', 'e5');
  await move(page, 0, 'e2', 'e5');
  const [b] = await boards(page);
  expect(b.moveCount).toBe(0);
});

test('time travel creates a new timeline and cross-timeline moves link boards', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await move(page, 0, 'g1', 'f3');
  await move(page, 0, 'g8', 'f6');
  // Knight on f3 travels back to the start position (history layer 1 = 2 plies ago, white to move)
  await clickSquare(page, 0, 'f3');
  await clickSquare(page, 0, 'f3', 1);
  let b = await boards(page);
  expect(b).toHaveLength(2);
  const branch = b.find((x) => x.timelineId === 1)!;
  expect(branch.turn).toBe('b');
  expect(branch.currentFen.split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKBNR');
  await expect(page.locator('#timeline-list')).toContainText('Branch 1');
  await expectLegalBoards(page);
  await page.screenshot({ path: 'test-results/screens/02-time-travel.png' });
  expect(errors).toEqual([]);
});

test('promotion picker promotes to the chosen piece', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => {
    const g = (window as any).Game;
    g.getTimeline(0).chess.load('7k/4P3/8/8/8/8/8/K7 w - - 0 1');
    g.renderTimeline(0);
  });
  await move(page, 0, 'e7', 'e8');
  await page.locator('#promotion-picker button[data-piece="n"]').click();
  const [b] = await boards(page);
  expect(b.currentFen.split(' ')[0]).toBe('4N2k/8/8/8/8/8/8/K7');
});

test('new game resets everything', async ({ page }) => {
  await openGame(page);
  await move(page, 0, 'e2', 'e4');
  await page.locator('#reset').click();
  const b = await boards(page);
  expect(b).toHaveLength(1);
  expect(b[0].moveCount).toBe(0);
});

test('demo plays the Immortal Game to checkmate', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await openGame(page);
  await page.locator('#example-play').click();
  await expect(page.locator('#status')).toContainText('Checkmate', { timeout: 40_000 });
  await expect(page.locator('#game-end-toast')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/03-demo-checkmate.png' });
  expect(errors).toEqual([]);
});
