import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canCrossTimelines,
  canTimeTravel,
  crossTimelineLandingSquares,
  pieceMap,
  planCrossTimelineMove,
  planTimeTravel,
} from '../../src/rules';
import { isValidFen, validateKings, parseFen } from '../../src/gameUtils';
import type { Piece, Square } from '../../src/types';

/** Minimal multiverse model mirroring GameManager's bookkeeping, driven only by rules.ts */
interface Tl { fens: string[] }

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function isFinished(fen: string): boolean {
  const c = new Chess(fen);
  return c.in_checkmate() || c.in_stalemate() || c.in_draw();
}

function checkInvariants(fen: string, label: string) {
  assert.ok(isValidFen(fen), `${label}: invalid FEN ${fen}`);
  assert.ok(validateKings(fen).valid, `${label}: bad kings ${fen}`);
  assert.ok(new Chess().load(fen), `${label}: chess.js rejects ${fen}`);
  // Side NOT to move must never be in check (that would mean an illegal move was made)
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  const flipped = new Chess();
  flipped.load(parts.join(' '));
  assert.ok(!flipped.in_check(), `${label}: side that just moved is in check: ${fen}`);
  // No pawns on the back ranks
  const rows = fen.split(' ')[0].split('/');
  assert.ok(!/p/i.test(rows[0]) && !/p/i.test(rows[7]), `${label}: pawn on back rank ${fen}`);
}

function playGame(seed: number, maxPlies: number) {
  const rand = rng(seed);
  const tls: Tl[] = [{ fens: [new Chess().fen()] }];
  const stats = { normal: 0, cross: 0, travel: 0 };

  for (let ply = 0; ply < maxPlies; ply++) {
    const live = tls.filter((t) => !isFinished(t.fens[t.fens.length - 1]));
    if (live.length === 0) break;
    const tl = live[Math.floor(rand() * live.length)];
    const fen = tl.fens[tl.fens.length - 1];
    const color = parseFen(fen).turn;
    const pieces = [...pieceMap(fen)].filter(([, p]) => p.color === color);
    const roll = rand();

    if (roll < 0.15 && tls.length < 6) {
      // Try a time travel
      const options: Array<{ sq: Square; p: Piece; idx: number }> = [];
      for (const [sq, p] of pieces) {
        if (!canTimeTravel(p.type)) continue;
        for (let i = 0; i < tl.fens.length - 1; i++) {
          if (planTimeTravel(fen, tl.fens[i], sq, p).ok) options.push({ sq, p, idx: i });
        }
      }
      if (options.length) {
        const o = options[Math.floor(rand() * options.length)];
        const plan = planTimeTravel(fen, tl.fens[o.idx], o.sq, o.p);
        assert.ok(plan.ok);
        if (!plan.ok) continue;
        tl.fens.push(plan.sourceFen);
        tls.push({ fens: [...tl.fens.slice(0, o.idx + 1), plan.arrivalFen] });
        checkInvariants(plan.sourceFen, 'travel-source');
        checkInvariants(plan.arrivalFen, 'travel-arrival');
        stats.travel++;
        continue;
      }
    }

    if (roll < 0.35) {
      // Try a cross-timeline move to a synced board
      const options: Array<{ target: Tl; sq: Square; to: Square; p: Piece }> = [];
      for (const target of tls) {
        if (target === tl || target.fens.length !== tl.fens.length) continue;
        const tFen = target.fens[target.fens.length - 1];
        if (isFinished(tFen)) continue;
        for (const [sq, p] of pieces) {
          if (!canCrossTimelines(p.type)) continue;
          for (const to of crossTimelineLandingSquares(tFen, sq, p)) {
            if (planCrossTimelineMove(fen, tFen, sq, to, p).ok) options.push({ target, sq, to, p });
          }
        }
      }
      if (options.length) {
        const o = options[Math.floor(rand() * options.length)];
        const tFen = o.target.fens[o.target.fens.length - 1];
        const plan = planCrossTimelineMove(fen, tFen, o.sq, o.to, o.p);
        assert.ok(plan.ok);
        if (!plan.ok) continue;
        tl.fens.push(plan.sourceFen);
        o.target.fens.push(plan.targetFen);
        checkInvariants(plan.sourceFen, 'cross-source');
        checkInvariants(plan.targetFen, 'cross-target');
        stats.cross++;
        continue;
      }
    }

    const c = new Chess(fen);
    const moves = c.moves();
    if (moves.length === 0) continue;
    c.move(moves[Math.floor(rand() * moves.length)]);
    tl.fens.push(c.fen());
    checkInvariants(c.fen(), 'normal');
    stats.normal++;
  }
  return { stats, timelines: tls.length };
}

test('randomized multiverse games never reach an illegal position', () => {
  const total = { normal: 0, cross: 0, travel: 0 };
  for (let seed = 1; seed <= 25; seed++) {
    const { stats } = playGame(seed, 120);
    total.normal += stats.normal;
    total.cross += stats.cross;
    total.travel += stats.travel;
  }
  // Make sure the fuzzer actually exercised the multiverse moves
  assert.ok(total.cross > 20, `too few cross-timeline moves: ${total.cross}`);
  assert.ok(total.travel > 20, `too few time travels: ${total.travel}`);
});
