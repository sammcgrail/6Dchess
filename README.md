# ♟️ 6D Chess

Multiverse chess with timeline branching. Make a move to create alternate realities.

## Rules

On top of normal chess:

- **Cross-timeline moves** — any piece except the king can jump to the same square on another board and
  land on a square it could reach from there. Both boards must be at the same move count with the same side
  to move, the landing can't capture, and the move must not leave your king in check on either board.
  A pawn landing on the last rank promotes to a queen.
- **Time travel** — queens, rooks, bishops and knights can travel back to an earlier position on their
  board where it was their side's turn. This spawns a new timeline. Leaving must not expose your king, and
  the arrival must be legal.
- The game ends when every timeline has finished (checkmate, stalemate or draw).

## Development

```bash
npm install
npm run dev        # build and serve on http://localhost:8000/
npm run watch      # rebuild on change
```

The app is static: `index.html`, `css/`, `dist/bundle.js` and `lib/` (Three.js, chess.js, Stockfish WASM).
It works from any path (`/`, `/chess`, `/chess/`, `/6Dchess/`).

## Tests

```bash
npm run lint       # strict type check
npm run test:unit  # rules, FEN utilities and a randomized multiverse fuzz test (Node)
npm run test:e2e   # Playwright: plays the real app in headless Chromium, incl. CPU self-play
npm test           # both
```

E2E screenshots land in `test-results/screens/`. CI runs everything on each pull request; pushes to `main`
deploy to GitHub Pages.

## Code map

| File | What it does |
| --- | --- |
| `src/rules.ts` | Pure multiverse move rules (validates and plans cross-timeline / time-travel moves) |
| `src/gameUtils.ts` | FEN helpers and validation |
| `src/game.ts` | Game controller: timelines, UI, CPU player |
| `src/board3d.ts` | Three.js scene: boards, history stacks, connection lines, effects |
| `src/stockfish.ts` | Stockfish worker wrapper used by the CPU player |
