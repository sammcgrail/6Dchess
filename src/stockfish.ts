/* Stockfish Integration for 6D Chess CPU Play */

import type { Square } from './types';

export interface StockfishMove {
  from: Square;
  to: Square;
  promotion?: string;
}

/**
 * StockfishManager - Manages Stockfish chess engine for CPU play
 *
 * Uses stockfish.js Web Worker from CDN for UCI chess engine
 * Handles UCI protocol communication with the engine
 */
export class StockfishManager {
  private worker: Worker | null = null;
  private isReady = false;
  private loadPromise: Promise<boolean> | null = null;
  private resolveUciOk: (() => void) | null = null;
  private _skillLevel = 10; // 0-20, default middle
  private _searchDepth = 10; // 1-20, default reasonable depth
  private _onReadyCallbacks: (() => void)[] = [];

  // Only one search runs at a time; later requests wait in this chain
  private searchQueue: Promise<unknown> = Promise.resolve();
  private activeSearch: { resolve: (move: StockfishMove | null) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  // Aborted searches still emit a "bestmove"; this many must be discarded
  private staleBestmoves = 0;

  /** Hard cap on engine thinking time per move */
  static readonly MOVE_TIME_MS = 4000;

  constructor() {
    this.loadEngine();
  }

  /** Register a callback to be called when the engine becomes ready */
  onReady(callback: () => void): void {
    if (this.isReady) {
      callback();
    } else {
      this._onReadyCallbacks.push(callback);
    }
  }

  private _notifyReady(): void {
    for (const cb of this._onReadyCallbacks) {
      try {
        cb();
      } catch (e) {
        console.error('[Stockfish] onReady callback error:', e);
      }
    }
    this._onReadyCallbacks = [];
  }

  /** Load the Stockfish engine as a Web Worker. Resolves true once the engine has answered "uciok". */
  loadEngine(): Promise<boolean> {
    if (this.isReady) return Promise.resolve(true);
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean, error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.resolveUciOk = null;
        if (ok) {
          this.isReady = true;
          this.setSkillLevel(this._skillLevel);
          this._notifyReady();
        } else {
          console.warn('[Stockfish] Engine unavailable, CPU will use its built-in move picker:', error);
          this.worker?.terminate();
          this.worker = null;
          this.loadPromise = null;
        }
        resolve(ok);
      };
      const timeout = setTimeout(() => finish(false, new Error('UCI timeout')), 15000);

      try {
        // Resolve against <base href> so the worker loads from the app directory
        const workerUrl = new URL('lib/stockfish-worker.js', document.baseURI).href;
        this.worker = new Worker(workerUrl);
        this.worker.onmessage = (e) => this.handleMessage(String(e.data));
        this.worker.onerror = (err) => finish(false, err.message || err);
        this.resolveUciOk = () => finish(true);
        this.worker.postMessage('uci');
      } catch (error) {
        finish(false, error);
      }
    });
    return this.loadPromise;
  }

  /** Handle UCI messages from the engine */
  private handleMessage(msg: string): void {
    if (msg === 'uciok') {
      this.resolveUciOk?.();
      return;
    }
    if (!msg.startsWith('bestmove')) return;

    if (this.staleBestmoves > 0) {
      this.staleBestmoves--;
      return;
    }
    const search = this.activeSearch;
    if (!search) return;
    this.activeSearch = null;
    clearTimeout(search.timer);
    // "bestmove e2e4 ponder d7d5" or "bestmove (none)"
    const moveStr = msg.split(' ')[1];
    search.resolve(moveStr && moveStr !== '(none)' ? this.parseMoveString(moveStr) : null);
  }

  /** Parse a UCI move string like "e2e4" or "e7e8q" */
  private parseMoveString(moveStr: string): StockfishMove | null {
    if (moveStr.length < 4) return null;
    const from = moveStr.substring(0, 2) as Square;
    const to = moveStr.substring(2, 4) as Square;
    const promotion = moveStr.length > 4 ? moveStr.charAt(4) : undefined;
    return { from, to, promotion };
  }

  /** Set the engine skill level (0 = weakest, 20 = strongest) */
  setSkillLevel(level: number): void {
    this._skillLevel = Math.max(0, Math.min(20, level));
    if (this.worker && this.isReady) {
      this.worker.postMessage(`setoption name Skill Level value ${this._skillLevel}`);
    }
  }

  get skillLevel(): number {
    return this._skillLevel;
  }

  /** Set the search depth (1-20) */
  setSearchDepth(depth: number): void {
    this._searchDepth = Math.max(1, Math.min(20, depth));
  }

  get searchDepth(): number {
    return this._searchDepth;
  }

  /** Check if the engine is available and ready */
  get available(): boolean {
    return this.worker !== null && this.isReady;
  }

  /**
   * Get the best move for a given position (FEN). Requests are serialized, so
   * each result always belongs to the position it was asked for.
   */
  getBestMove(fen: string, depth?: number): Promise<StockfishMove | null> {
    const searchDepth = depth ?? this._searchDepth;
    const result = this.searchQueue.then(() => this._search(fen, searchDepth));
    this.searchQueue = result.catch(() => null);
    return result;
  }

  private async _search(fen: string, depth: number): Promise<StockfishMove | null> {
    if (!(await this.loadEngine()) || !this.worker) return null;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.warn('[Stockfish] Search timed out');
        this._abortActiveSearch();
      }, StockfishManager.MOVE_TIME_MS + 5000);
      this.activeSearch = { resolve, timer };
      this.worker!.postMessage(`position fen ${fen}`);
      this.worker!.postMessage(`go depth ${depth} movetime ${StockfishManager.MOVE_TIME_MS}`);
    });
  }

  /** Abort the running search; its late "bestmove" will be discarded */
  private _abortActiveSearch(): void {
    const search = this.activeSearch;
    if (!search) return;
    this.activeSearch = null;
    clearTimeout(search.timer);
    this.staleBestmoves++;
    this.worker?.postMessage('stop');
    search.resolve(null);
  }

  /** Stop any ongoing search */
  stop(): void {
    this._abortActiveSearch();
  }

  /** Reset the engine for a new game */
  newGame(): void {
    if (this.worker && this.isReady) {
      this.worker.postMessage('ucinewgame');
    }
  }

  /** Terminate the worker completely (for page unload cleanup) */
  terminate(): void {
    this._abortActiveSearch();
    this.worker?.terminate();
    this.worker = null;
    this.isReady = false;
    this.loadPromise = null;
    this.staleBestmoves = 0;
  }
}

// Export singleton instance
export const stockfish = new StockfishManager();
