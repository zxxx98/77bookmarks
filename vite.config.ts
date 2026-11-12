/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** `VITE_TARGET=selfhost` builds only the page, for the server in `server/` to hand out */
const selfhost = process.env.VITE_TARGET === 'selfhost'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { host: '0.0.0.0', port: 8788, strictPort: true },
  preview: { host: '0.0.0.0', port: 8788, strictPort: true },
  test: {
    projects: [
      { extends: true, test: { name: 'app', include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'sync-worker/**/*.test.ts', 'server/**/*.test.ts', 'clipper/**/*.test.ts'] } },
      // The storage tests again, on the SQLite backend of the self-hosted server
      { extends: true, test: { name: 'sqlite', include: ['src/storage/service.test.ts', 'src/storage/db.test.ts', 'src/sync/engine.test.ts'], setupFiles: ['server/test-sqlite.ts'] } },
    ],
  },
  build: selfhost ? { outDir: 'dist-selfhost/public', emptyOutDir: true } : {
    rollupOptions: {
      input: { main: 'index.html', popup: 'extension/popup.html', background: 'extension/background.ts' },
      output: { entryFileNames: (chunk) => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js' },
    },
  },
})
