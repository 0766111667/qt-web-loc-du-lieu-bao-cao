import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// base './' để chạy được cả khi đặt dưới thư mục con (GitHub Pages, v.v.)
export default defineConfig({
  plugins: [preact()],
  base: './',
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 900 },
});
