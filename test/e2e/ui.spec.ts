import { test, expect } from '@playwright/test';
import { boards, clickSquare, collectErrors, move, openGame } from './helpers';

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

test('real mouse clicks on the 3D board select and move pieces', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await page.waitForTimeout(800); // let the camera settle
  const clickAt = async (square: string, turn = -1) => {
    const pt = await page.evaluate(
      ([sq, t]) => (window as any).ChessApp.Board3D.squareToScreen(0, sq, t),
      [square, turn] as const
    );
    expect(pt).not.toBeNull();
    await page.mouse.click(pt!.x, pt!.y);
  };
  await clickAt('e2');
  await clickAt('e4');
  await clickAt('g8');
  await clickAt('f6');
  const fen = await page.evaluate(() => (window as any).Game.getTimelineFen(0));
  expect(fen.split(' ')[0]).toBe('rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR');
  expect(errors).toEqual([]);
});

test('sound toggle persists across reloads', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  const toggle = page.locator('#sound-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await openGame(page);
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
  // Moves still work with audio muted / unavailable
  await move(page, 0, 'e2', 'e4');
  expect(errors).toEqual([]);
});

test('2D mode keeps every board on screen while playing', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await move(page, 0, 'g1', 'f3');
  await move(page, 0, 'g8', 'f6');
  await clickSquare(page, 0, 'f3');
  await clickSquare(page, 0, 'f3', 1); // time travel -> Branch 1, starts a camera focus animation
  await page.locator('[id="2d-mode-toggle"]').click();
  // Playing on a board in 2D used to pan the camera to that board's 3D position
  await move(page, 1, 'e7', 'e5');
  await move(page, 0, 'e7', 'e5');
  await page.waitForTimeout(800);
  // The 2D grid is centered on the origin; playing must not pan it away
  const target = await page.evaluate(() => (window as any).ChessApp.Board3D.controls.target.toArray());
  expect(Math.hypot(target[0], target[2])).toBeLessThan(0.01);
  const canvas = (await page.locator('#scene-container canvas').boundingBox())!;
  for (const tl of [0, 1]) {
    const pt = await page.evaluate((id) => (window as any).ChessApp.Board3D.squareToScreen(id, 'e4'), tl);
    expect(pt.x).toBeGreaterThan(canvas.x);
    expect(pt.x).toBeLessThan(canvas.x + canvas.width);
    expect(pt.y).toBeGreaterThan(canvas.y);
    expect(pt.y).toBeLessThan(canvas.y + canvas.height);
  }
  await page.screenshot({ path: 'test-results/screens/06-2d-mode.png' });
  expect(errors).toEqual([]);
});

test('king in check is highlighted on its square', async ({ page }) => {
  await openGame(page);
  const checkSquare = () => page.evaluate(() => (window as any).ChessApp.Board3D.getTimeline(0).checkSquare);
  await move(page, 0, 'e2', 'e4');
  await move(page, 0, 'f7', 'f6');
  expect(await checkSquare()).toBeNull();
  await move(page, 0, 'd1', 'h5'); // Qh5+
  expect(await checkSquare()).toBe(4); // e8 = row 0, col 4
  await move(page, 0, 'g7', 'g6');
  expect(await checkSquare()).toBeNull();
});

test('clicking a move reviews that position; clicking the board returns to the present', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await move(page, 0, 'e2', 'e4');
  await move(page, 0, 'e7', 'e5');
  await move(page, 0, 'g1', 'f3');
  await page.locator('#moves .move[data-ply="1"]').click();
  await expect(page.locator('#moves .move[data-ply="1"]')).toHaveClass(/current/);
  await expect(page.locator('#moves .move[data-ply="3"]')).toHaveClass(/future/);
  await expect(page.locator('#move-slider-label')).toContainText('1/3');
  // A board click while reviewing returns to the live position instead of moving
  await clickSquare(page, 0, 'b8');
  await expect(page.locator('#move-slider-label')).toContainText('3/3');
  await move(page, 0, 'b8', 'c6');
  expect((await boards(page))[0].moveCount).toBe(4);
  expect(errors).toEqual([]);
});
