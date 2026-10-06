const esbuild = require('esbuild');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const isDev = process.argv.includes('--watch');
const indexPath = path.join(__dirname, 'index.html');

const hashOf = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, file))).digest('hex').slice(0, 10);

/** Stamp the version and content hashes (for cache-busting) into index.html */
function stampIndex() {
  const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  const before = fs.readFileSync(indexPath, 'utf8');
  const after = before
    .replace(/<span id="version-info">v[\d.]+<\/span>/, `<span id="version-info">v${version}</span>`)
    .replace(/dist\/bundle\.js(\?v=[\w]+)?"/, `dist/bundle.js?v=${hashOf('dist/bundle.js')}"`)
    .replace(/css\/style\.css(\?v=[\w]+)?"/, `css/style.css?v=${hashOf('css/style.css')}"`);
  if (after !== before) fs.writeFileSync(indexPath, after);
}

const config = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  sourcemap: true,
  target: 'es2020',
  format: 'iife',
  globalName: 'ChessApp',
  external: [],  // THREE.js and chess.js are loaded as globals from lib/
  define: {
    'process.env.NODE_ENV': isDev ? '"development"' : '"production"'
  },
  minify: !isDev,
};

if (isDev) {
  esbuild.context({
    ...config,
    plugins: [{ name: 'stamp', setup(build) { build.onEnd(() => stampIndex()); } }],
  }).then(ctx => {
    ctx.watch();
    console.log('Watching for changes...');
  });
} else {
  esbuild.build(config).then(() => {
    stampIndex();
    console.log('Build complete!');
  }).catch(() => process.exit(1));
}
