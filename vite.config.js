import { defineConfig } from 'vite';

// base: './' にすると、dist フォルダをそのまま itch.io / GitHub Pages / 任意のサーバーに置ける
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000, target: 'es2022' },
});
