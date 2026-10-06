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

test('undo is autosaved: reloading keeps the taken-back position', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await move(page, 0, 'e2', 'e4');
  await move(page, 0, 'e7', 'e5');
  await page.locator('#undo').click();
  expect((await boards(page))[0].moveCount).toBe(1);

  await page.reload();
  await page.waitForFunction(() => !!(window as any).Game);
  const [b] = await boards(page);
  expect(b.moveCount).toBe(1);
  expect(b.turn).toBe('b');
  expect(errors).toEqual([]);
});

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const corruptSave = (overrides: Record<string, unknown>, tlOverrides: Record<string, unknown> = {}) => ({
  version: 1,
  activeTimelineId: 0,
  nextTimelineId: 1,
  cpuGlobalTurn: 'w',
  lines: [],
  timelines: [{
    id: 0, name: 'Main', parentId: null, branchTurn: -1, xOffset: 0, fen: AFTER_E4,
    moveHistory: [{ from: 'e2', to: 'e4', piece: 'p', captured: null, san: 'e4', isWhite: true }],
    snapshots: [START, AFTER_E4],
    ...tlOverrides,
  }],
  ...overrides,
});

for (const [name, save] of [
  // Both pass validation and then throw midway through the rebuild, after the scene is cleared
  ['a bad move record', corruptSave({}, { moveHistory: [null] })],
  ['bad connection lines', corruptSave({ lines: 5 })],
] as const) {
  test(`a partially corrupt save (${name}) starts a fresh game cleanly`, async ({ page }) => {
    const errors = collectErrors(page);
    await openGame(page);
    const freshSceneSize = await page.evaluate(() => (window as any).ChessApp.Board3D.scene.children.length);
    await page.evaluate((s) => localStorage.setItem('6dchess-save', JSON.stringify(s)), save);
    await page.reload();
    await page.waitForFunction(() => !!(window as any).Game && !!document.querySelector('#scene-container canvas'));

    const b = await boards(page);
    expect(b).toHaveLength(1);
    expect(b[0].moveCount).toBe(0);
    expect(await page.evaluate(() => Object.keys((window as any).ChessApp.Board3D.timelineCols))).toEqual(['0']);
    expect(await page.evaluate(() => (window as any).ChessApp.Board3D.getTimeline(0).pieceSpriteCount())).toBe(32);
    await expect(page.locator('#timeline-list .tl-item')).toHaveCount(1);
    // No half-built board left behind in the scene
    expect(await page.evaluate(() => (window as any).ChessApp.Board3D.scene.children.length)).toBe(freshSceneSize);
    // The bad save is gone, and the fresh game is playable
    const saved = await page.evaluate(() => localStorage.getItem('6dchess-save'));
    expect(saved === null || JSON.parse(saved).timelines.every((t: any) => t.moveHistory.length === 0)).toBe(true);
    await move(page, 0, 'd2', 'd4');
    expect((await boards(page))[0].moveCount).toBe(1);
    expect(errors).toEqual([]);
  });
}
