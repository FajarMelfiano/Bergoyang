import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

/**
 * Build frontend React → folder public/ (kontrak server.js & vercel.json
 * tidak berubah: / → public/index.html, /dj → public/dj.html).
 *
 * - emptyOutDir: false — public/ masih berisi app lama sampai switchover;
 *   jangan pernah menghapusnya otomatis selama transisi.
 * - dev server (port 5173) mem-proxy /api, /audio, dan SSE ke server.js.
 */
export default defineConfig({
  root: resolve(import.meta.dirname, 'client'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'client/src') },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'public'),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'client/index.html'),
        dj: resolve(import.meta.dirname, 'client/dj.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/audio': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
