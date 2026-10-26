import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

/**
 * Renderer build. base './' so the packaged app loads via file://.
 * Draco decoder files are copied from three's examples into dist/draco
 * so GLB import works fully offline.
 */
const copyDraco = () => ({
  name: 'copy-draco',
  closeBundle() {
    const src = path.resolve(__dirname, 'node_modules/three/examples/jsm/libs/draco/gltf');
    const dest = path.resolve(__dirname, 'dist/draco');
    if (fs.existsSync(src)) {
      fs.mkdirSync(dest, { recursive: true });
      for (const f of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, f), path.join(dest, f));
      }
    }
  },
});

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), copyDraco()],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    target: 'chrome126',
    chunkSizeWarningLimit: 2600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  resolve: {
    alias: {
      'three/addons': path.resolve(__dirname, 'node_modules/three/examples/jsm'),
    },
  },
});
