import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': `${root}src`, '@shared': `${root}../shared` } },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3210',
      '/files': 'http://127.0.0.1:3210',
    },
  },
  build: { outDir: `${root}dist`, emptyOutDir: true },
});
