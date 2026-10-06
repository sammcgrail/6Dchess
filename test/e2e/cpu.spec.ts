import { test, expect } from '@playwright/test';
import { boards, collectErrors, expectLegalBoards, openGame } from './helpers';

test('CPU self-play stays legal across timelines', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openGame(page);
  await page.evaluate(() => {
    const g = (window as any).Game;
    g.cpuSetDelay(100);
    g.cpuStart();
  });

  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(4000);
    await expectLegalBoards(page);
    await page.screenshot({ path: `test-results/screens/cpu-${i}.png` });
  }
  await page.evaluate(() => (window as any).Game.cpuStop());

  const b = await boards(page);
  const totalMoves = b.reduce((n, x) => n + x.moveCount, 0);
  expect(totalMoves).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('stopping and restarting the CPU never runs two loops', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await page.evaluate(() => (window as any).Game.cpuSetDelay(300));
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      const g = (window as any).Game;
      g.cpuStart();
      g.cpuStop();
      g.cpuStart();
    });
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => (window as any).Game.cpuStop());
  const settled = (await boards(page)).reduce((n, x) => n + x.moveCount, 0);
  await page.waitForTimeout(6000);
  const after = (await boards(page)).reduce((n, x) => n + x.moveCount, 0);
  // At most one in-flight engine result may land... and it must be discarded
  expect(after).toBe(settled);
  await expectLegalBoards(page);
  expect(errors).toEqual([]);
});
