import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by the API at /admin. In development `npm run dev` proxies the API on :3000.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/v1': 'http://localhost:3000', '/files': 'http://localhost:3000' },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 800 },
});
