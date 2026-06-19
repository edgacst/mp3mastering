import { defineConfig } from 'vite';

/** venysound.com Nginx: /mastering/ → 127.0.0.1:3001 (경로 접두사 제거 후 전달) */
const base = process.env.VITE_BASE_PATH || '/mastering/';

export default defineConfig({
  base,
  server: {
    port: 5174,
    proxy: {
      [`${base}api`]: {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(new RegExp(`^${base.replace(/\/$/, '')}/api`), '/api'),
      },
    },
  },
});
