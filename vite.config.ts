import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
  // npm run dev proxies the API to a running backend.
  server: { proxy: { '/api': { target: process.env.API_TARGET ?? 'http://127.0.0.1:3000', changeOrigin: false } } },
});
