import { expect, type Page } from '@playwright/test';

export interface DebugBoard {
  timelineId: number;
  currentFen: string;
  turn: 'w' | 'b';
  moveCount: number;
  isCheckmate: boolean;
  isDraw: boolean;
}

/** Attach listeners that collect page errors and console errors */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

export async function openGame(page: Page): Promise<void> {
  await page.goto('./');
  await page.waitForFunction(() => !!(window as any).Game && !!document.querySelector('#scene-container canvas'));
  await expect(page.locator('#status')).toContainText('White');
}

/** Click a square through the same entry point the 3D raycaster uses */
export async function clickSquare(page: Page, timelineId: number, square: string, turn = -1): Promise<void> {
  await page.evaluate(
    ([tl, sq, t]) => (window as any).Game.handleClick({ timelineId: tl, square: sq, turn: t, isHistory: t >= 0 }),
    [timelineId, square, turn] as const
  );
}

export async function move(page: Page, timelineId: number, from: string, to: string): Promise<void> {
  await clickSquare(page, timelineId, from);
  await clickSquare(page, timelineId, to);
}

export async function boards(page: Page): Promise<DebugBoard[]> {
  return page.evaluate(() => (window as any).Game.getGameDebugState().boards);
}

/** Every board must be a legal chess.js position where the side that just moved is not in check */
export async function expectLegalBoards(page: Page): Promise<void> {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    for (const b of (window as any).Game.getGameDebugState().boards) {
      const c = new (window as any).Chess();
      if (!c.load(b.currentFen)) out.push(`T${b.timelineId} unloadable ${b.currentFen}`);
      const parts = b.currentFen.split(' ');
      parts[1] = parts[1] === 'w' ? 'b' : 'w';
      const flipped = new (window as any).Chess();
      if (flipped.load(parts.join(' ')) && flipped.in_check()) out.push(`T${b.timelineId} mover in check ${b.currentFen}`);
    }
    return out;
  });
  expect(problems).toEqual([]);
}
