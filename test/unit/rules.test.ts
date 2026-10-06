import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crossTimelineLandingSquares,
  planCrossTimelineMove,
  planTimeTravel,
  pieceMap,
} from '../../src/rules';
import { parseFen } from '../../src/gameUtils';
import type { Piece } from '../../src/types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const WQ: Piece = { type: 'q', color: 'w' };
const WN: Piece = { type: 'n', color: 'w' };
const WP: Piece = { type: 'p', color: 'w' };
const WB: Piece = { type: 'b', color: 'w' };

test('pieceMap reads pieces from a FEN', () => {
  const map = pieceMap(START);
  assert.deepEqual(map.get('e1'), { type: 'k', color: 'w' });
  assert.deepEqual(map.get('d8'), { type: 'q', color: 'b' });
  assert.equal(map.get('e4'), undefined);
  assert.equal(map.size, 32);
});

test('landing squares never include occupied squares', () => {
  const squares = crossTimelineLandingSquares(START, 'b1', WN);
  assert.deepEqual(squares.sort(), ['a3', 'c3']);
  // A queen on d1 of the start position is boxed in
  assert.deepEqual(crossTimelineLandingSquares(START, 'd1', WQ), []);
});

test('pawn double push cannot jump over a piece', () => {
  const blocked = 'rnbqkbnr/pppppppp/8/8/8/4N3/PPPPPPPP/R1BQKBNR w KQkq - 0 1';
  assert.deepEqual(crossTimelineLandingSquares(blocked, 'e2', WP), []);
  assert.deepEqual(crossTimelineLandingSquares(START, 'e2', WP).sort(), ['e3', 'e4']);
});

test('cross-timeline move updates both boards and flips both turns', () => {
  const source = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1';
  const plan = planCrossTimelineMove(source, START, 'f3', 'h4', WN);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(parseFen(plan.sourceFen).turn, 'b');
  assert.equal(parseFen(plan.targetFen).turn, 'b');
  assert.equal(pieceMap(plan.sourceFen).get('f3'), undefined);
  assert.deepEqual(pieceMap(plan.targetFen).get('h4'), WN);
});

test('cross-timeline move cannot expose own king on the source board (pinned piece)', () => {
  // Bishop on e2 shields the white king on e1 from the rook on e8
  const pinned = '4r2k/8/8/8/8/8/4B3/4K3 w - - 0 1';
  const target = '7k/8/8/8/8/8/8/4K3 w - - 0 1';
  const plan = planCrossTimelineMove(pinned, target, 'e2', 'd3', WB);
  assert.equal(plan.ok, false);
});

test('cross-timeline arrival must resolve check on the target board', () => {
  const source = '7k/8/8/8/8/8/8/R3K3 w - - 0 1';
  // White king on e1 is in check from the rook on e8 on the target board
  const inCheck = '4r2k/8/8/8/8/8/8/4K3 w - - 0 1';
  // Landing on a2 does not block
  assert.equal(planCrossTimelineMove(source, inCheck, 'a1', 'a2', { type: 'r', color: 'w' }).ok, false);
  // A queen phasing in at e4 and landing on e3 blocks the check
  const queenSource = '7k/8/8/8/4Q3/8/8/4K3 w - - 0 1';
  assert.ok(planCrossTimelineMove(queenSource, inCheck, 'e4', 'e3', WQ).ok);
  assert.equal(planCrossTimelineMove(queenSource, inCheck, 'e4', 'd4', WQ).ok, false);
});

test('pawn reaching the last rank via cross-timeline is promoted to a queen', () => {
  const source = '7k/4P3/8/8/8/8/8/K7 w - - 0 1';
  const target = '7k/8/8/8/8/8/8/K7 w - - 0 1';
  const plan = planCrossTimelineMove(source, target, 'e7', 'e8', WP);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.deepEqual(plan.placedPiece, WQ);
  assert.deepEqual(pieceMap(plan.targetFen).get('e8'), WQ);
});

test('cross-timeline move rejected when not your turn on either board', () => {
  const blackToMove = START.replace(' w ', ' b ');
  const source = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1';
  assert.equal(planCrossTimelineMove(source, blackToMove, 'f3', 'h4', WN).ok, false);
});

test('time travel only lands on positions where it was the mover\'s turn', () => {
  const now = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5Q2/PPPP1PPP/RNB1KBNR w KQkq - 0 3';
  const whiteToMovePast = START;
  const blackToMovePast = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  assert.ok(planTimeTravel(now, whiteToMovePast, 'f3', WQ).ok);
  assert.equal(planTimeTravel(now, blackToMovePast, 'f3', WQ).ok, false);
});

test('time travel arrival flips the turn and can capture', () => {
  const now = '7k/8/8/8/8/8/8/Q3K3 w - - 0 10';
  const past = 'r6k/8/8/8/8/8/8/4K3 w - - 0 5';
  // Arrives on a1 of the past board... a1 is empty there; travel from a1 to past
  const plan = planTimeTravel(now, past, 'a1', WQ);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(parseFen(plan.arrivalFen).turn, 'b');
  assert.equal(plan.captured, null);

  const pastWithBlackKnight = '7k/8/8/8/8/8/8/n3K3 w - - 0 5';
  const capture = planTimeTravel(now, pastWithBlackKnight, 'a1', WQ);
  assert.ok(capture.ok);
  if (!capture.ok) return;
  assert.deepEqual(capture.captured, { type: 'n', color: 'b' });
});

test('time travel capturing a rook removes the matching castling right', () => {
  const piece: Piece = { type: 'n', color: 'b' };
  const past = 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 10';
  const plan = planTimeTravel('4k3/8/8/8/8/8/8/4K2n b - - 0 20', past, 'h1', piece);
  assert.ok(plan.ok, plan.ok ? '' : plan.reason);
  if (!plan.ok) return;
  assert.equal(parseFen(plan.arrivalFen).castling, 'Qkq');
});

test('time travel departure cannot expose own king', () => {
  const pinned = '4r2k/8/8/8/8/8/4Q3/4K3 w - - 0 5';
  const past = '7k/8/8/8/8/8/8/4K3 w - - 0 2';
  assert.equal(planTimeTravel(pinned, past, 'e2', WQ).ok, false);
});

test('pawns and kings cannot time travel', () => {
  assert.equal(planTimeTravel(START, START, 'e2', WP).ok, false);
  assert.equal(planTimeTravel(START, START, 'e1', { type: 'k', color: 'w' }).ok, false);
});
