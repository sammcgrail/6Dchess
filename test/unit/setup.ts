// chess.js is a browser global in the app (lib/chess.min.js); provide the same version in Node.
// eslint-disable-next-line @typescript-eslint/no-var-requires
(globalThis as unknown as { Chess: unknown }).Chess = require('chess.js').Chess;
