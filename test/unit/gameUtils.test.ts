import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandFenRow,
  compressFenRow,
  parseFen,
  buildFen,
  modifyFen,
  updateCastlingForRemoval,
  isValidFen,
  validateKings,
  validateNoSelfCheck,
} from '../../src/gameUtils';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('expand/compress FEN rows round-trip', () => {
  for (const row of ['rnbqkbnr', '8', '4P3', 'r3k2r', '1p1p1p1p']) {
    assert.equal(compressFenRow(expandFenRow(row)), row);
  }
  assert.deepEqual(expandFenRow('2k5'), ['', '', 'k', '', '', '', '', '']);
});

test('parseFen/buildFen round-trip', () => {
  assert.equal(buildFen(parseFen(START)), START);
  const parts = parseFen(START);
  assert.equal(parts.turn, 'w');
  assert.equal(parts.castling, 'KQkq');
  assert.equal(parts.fullmoveNumber, 1);
});

test('modifyFen removes a piece, flips turn and resets en passant', () => {
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
  const out = parseFen(modifyFen({ fen, square: 'd1', newPiece: null, whiteToMove: false }));
  assert.equal(out.turn, 'b');
  assert.equal(out.enPassant, '-');
  assert.equal(out.position.split('/')[7], 'RNB1KBNR');
  assert.equal(out.halfmoveClock, 1);
});

test('modifyFen increments fullmove when it becomes white to move', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const out = parseFen(modifyFen({ fen, square: 'd8', newPiece: null, whiteToMove: true }));
  assert.equal(out.fullmoveNumber, 2);
});

test('castling rights drop when a rook square is vacated or captured', () => {
  assert.equal(updateCastlingForRemoval('KQkq', 'h1', 'R'), 'Qkq');
  assert.equal(updateCastlingForRemoval('KQkq', 'a8', 'r'), 'KQk');
  assert.equal(updateCastlingForRemoval('KQkq', 'e1', 'K'), 'kq');
  const captured = modifyFen({ fen: START.replace(' w ', ' b '), square: 'h1', newPiece: { type: 'n', color: 'b' }, whiteToMove: true, isCapture: true });
  assert.equal(parseFen(captured).castling, 'Qkq');
});

test('FEN and king validation', () => {
  assert.ok(isValidFen(START));
  assert.ok(!isValidFen('not a fen'));
  assert.ok(validateKings(START).valid);
  assert.ok(!validateKings('8/8/8/8/8/8/8/8 w - - 0 1').valid);
});

test('validateNoSelfCheck detects an exposed king', () => {
  // White king e1, black rook e8, nothing between: white just "moved" leaving its king in check
  const exposed = '4r2k/8/8/8/8/8/8/4K3 b - - 0 1';
  assert.equal(validateNoSelfCheck(exposed, 'w').valid, false);
  const safe = '4r2k/8/8/8/8/8/4B3/4K3 b - - 0 1';
  assert.equal(validateNoSelfCheck(safe, 'w').valid, true);
});
