import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/** `npm run dev` with a sync server on :8080 (npm run server -- serve): open /k/<token>, then /p/<project>/. */
const SYNC_SERVER = process.env.SYNC_SERVER ?? 'http://localhost:8080';

export default defineConfig({
  base: './',
  server: {
    proxy: {
      '/api': SYNC_SERVER,
      '/k/': SYNC_SERVER,
      '^/p/[^/]+/project\\.json$': SYNC_SERVER,
    },
  },
  build: {
    rollupOptions: {
      input: {
        editor: resolve(__dirname, 'index.html'),
        play: resolve(__dirname, 'play.html'),
        tanks: resolve(__dirname, 'tanks.html'),
        aura: resolve(__dirname, 'aura.html'),
        td: resolve(__dirname, 'td.html'),
      },
    },
  },
});
