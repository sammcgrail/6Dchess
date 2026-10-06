import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardPriority, materialBalance, pickMultiverseMove } from '../../src/cpuStrategy';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const fixed = (value: number) => () => value;

test('materialBalance is relative to the given color', () => {
  assert.equal(materialBalance(START, 'w'), 0);
  const whiteUpAQueen = 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
  assert.equal(materialBalance(whiteUpAQueen, 'w'), 9);
  assert.equal(materialBalance(whiteUpAQueen, 'b'), -9);
});

test('boardPriority favours boards in check and boards that fell behind', () => {
  const quiet = boardPriority(START, 10, 10, fixed(0));
  const inCheck = boardPriority('rnbqkbnr/ppppp1pp/8/5p1Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2', 10, 10, fixed(0));
  assert.ok(inCheck > quiet + 30, `check ${inCheck} vs quiet ${quiet}`);
  assert.ok(boardPriority(START, 2, 10, fixed(0)) > quiet, 'lagging board gets a boost');
});

test('pickMultiverseMove always plays a mate', () => {
  const pick = pickMultiverseMove([{ score: 3, bias: 0.5, id: 'a' }, { score: 1000, bias: 0, id: 'mate' }], 0, fixed(0.99));
  assert.equal(pick?.id, 'mate');
});

test('pickMultiverseMove rarely plays purposeless moves but takes strong ones', () => {
  const weak = [{ score: 0, bias: 0.5 }];
  const strong = [{ score: 4, bias: 0.5 }];
  // probability = chance * (0.08 + 0.92*strength) * (0.5 + bias)
  assert.equal(pickMultiverseMove(weak, 0.75, fixed(0.05)), weak[0]); // p = 0.06
  assert.equal(pickMultiverseMove(weak, 0.75, fixed(0.07)), null);
  assert.equal(pickMultiverseMove(strong, 0.75, fixed(0.7)), strong[0]);
  assert.equal(pickMultiverseMove([], 1, fixed(0)), null);
});
