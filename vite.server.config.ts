import { defineConfig } from 'vite';

/** The sync server (server/main.ts) as one Node file, dependencies included: dist-server/server.js. */
export default defineConfig({
  build: {
    ssr: 'server/main.ts',
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'server.js' } },
  },
  ssr: { noExternal: true },
});
