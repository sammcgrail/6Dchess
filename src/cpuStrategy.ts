/**
 * Pure decision helpers for the CPU player. Randomness is injectable so the
 * behaviour can be unit tested deterministically.
 */

import { pieceMap, pieceValue } from './rules';
import type { ChessMove, PieceColor } from './types';

export type Random = () => number;

/** Material difference from `color`'s point of view (pawn = 1, queen = 9) */
export function materialBalance(fen: string, color: PieceColor): number {
  let score = 0;
  for (const piece of pieceMap(fen).values()) {
    score += piece.color === color ? pieceValue(piece.type) : -pieceValue(piece.type);
  }
  return score;
}

/**
 * How urgently a board wants the side to move's attention: checks available, being in
 * check, captures, material imbalance, and boards that have fallen behind the others.
 */
export function boardPriority(
  fen: string,
  moveCount: number,
  averageMoveCount: number,
  random: Random = Math.random
): number {
  const chess = new Chess(fen);
  const color = chess.turn() as PieceColor;
  const moves = chess.moves({ verbose: true }) as ChessMove[];
  let score = 0;
  if (moves.some((m) => m.san?.includes('+'))) score += 50;
  if (chess.in_check()) score += 40;
  score += moves.filter((m) => m.captured).length * 5;

  // Press an advantage, or shore up a weakness
  const advantage = materialBalance(fen, color);
  score += advantage > 0 ? advantage * 3 : -advantage * 2;

  // Keep boards progressing evenly
  if (moveCount < averageMoveCount * 0.5) score += 20;
  else if (moveCount < averageMoveCount * 0.8) score += 10;

  return score + random() * 5;
}

/**
 * Choose among scored multiverse candidates (higher score = better, 1000 = mate).
 * Strong candidates are played with probability `chance`; purposeless ones only rarely.
 * Mutates `candidates` order (sorted best first).
 */
export function pickMultiverseMove<T extends { score: number; bias: number }>(
  candidates: T[],
  chance: number,
  random: Random = Math.random
): T | null {
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score || b.bias - a.bias);
  const best = candidates[0];
  if (best.score >= 1000) return best; // forced win on another board: always take it
  const strength = Math.min(1, Math.max(0, best.score) / 4);
  const probability = chance * (0.08 + 0.92 * strength) * (0.5 + best.bias);
  if (random() >= probability) return null;
  const top = candidates.filter((c) => c.score === best.score);
  return top[Math.floor(random() * top.length)];
}
