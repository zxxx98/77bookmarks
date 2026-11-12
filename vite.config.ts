import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { host: '0.0.0.0', port: 8788, strictPort: true },
  preview: { host: '0.0.0.0', port: 8788, strictPort: true },
  build: {
    rollupOptions: {
      input: { main: 'index.html', popup: 'extension/popup.html', background: 'extension/background.ts' },
      output: { entryFileNames: (chunk) => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js' },
    },
  },
})
