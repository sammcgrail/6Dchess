/**
 * Pure rule logic for multiverse moves (cross-timeline and time travel).
 *
 * Every function here works on FEN strings and returns a plan without mutating
 * any game state, so callers can validate a move completely before committing it.
 */

import { modifyFen, parseFen, isValidFen, validateKings, validateNoSelfCheck } from './gameUtils';
import type { Piece, PieceType, Square } from './types';

export type PlanResult<T> = ({ ok: true } & T) | { ok: false; reason: string };

export interface CrossTimelinePlan {
  sourceFen: string;
  targetFen: string;
  /** Piece as it stands on the target board (a pawn reaching the last rank becomes a queen) */
  placedPiece: Piece;
}

export interface TimeTravelPlan {
  sourceFen: string;
  arrivalFen: string;
  captured: Piece | null;
}

/** Piece types allowed to cross between timelines */
export function canCrossTimelines(type: PieceType): boolean {
  return type !== 'k';
}

/** Piece types allowed to travel back in time */
export function canTimeTravel(type: PieceType): boolean {
  return type === 'q' || type === 'r' || type === 'b' || type === 'n';
}

function toSquare(file: number, rank: number): Square {
  return (String.fromCharCode(97 + file) + (rank + 1)) as Square;
}

function onBoard(file: number, rank: number): boolean {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

/** Piece placement lookup from a FEN, keyed by square */
export function pieceMap(fen: string): Map<Square, Piece> {
  const map = new Map<Square, Piece>();
  const rows = fen.split(' ')[0].split('/');
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of rows[r] || '') {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
      } else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        map.set(toSquare(file, 7 - r), { type: ch.toLowerCase() as PieceType, color });
        file++;
      }
    }
  }
  return map;
}

/**
 * Empty squares a piece could land on when it phases into another board at `fromSquare`.
 * Landings never capture; pawns only push forward and cannot jump over pieces.
 */
export function crossTimelineLandingSquares(targetFen: string, fromSquare: Square, piece: Piece): Square[] {
  const occupied = pieceMap(targetFen);
  const file = fromSquare.charCodeAt(0) - 97;
  const rank = Number(fromSquare[1]) - 1;
  const result: Square[] = [];

  const addIfEmpty = (f: number, r: number): boolean => {
    if (!onBoard(f, r)) return false;
    const sq = toSquare(f, r);
    if (occupied.has(sq)) return false;
    result.push(sq);
    return true;
  };
  const ray = (df: number, dr: number) => {
    let f = file + df;
    let r = rank + dr;
    while (addIfEmpty(f, r)) {
      f += df;
      r += dr;
    }
  };

  switch (piece.type) {
    case 'p': {
      const dir = piece.color === 'w' ? 1 : -1;
      const startRank = piece.color === 'w' ? 1 : 6;
      if (addIfEmpty(file, rank + dir) && rank === startRank) {
        addIfEmpty(file, rank + 2 * dir);
      }
      break;
    }
    case 'n':
      for (const [df, dr] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
        addIfEmpty(file + df, rank + dr);
      }
      break;
    case 'b':
      ray(1, 1); ray(1, -1); ray(-1, 1); ray(-1, -1);
      break;
    case 'r':
      ray(1, 0); ray(-1, 0); ray(0, 1); ray(0, -1);
      break;
    case 'q':
      ray(1, 1); ray(1, -1); ray(-1, 1); ray(-1, -1);
      ray(1, 0); ray(-1, 0); ray(0, 1); ray(0, -1);
      break;
    case 'k':
      break;
  }
  return result;
}

/** A pawn landing on the far rank is promoted to a queen */
function promoteIfNeeded(piece: Piece, square: Square): Piece {
  if (piece.type !== 'p') return piece;
  const lastRank = piece.color === 'w' ? '8' : '1';
  return square[1] === lastRank ? { type: 'q', color: piece.color } : piece;
}

/** Remove the moving piece from its board and verify the mover is not left in check */
function planDeparture(fen: string, square: Square, piece: Piece): PlanResult<{ fen: string }> {
  const parts = parseFen(fen);
  if (parts.turn !== piece.color) return { ok: false, reason: 'not your turn on the source board' };
  const actual = pieceMap(fen).get(square);
  if (!actual || actual.type !== piece.type || actual.color !== piece.color) {
    return { ok: false, reason: `no ${piece.color}${piece.type} on ${square}` };
  }
  const after = modifyFen({ fen, square, newPiece: null, whiteToMove: piece.color === 'b' });
  const check = validateNoSelfCheck(after, piece.color);
  if (!check.valid) return { ok: false, reason: 'leaving would expose your king on the source board' };
  return { ok: true, fen: after };
}

/** Place a piece on a board as the mover's move, verifying legality of the result */
function planArrival(fen: string, square: Square, piece: Piece): PlanResult<{ fen: string; captured: Piece | null }> {
  const parts = parseFen(fen);
  if (parts.turn !== piece.color) return { ok: false, reason: 'not your turn on the destination board' };
  const captured = pieceMap(fen).get(square) || null;
  if (captured && captured.color === piece.color) return { ok: false, reason: 'square occupied by own piece' };
  if (captured && captured.type === 'k') return { ok: false, reason: 'cannot capture a king' };
  const after = modifyFen({
    fen,
    square,
    newPiece: piece,
    whiteToMove: piece.color === 'b',
    isCapture: captured !== null,
  });
  if (!isValidFen(after) || !validateKings(after).valid) return { ok: false, reason: 'resulting position is invalid' };
  const check = validateNoSelfCheck(after, piece.color);
  if (!check.valid) return { ok: false, reason: 'arrival leaves your king in check' };
  return { ok: true, fen: after, captured };
}

/** Validate and compute both resulting positions of a cross-timeline move */
export function planCrossTimelineMove(
  sourceFen: string,
  targetFen: string,
  sourceSquare: Square,
  targetSquare: Square,
  piece: Piece
): PlanResult<CrossTimelinePlan> {
  if (!canCrossTimelines(piece.type)) return { ok: false, reason: 'kings cannot cross timelines' };
  if (!crossTimelineLandingSquares(targetFen, sourceSquare, piece).includes(targetSquare)) {
    return { ok: false, reason: `${targetSquare} is not a legal landing square` };
  }
  const departure = planDeparture(sourceFen, sourceSquare, piece);
  if (!departure.ok) return departure;
  const placedPiece = promoteIfNeeded(piece, targetSquare);
  const arrival = planArrival(targetFen, targetSquare, placedPiece);
  if (!arrival.ok) return arrival;
  return { ok: true, sourceFen: departure.fen, targetFen: arrival.fen, placedPiece };
}

/**
 * Validate and compute a time-travel move: the piece leaves `sourceFen` and arrives
 * on the same square of a past position, which must be a position where it was the
 * mover's turn.
 */
export function planTimeTravel(
  sourceFen: string,
  snapshotFen: string,
  square: Square,
  piece: Piece
): PlanResult<TimeTravelPlan> {
  if (!canTimeTravel(piece.type)) return { ok: false, reason: `${piece.type} cannot time travel` };
  const departure = planDeparture(sourceFen, square, piece);
  if (!departure.ok) return departure;
  const arrival = planArrival(snapshotFen, square, piece);
  if (!arrival.ok) return arrival;
  return { ok: true, sourceFen: departure.fen, arrivalFen: arrival.fen, captured: arrival.captured };
}
