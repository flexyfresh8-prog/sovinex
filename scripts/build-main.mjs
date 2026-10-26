/**
 * Bundles the Electron main + preload with esbuild (CommonJS, external electron).
 */
import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  target: 'node20',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'warning',
};

await build({ ...shared, entryPoints: ['src/main/main.ts'], outfile: 'dist-electron/main.js' });
await build({ ...shared, entryPoints: ['src/main/preload.ts'], outfile: 'dist-electron/preload.js' });
console.log('main + preload bundled.');
