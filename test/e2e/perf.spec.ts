import { test, expect, type Page } from '@playwright/test';
import { collectErrors, move, openGame } from './helpers';

async function gpuMemory(page: Page): Promise<{ geometries: number; textures: number }> {
  return page.evaluate(() => {
    const info = (window as any).ChessApp.Board3D.renderer.info.memory;
    return { geometries: info.geometries, textures: info.textures };
  });
}

async function knightShuffle(page: Page, cycles: number): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await move(page, 0, 'g1', 'f3');
    await move(page, 0, 'g8', 'f6');
    await move(page, 0, 'f3', 'g1');
    await move(page, 0, 'f6', 'g8');
  }
}

test('GPU memory stays flat as moves accumulate', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  // Fill the history stack (12 layers) and move-line buffer first
  await knightShuffle(page, 5);
  await page.waitForTimeout(300);
  const before = await gpuMemory(page);
  // Repetition draws end the game after the 3rd repetition, so use a fresh pawn walk instead
  await page.locator('#reset').click();
  await knightShuffle(page, 1);
  for (const [w, b] of [['a2', 'a7'], ['h2', 'h7'], ['b2', 'b7'], ['g2', 'g7'], ['c2', 'c7'], ['f2', 'f7']]) {
    await move(page, 0, w, w[0] + '3');
    await move(page, 0, b, b[0] + '6');
    await move(page, 0, w[0] + '3', w[0] + '4');
    await move(page, 0, b[0] + '6', b[0] + '5');
  }
  await page.waitForTimeout(300);
  const after = await gpuMemory(page);
  // Rendering the same scene structure must not keep allocating GPU buffers
  expect(after.geometries).toBeLessThanOrEqual(before.geometries + 5);
  expect(after.textures).toBeLessThanOrEqual(before.textures + 2);
  expect(errors).toEqual([]);
});

test('idle scene does not render every frame', async ({ page }) => {
  await openGame(page);
  await page.waitForTimeout(1500);
  const renders = await page.evaluate(async () => {
    const info = (window as any).ChessApp.Board3D.renderer.info.render;
    const start = info.frame;
    await new Promise((r) => setTimeout(r, 2000));
    return info.frame - start;
  });
  // Ambient animation is capped at ~30 fps; a full-rate loop would be ~120 in 2s
  expect(renders).toBeLessThanOrEqual(70);
});
